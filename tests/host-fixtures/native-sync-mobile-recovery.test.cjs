'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), { createHash } = require('node:crypto');
const express = require('express');
const { CentralStore } = require('../Plugin/NativeSync/sync/centralStore');
const { MobilePortal } = require('../Plugin/NativeSync/mobile/portal');
const { digest } = require('../Plugin/NativeSync/mobile/execution');
const recovery = require('../Plugin/NativeSync/mobile/submissionRecovery');
const origin = 'https://recovery.example.invalid', backend = 'http://toolbox.example.invalid:6005', key = 'synthetic-recovery-test-only';
const topics = [
    { key: 'first', ownerType: 'agent', ownerId: 'synthetic-one', topicId: 'history-one', agentAlias: 'One', model: 'synthetic' },
    { key: 'second', ownerType: 'agent', ownerId: 'synthetic-two', topicId: 'history-two', agentAlias: 'Two', model: 'synthetic' }
];
const agents = { isAgent: alias => ['One', 'Two'].includes(alias), getAgentPrompt: async () => 'synthetic prompt' };
const sha = value => createHash('sha256').update(value).digest('hex');
const contextHeaders = context => ({ 'X-NativeSync-Entry-Id': context.entryId, 'X-NativeSync-Session-Marker': context.sessionMarker });

async function fixture(t, list = topics) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'native-sync-recovery-')), file = path.join(root, 'central.sqlite');
    const config = { NativeMobileOrigin: origin, NativeMobileBackendUrl: backend, NativeMobileKeyExchangeEnabled: true, NativeMobileTopics: JSON.stringify(list), NativeMobileConfigSync: list.some(t => t.ownerType === 'group') };
    let store, portal;
    const open = () => {
        store = new CentralStore(file); portal = new MobilePortal({ store, config, agentManager: agents });
        portal.connection.hostKey = () => key; // Authentication only; leave the execution endpoint absent (drain now closes admission).
    };
    open();
    const app = express(); app.set('trust proxy', true); app.use('/mobile', (req, res, next) => portal.router(req, res, next));
    const server = await new Promise((resolve, reject) => { const s = app.listen(0, '127.0.0.1', error => error ? reject(error) : resolve(s)); });
    t.after(async () => { await portal.close(); store.close(); server.closeAllConnections(); await new Promise(r => server.close(r)); fs.rmSync(root, { recursive: true, force: true }); });
    const request = (route, { cookie, body, secure = true, requestOrigin = origin, headers = {} } = {}) => fetch(`http://127.0.0.1:${server.address().port}/mobile/api/${route}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { ...(secure ? { 'X-Forwarded-Proto': 'https' } : {}), Origin: requestOrigin, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...headers },
        body: body === undefined ? undefined : JSON.stringify(body)
    });
    const login = async cookie => { const r = await request('connection/authenticate', { cookie, body: { serverUrl: backend, apiKey: key } }); assert.equal(r.status, 200); return r.headers.get('set-cookie').split(';')[0]; };
    const session = async cookie => { const r = await request('session', { cookie }); assert.equal(r.status, 200); return r.json(); };
    return { request, login, session, get store() { return store; }, get portal() { return portal; }, async reopen() { await portal.close(); store.close(); open(); } };
}

test('recovery fingerprints use canonical original payload, preserve attachment order and separate kind/topic/request identity', () => {
    const input = { topicKey: 'first', kind: 'message', payload: { requestId: 'recovery-request-001', text: '原文\n👋' } };
    const canonical = '{"kind":"message","payload":{"attachments":[],"requestId":"recovery-request-001","text":"原文\\n👋"},"topicKey":"first"}';
    assert.deepEqual(recovery.normalizeSubmission(input), { ...input, payload: { ...input.payload, attachments: [] } });
    assert.equal(recovery.payloadHash(input), sha(canonical));
    assert.equal(recovery.payloadHash(input), recovery.payloadHash({ ...input, payload: { attachments: [], text: input.payload.text, requestId: input.payload.requestId } }));
    const original = recovery.payloadHash(input);
    for (const changed of [
        { ...input, topicKey: 'second' }, { ...input, payload: { ...input.payload, requestId: 'recovery-request-002' } },
        { ...input, payload: { ...input.payload, text: 'different' } }, { topicKey: 'first', kind: 'invitation', payload: { requestId: input.payload.requestId, agentId: 'One' } }
    ]) assert.notEqual(recovery.payloadHash(changed), original);
    assert.notEqual(recovery.payloadHash({ ...input, payload: { ...input.payload, attachments: ['upload-a', 'upload-b'] } }), recovery.payloadHash({ ...input, payload: { ...input.payload, attachments: ['upload-b', 'upload-a'] } }));
    for (const payload of [{ ...input.payload, credentials: key }, { ...input.payload, attachments: null }, { ...input.payload, requestId: '' }]) assert.throws(() => recovery.payloadHash({ ...input, payload }), /INVALID_RECOVERY_SUBMISSION/);
    assert.equal(recovery.sessionMarker('session-one'), sha('native-sync-mobile-session-v1\0session-one'));
    assert.equal(recovery.entryId(origin, backend), sha('native-sync-mobile-entry-v1\0' + origin + '\0' + backend));
    assert.notEqual(recovery.entryId(origin, backend), recovery.entryId('https://other.example.invalid', backend));
    assert.notEqual(recovery.entryId(origin, backend), recovery.entryId(origin, 'http://other.example.invalid'));
});

test('authenticated recovery marker survives valid token rotation and SQLite reopen without exposing a credential', async t => {
    const f = await fixture(t); let cookie = await f.login();
    const before = await f.session(cookie), row = f.portal.currentSession({ headers: { cookie } });
    assert.deepEqual(before.recovery, { version: 1, entryId: recovery.entryId(origin, backend), sessionMarker: recovery.sessionMarker(row.id) });
    assert.match(before.recovery.entryId, /^[a-f0-9]{64}$/); assert.match(before.recovery.sessionMarker, /^[a-f0-9]{64}$/);
    for (const secret of [row.id, cookie.split('=')[1], key]) assert.equal(JSON.stringify(before).includes(secret), false);
    const previous = cookie; cookie = await f.login(cookie);
    assert.notEqual(previous, cookie); assert.equal((await f.request('session', { cookie: previous })).status, 401);
    assert.deepEqual((await f.session(cookie)).recovery, before.recovery);
    await f.reopen(); assert.deepEqual((await f.session(cookie)).recovery, before.recovery);
    assert.equal(f.store.metrics().journalRows, 0); assert.equal(f.portal.engine.snapshot().length, 0);
});

test('expired reauthentication and a fresh pairing change markers without changing the protected entry identity', async t => {
    const f = await fixture(t); let cookie = await f.login(); const first = (await f.session(cookie)).recovery;
    const row = f.portal.currentSession({ headers: { cookie } }); f.store.db.prepare('UPDATE mobile_sessions SET expires=0 WHERE id=?').run(row.id);
    assert.equal((await f.request('session', { cookie })).status, 401);
    cookie = await f.login(cookie); const second = (await f.session(cookie)).recovery;
    assert.equal(second.entryId, first.entryId); assert.notEqual(second.sessionMarker, first.sessionMarker);
    const grant = f.portal.createPairing(), paired = await f.request('pair', { cookie, body: { code: grant.pairingCode } }); assert.equal(paired.status, 200);
    cookie = paired.headers.get('set-cookie').split(';')[0]; const third = (await f.session(cookie)).recovery;
    assert.equal(third.entryId, first.entryId); assert.notEqual(third.sessionMarker, second.sessionMarker); assert.notEqual(third.sessionMarker, first.sessionMarker);
    assert.equal(f.store.metrics().journalRows, 0);
});

test('same-session accepted submission replays after reopen with the same fingerprint, job and journal row', async t => {
    const f = await fixture(t), cookie = await f.login(), before = await f.session(cookie);
    const body = { requestId: 'recovery-replay-001', text: 'synthetic accepted input' };
    const accepted = await (await f.request('conversations/first/messages', { cookie, body })).json();
    assert.equal(accepted.recovery.sessionMarker, before.recovery.sessionMarker);
    assert.equal(accepted.recovery.payloadHash, recovery.payloadHash({ topicKey: 'first', kind: 'message', payload: body }));
    await f.reopen(); const response = await f.request('conversations/first/messages', { cookie, body }); assert.equal(response.status, 202);
    const replay = await response.json(); assert.equal(replay.id, accepted.id); assert.equal(replay.replayed, true); assert.deepEqual(replay.recovery, accepted.recovery);
    assert.equal(replay.attempts, 0); assert.equal(f.portal.engine.snapshot().length, 1); assert.equal(f.store.metrics().journalRows, 1);
    const conflicting = await f.request('conversations/first/messages', { cookie, body: { ...body, text: 'changed payload' } });
    assert.equal(conflicting.status, 409); assert.equal((await conflicting.json()).error.code, 'REQUEST_ID_REUSED');
    assert.equal(f.store.metrics().journalRows, 1);
});

test('a new session may reconcile old execution identity but cannot acquire submission or cancel authority', async t => {
    const f = await fixture(t); let cookie = await f.login(); const original = (await f.session(cookie)).recovery;
    const body = { requestId: 'recovery-cross-session', text: 'synthetic original payload' };
    const accepted = await (await f.request('conversations/first/messages', { cookie, body })).json();
    const row = f.portal.currentSession({ headers: { cookie } }); f.store.db.prepare('UPDATE mobile_sessions SET expires=0 WHERE id=?').run(row.id); cookie = await f.login(cookie);
    const page = await (await f.request('conversations/first', { cookie })).json(), observed = page.executions.find(x => x.id === accepted.id);
    assert.equal(observed.own, false); assert.equal(Object.hasOwn(observed, 'submission'), false); assert.deepEqual(observed.recovery, accepted.recovery);
    assert.equal(observed.recovery.sessionMarker, original.sessionMarker); assert.notEqual(observed.recovery.sessionMarker, (await f.session(cookie)).recovery.sessionMarker);
    assert.equal((await f.request(`executions/${accepted.id}/cancel`, { cookie, body: {} })).status, 404);
    // A second session is still a separate idempotency domain. Its matching
    // requestId must not be confused with the original recovery evidence.
    const second = await (await f.request('conversations/first/messages', { cookie, body })).json();
    assert.notEqual(second.id, accepted.id); assert.equal(second.recovery.payloadHash, accepted.recovery.payloadHash); assert.notEqual(second.recovery.sessionMarker, accepted.recovery.sessionMarker);
    assert.equal(f.store.metrics().journalRows, 2); assert.equal(f.portal.engine.snapshot().every(x => x.attempts === 0), true);
});

test('recovery metadata grants no authentication or additional topic scopes', async t => {
    const f = await fixture(t), cookie = await f.login(), context = (await f.session(cookie)).recovery;
    assert.equal((await f.request('session')).status, 401);
    assert.equal((await f.request('session', { cookie: '__Secure-vcp_mobile=' + context.sessionMarker })).status, 401);
    assert.equal((await f.request('session', { cookie, secure: false })).status, 403);
    assert.equal((await f.request('conversations/first/messages', { cookie, requestOrigin: 'https://other.example.invalid', body: { requestId: 'wrong-origin-001', text: 'synthetic' } })).status, 403);
    const grant = f.portal.createPairing(); f.store.db.prepare('UPDATE mobile_pairings SET scopes=? WHERE hash=?').run(JSON.stringify(['first']), digest(grant.pairingCode));
    const paired = await f.request('pair', { body: { code: grant.pairingCode } }), restricted = paired.headers.get('set-cookie').split(';')[0];
    assert.deepEqual((await f.session(restricted)).topics.map(x => x.key), ['first']);
    assert.equal((await f.request('conversations/second', { cookie: restricted })).status, 403);
    assert.equal((await f.request('conversations/second/messages', { cookie: restricted, body: { requestId: 'out-of-scope-001', text: 'synthetic' } })).status, 403);
    assert.equal(f.store.metrics().journalRows, 0);
});

test('legacy and malformed durable payloads never receive guessed recovery evidence', async t => {
    const f = await fixture(t), cookie = await f.login();
    const body = { requestId: 'legacy-recovery-001', text: 'synthetic legacy row' };
    const accepted = await (await f.request('conversations/first/messages', { cookie, body })).json(), row = f.portal.engine.get(accepted.id);
    for (const changed of [{ request_payload: null }, { request_payload: '' }, { request_payload: '{bad' }, { request_payload: JSON.stringify({ ...body, requestId: 'different-id' }) }, { kind: 'unknown-kind' }]) assert.equal(recovery.executionRecovery({ ...row, ...changed }), undefined);
    f.store.db.prepare('UPDATE mobile_executions SET request_payload=NULL WHERE id=?').run(accepted.id);
    const observed = f.portal.engine.list('first', null)[0]; assert.equal(Object.hasOwn(observed, 'recovery'), false); assert.equal(Object.hasOwn(observed, 'submission'), false);
    assert.equal(observed.requestId, body.requestId); assert.equal(observed.state, 'queued'); assert.equal(f.store.metrics().journalRows, 1);
});

test('submission context headers accept and replay the original message across valid Cookie rotation', async t => {
    const f = await fixture(t); let cookie = await f.login();
    const context = (await f.session(cookie)).recovery, headers = contextHeaders(context), body = { requestId: 'context-replay-001', text: 'synthetic original input' };
    const first = await f.request('conversations/first/messages', { cookie, body, headers }); assert.equal(first.status, 202);
    const accepted = await first.json(); cookie = await f.login(cookie);
    const second = await f.request('conversations/first/messages', { cookie, body, headers }); assert.equal(second.status, 202);
    const replay = await second.json(); assert.equal(replay.replayed, true); assert.equal(replay.id, accepted.id); assert.deepEqual(replay.recovery, accepted.recovery);
    assert.equal(f.store.metrics().journalRows, 1); assert.equal(f.portal.engine.snapshot().length, 1); assert.equal(replay.attempts, 0);
});

test('a Cookie changed after context observation cannot accept an old-context message under a new session', async t => {
    const f = await fixture(t); let cookie = await f.login();
    const context = (await f.session(cookie)).recovery, headers = contextHeaders(context), body = { requestId: 'context-cookie-race-001', text: 'synthetic unknown ACK' };
    const accepted = await f.request('conversations/first/messages', { cookie, body, headers }); assert.equal(accepted.status, 202);
    // Another browser page may pair after the original page's GET /session
    // and GET /conversations but before its retry POST reaches the server.
    const grant = f.portal.createPairing(), pair = await f.request('pair', { cookie, body: { code: grant.pairingCode } }); cookie = pair.headers.get('set-cookie').split(';')[0];
    const before = { jobs: f.portal.engine.snapshot(), metrics: f.store.metrics() };
    for (const payload of [body, { ...body, requestId: 'context-not-yet-accepted' }]) {
        const response = await f.request('conversations/first/messages', { cookie, body: payload, headers }); assert.equal(response.status, 409); assert.equal((await response.json()).error.code, 'SUBMISSION_CONTEXT_CHANGED');
    }
    assert.deepEqual({ jobs: f.portal.engine.snapshot(), metrics: f.store.metrics() }, before);
    assert.notEqual((await f.session(cookie)).recovery.sessionMarker, context.sessionMarker);
});

test('partial or malformed context fails closed after the original Cookie, Origin and Topic authorization', async t => {
    const f = await fixture(t), cookie = await f.login(), context = (await f.session(cookie)).recovery, headers = contextHeaders(context);
    const body = { requestId: 'context-invalid-001', text: 'synthetic precondition' };
    for (const invalid of [
        { 'X-NativeSync-Entry-Id': context.entryId }, { 'X-NativeSync-Session-Marker': context.sessionMarker },
        { ...headers, 'X-NativeSync-Entry-Id': '' }, { ...headers, 'X-NativeSync-Entry-Id': 'a'.repeat(63) },
        { ...headers, 'X-NativeSync-Entry-Id': 'f'.repeat(64) }, { ...headers, 'X-NativeSync-Session-Marker': 'A'.repeat(64) },
        { ...headers, 'X-NativeSync-Session-Marker': 'f'.repeat(64) }, { ...headers, 'X-NativeSync-Session-Marker': context.sessionMarker + ',' + context.sessionMarker }
    ]) {
        const response = await f.request('conversations/first/messages', { cookie, body, headers: invalid }); assert.equal(response.status, 409); assert.equal((await response.json()).error.code, 'SUBMISSION_CONTEXT_CHANGED');
    }
    assert.equal((await f.request('conversations/first/messages', { body, headers })).status, 401);
    assert.equal((await f.request('conversations/first/messages', { cookie: '__Secure-vcp_mobile=' + context.sessionMarker, body, headers })).status, 401);
    assert.equal((await f.request('conversations/first/messages', { cookie, body, headers, requestOrigin: 'https://other.example.invalid' })).status, 403);
    assert.equal((await f.request('conversations/first/messages', { cookie, body, headers, secure: false })).status, 403);
    const grant = f.portal.createPairing(); f.store.db.prepare('UPDATE mobile_pairings SET scopes=? WHERE hash=?').run(JSON.stringify(['first']), digest(grant.pairingCode));
    const pair = await f.request('pair', { body: { code: grant.pairingCode } }), restricted = pair.headers.get('set-cookie').split(';')[0];
    const denied = await f.request('conversations/second/messages', { cookie: restricted, body, headers }); assert.equal(denied.status, 403); assert.equal((await denied.json()).error.code, 'TOPIC_NOT_ALLOWED');
    assert.equal(f.store.metrics().journalRows, 0); assert.equal(f.portal.engine.snapshot().length, 0);
});

test('invitation context headers replay within one session and reject a new Cookie before any new group step', async t => {
    const group = { key: 'group', ownerType: 'group', ownerId: 'synthetic-group', topicId: 'history-group', memberAliases: { one: 'One' } };
    const f = await fixture(t, [group]);
    await f.portal.engine.configs.publish({ topics: [{ ownerType: group.ownerType, ownerId: group.ownerId, topicId: group.topicId, expectedVersion: 0, config: { group: { name: 'Synthetic Group', mode: 'invite_only', members: ['one'] }, agents: [{ id: 'one', name: 'One', systemPrompt: 'synthetic', model: 'synthetic' }] } }] });
    let cookie = await f.login(); const headers = contextHeaders((await f.session(cookie)).recovery), body = { requestId: 'context-invitation-001', agentId: 'one' };
    const first = await f.request('conversations/group/invitations', { cookie, body, headers }); assert.equal(first.status, 202); const accepted = await first.json();
    const replayResponse = await f.request('conversations/group/invitations', { cookie, body, headers }); assert.equal(replayResponse.status, 202); const replay = await replayResponse.json(); assert.equal(replay.id, accepted.id); assert.equal(replay.replayed, true);
    const grant = f.portal.createPairing(), pair = await f.request('pair', { cookie, body: { code: grant.pairingCode } }); cookie = pair.headers.get('set-cookie').split(';')[0];
    const before = { jobs: f.portal.engine.snapshot(), metrics: f.store.metrics(), steps: f.store.db.prepare('SELECT * FROM mobile_execution_steps').all() };
    const stale = await f.request('conversations/group/invitations', { cookie, body, headers }); assert.equal(stale.status, 409); assert.equal((await stale.json()).error.code, 'SUBMISSION_CONTEXT_CHANGED');
    const missing = await f.request('conversations/group/invitations', { cookie, body, headers: { 'X-NativeSync-Entry-Id': headers['X-NativeSync-Entry-Id'] } }); assert.equal(missing.status, 409); assert.equal((await missing.json()).error.code, 'SUBMISSION_CONTEXT_CHANGED');
    assert.deepEqual({ jobs: f.portal.engine.snapshot(), metrics: f.store.metrics(), steps: f.store.db.prepare('SELECT * FROM mobile_execution_steps').all() }, before);
    assert.equal(before.jobs.length, 1); assert.equal(before.steps.length, 1); assert.equal(before.metrics.journalRows, 0); assert.equal(before.jobs[0].attempts, 0);
});
