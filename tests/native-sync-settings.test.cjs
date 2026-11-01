'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
const { pathToFileURL } = require('node:url');
const CHAT = path.join(process.env.NATIVESYNC_TEST_HOSTS, 'VCPChat');
const { NativeSyncSettings } = require(CHAT + '/modules/nativeSyncSettings/service.cjs');
const { HistoryMutationQueue } = require(CHAT + '/modules/services/historyMutationQueue');
const { NativeSyncAdapter } = require(CHAT + '/modules/services/nativeSync/adapter');
const { createNativeSyncRuntime } = require(CHAT + '/modules/services/nativeSync/runtime');
const d = { itemId: 'one', itemType: 'agent', topicId: 'topic' };
async function fixture(t,{source=false}={}) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nativesync-settings-'));
    const file = path.join(root, '.native-sync/connection.json'), history = path.join(root, 'UserData/one/topics/topic/history.json');
    const settings = { vcpServerUrl: 'https://synthetic.invalid/v1/chat/completions', vcpApiKey: 'SYNTHETIC_PRIVATE_KEY' };
    const queue = new HistoryMutationQueue({ userDataDir: path.join(root, 'UserData'), logger: { warn() {} } });
    await fs.mkdir(path.dirname(history), { recursive: true }); await fs.writeFile(history, '[]');
    await fs.mkdir(path.join(root, 'Agents/one'), { recursive: true });
    await fs.writeFile(path.join(root, 'Agents/one/config.json'), JSON.stringify({ name: 'One', systemPrompt: 'PRIVATE_PROMPT', topics: [{ id: 'topic', name: 'Topic' }] }));
    const requests = [];
    const send = async (route, options) => {
        requests.push({ route, options });
        if(source&&route.includes('/source/info'))return {version:1,sourceId:'sourceA',deviceId:new URL(route,'https://synthetic.invalid').searchParams.get('deviceId'),spaceId:'spaceA',revision:0,executionMode:'all-supported',executionConfigPaging:true};
        if(source&&route.includes('/source/verify-state'))return {verified:true};
        if (route.includes('execution-configs')) return { topics: [{ ownerType: 'agent', ownerId: 'one', topicId: 'topic' }] };
        return route.includes('/pull') ? { events: [], nextSeq: 0, headSeq: 0, hasMore: false } : { headSeq: 0 };
    };
    const make = () => new NativeSyncSettings({ appDataRoot: root, historyQueue: () => queue, readSettings: async () => settings, requestFactory: connection => { assert.equal(connection.url, 'https://synthetic.invalid'); return send; } });
    let service = make(), adapter, runtime;
    const f = { root, file, history, settings, queue, requests, send, get service() { return service; }, async reopen() { await service.close(); service = make(); } };
    f.preview = async () => service.preview({ expectedRevision: (await service.overview()).revision, topics: [d] });
    f.save = async approval => service.save({ expectedRevision: (await service.overview()).revision, enabled: true, confirmed: true, approvalToken: approval.token });
    f.bind = async () => {
        const a = await f.preview(); await f.save(a); const config = JSON.parse(await fs.readFile(file));
        adapter = await NativeSyncAdapter.open({ queue, statePath: path.join(root, '.native-sync/state.json'), url: 'https://synthetic.invalid', token: 'synthetic', deviceId: config.deviceId, topics: [d], request: send });
        await f.reopen(); return config;
    };
    f.disableRuntime = async () => { await adapter.close(); adapter = null; runtime = await createNativeSyncRuntime({ queue, appDataRoot: root, readSettings: async () => settings, request: send }); await f.reopen(); };
    t.after(async () => { await service.close(); await runtime?.close(); await adapter?.close(); await queue.dispose(); await fs.rm(root, { recursive: true, force: true }); });
    return f;
}

test('setup preview is readonly and metadata-only; explicit confirmation saves no credential and no state', async t => {
    const f = await fixture(t); await fs.writeFile(f.history, JSON.stringify([{ id: 'm1', role: 'user', content: 'PRIVATE_HISTORY', timestamp: 1 }]));
    const bytes = await fs.readFile(f.history), view = await f.service.overview();
    assert.equal(view.revision, 'missing'); assert.equal(view.choices.length, 1);
    const proof = await f.preview(); assert.equal(proof.localMessages, 1); assert.equal(proof.historyWritten, false); assert.equal(proof.centralWritten, false);
    assert.ok(!JSON.stringify([view, proof]).includes('PRIVATE_'));
    await assert.rejects(f.service.save({ expectedRevision: 'missing', enabled: true, approvalToken: proof.token }), { code: 'SETUP_CONFIRMATION_REQUIRED' });
    await assert.rejects(fs.access(f.file), { code: 'ENOENT' });
    const result = await f.save(proof); assert.equal(result.restartRequired, true);
    const saved = JSON.parse(await fs.readFile(f.file)); assert.equal(saved.credentialSource, 'existing-vcp-settings'); assert.ok(!JSON.stringify(saved).includes('PRIVATE_')); assert.ok(saved.deviceId);
    assert.deepEqual(await fs.readFile(f.history), bytes); await assert.rejects(fs.access(path.join(f.root, '.native-sync/state.json')), { code: 'ENOENT' });
    assert.ok(f.requests.every(r => !r.options?.body));
});

test('history change invalidates approval without writing configuration', async t => {
    const f = await fixture(t), proof = await f.preview(); await fs.writeFile(f.history, '[{"id":"later","role":"user","content":"later"}]');
    await assert.rejects(f.save(proof), { code: 'APPROVED_HISTORY_CHANGED' }); await assert.rejects(fs.access(f.file), { code: 'ENOENT' });
});

test('external config change and server credential change require a fresh preview', async t => {
    const f = await fixture(t), proof = await f.preview(); f.settings.vcpApiKey = 'ANOTHER_PRIVATE_KEY';
    await assert.rejects(f.save(proof), { code: 'SETUP_CONNECTION_CHANGED' });
    await fs.mkdir(path.dirname(f.file), { recursive: true }); await fs.writeFile(f.file, '{"enabled":false}');
    await assert.rejects(f.service.save({ expectedRevision: 'missing', enabled: true, confirmed: true, approvalToken: proof.token }), { code: 'SETUP_CONFIG_CHANGED' });
    assert.equal(await fs.readFile(f.file, 'utf8'), '{"enabled":false}');
});

test('selection cannot contain duplicates, missing topics, excess topics or an arbitrary server', async t => {
    const f = await fixture(t);
    await assert.rejects(f.service.preview({ expectedRevision: 'missing', topics: [d, d] }), { code: 'DUPLICATE_SELECTED_TOPIC' });
    await assert.rejects(f.service.preview({ expectedRevision: 'missing', topics: [{ ...d, topicId: 'missing' }] }), { code: 'SETUP_TOPIC_UNAVAILABLE' });
    await assert.rejects(f.service.preview({ expectedRevision: 'missing', topics: Array(9).fill(d) }), { code: 'INVALID_EXECUTION_SELECTION' });
    await assert.rejects(f.service.preview({ expectedRevision: 'missing', topics: [d], serverUrl: 'https://foreign.invalid' }), { code: 'INVALID_EXECUTION_SELECTION' });
    assert.equal(f.requests.length, 0);
});

test('HTTPS authority is inherited from saved desktop settings and embedded credentials are not exposed', async t => {
    const f = await fixture(t); f.settings.vcpServerUrl = 'http://127.0.0.1:1234'; await assert.rejects(f.preview(), { code: 'SYNC_HTTPS_REQUIRED' });
    await fs.mkdir(path.dirname(f.file), { recursive: true });
    await fs.writeFile(f.file, JSON.stringify({ enabled: false, topics: [], serverUrl: 'https://name:PRIVATE_PASSWORD@synthetic.invalid/' }));
    const view = await f.service.overview(); assert.ok(!JSON.stringify(view).includes('PRIVATE_PASSWORD')); assert.equal(view.serverOrigin, null); assert.equal(view.error, 'SYNC_HTTPS_REQUIRED');
});

test('bound disable saves only desired configuration; reenabling preserves device, state bytes and cursor', async t => {
    const f = await fixture(t), config = await f.bind(), statePath = path.join(f.root, '.native-sync/state.json'), before = await fs.readFile(statePath);
    const view = await f.service.overview(); assert.equal(view.current.active, true); assert.equal(view.bindingLocked, true);
    await f.service.save({ expectedRevision: view.revision, enabled: false });
    let next = await f.service.overview(); assert.equal(next.enabled, false); assert.equal(next.current.active, true); assert.equal(next.restartRequired, true); assert.deepEqual(await fs.readFile(statePath), before);
    await f.disableRuntime(); next = await f.service.overview(); assert.equal(next.current.active, false); assert.equal(next.current.readOnly, true);
    const proof = await f.preview(); assert.equal(proof.existingState, true); await f.save(proof);
    assert.equal(JSON.parse(await fs.readFile(f.file)).deviceId, config.deviceId); assert.deepEqual(await fs.readFile(statePath), before);
});

test('a bound selection cannot silently expand or change server', async t => {
    const f = await fixture(t); await f.bind();
    await assert.rejects(f.service.preview({ expectedRevision: (await f.service.overview()).revision, topics: [{ ...d, topicId: 'another' }] }), { code: 'SETUP_SCOPE_CHANGE_REQUIRED' });
    f.settings.vcpServerUrl = 'https://another.invalid/v1/chat/completions'; await assert.rejects(f.preview(), { code: 'DESKTOP_BACKEND_IDENTITY_MISMATCH' });
});

test('resuming an existing history-only binding does not enable private execution configuration publication', async t => {
    const f = await fixture(t), config = await f.bind();
    delete config.publishExecutionConfigs;
    await fs.writeFile(f.file, JSON.stringify(config)); await f.reopen();
    await f.save(await f.preview());
    assert.equal(JSON.parse(await fs.readFile(f.file)).publishExecutionConfigs, false);
});

test('Source mode stays readonly and corrupt state is never reset', async t => {
    const f = await fixture(t); await fs.mkdir(path.dirname(f.file), { recursive: true });
    const config = JSON.stringify({ enabled: true, scopeMode: 'source', topics: [], deviceId: 'source-device', serverUrl: 'https://synthetic.invalid' }); await fs.writeFile(f.file, config);
    await assert.rejects(f.service.save({ expectedRevision: (await f.service.overview()).revision, enabled: false }), { code: 'SETUP_SOURCE_READ_ONLY' }); assert.equal(await fs.readFile(f.file, 'utf8'), config);
    await fs.writeFile(f.file, JSON.stringify({ enabled: false, topics: [d], deviceId: 'device', serverUrl: 'https://synthetic.invalid' }));
    const state = path.join(f.root, '.native-sync/state.json'); await fs.writeFile(state, '{');
    assert.equal((await f.service.overview()).error, 'INVALID_SYNC_STATE'); await assert.rejects(f.preview(), { code: 'INVALID_SYNC_STATE' }); assert.equal(await fs.readFile(state, 'utf8'), '{');
});

test('configuration directory aliases and hard-linked histories are rejected before reading their content', async t => {
    const f = await fixture(t); const other = path.join(f.root, 'other'); await fs.mkdir(other); await fs.symlink(other, path.dirname(f.file));
    await assert.rejects(f.preview(), { code: 'OWNER_PATH_ALIAS' }); await fs.unlink(path.dirname(f.file));
    await fs.link(f.history, path.join(f.root, 'linked-history.json')); await assert.rejects(f.preview(), { code: 'OWNER_PATH_ALIAS' });
});

test('native topic deletion after preview cannot be confirmed', async t => {
    const f = await fixture(t), proof = await f.preview(); await fs.writeFile(path.join(f.root, 'Agents/one/config.json'), '{"name":"One","topics":[]}');
    await assert.rejects(f.save(proof), { code: 'SETUP_TOPIC_UNAVAILABLE' }); await assert.rejects(fs.access(f.file), { code: 'ENOENT' });
});

test('a recovery fence with missing state is never reclassified as fresh onboarding', async t => {
    const f = await fixture(t);
    f.queue.configureSync({ isRecoveryFence: true, diagnostics: () => ({ readOnly: true, degraded: 'SYNC_STARTUP_RECOVERY_REQUIRED' }) });
    await assert.rejects(f.preview(), { code: 'SETUP_RECOVERY_REQUIRED' });
    await assert.rejects(fs.access(f.file), { code: 'ENOENT' });
});

test('the Feature IPC accepts only the owned main frame and cleans up all registrations', async t => {
    const { registerIpc } = require(CHAT + '/modules/nativeSyncSettings/index');
    const handlers = new Map(), frame = { url: pathToFileURL(path.join(CHAT, 'main.html')).href }, contents = { mainFrame: null }; contents.mainFrame = frame;
    let calls = 0, disposed = false;
    const handle = registerIpc({ projectRoot: CHAT, mainWindow: { isDestroyed: () => false, webContents: contents } }, { overview: async () => { calls++; return { configured: false }; }, close: async () => { disposed = true; } }, { handle: (name, fn) => handlers.set(name, fn), removeHandler: name => handlers.delete(name) });
    t.after(() => handle.dispose());
    const query = handlers.get('native-sync-setup:overview');
    assert.equal((await query({ sender: contents, senderFrame: { url: frame.url } })).error, 'SETUP_WINDOW_REQUIRED');
    assert.equal((await query({ sender: {}, senderFrame: frame })).error, 'SETUP_WINDOW_REQUIRED'); assert.equal(calls, 0);
    assert.equal((await query({ sender: contents, senderFrame: frame })).success, true); assert.equal(calls, 1);
    await handle.dispose(); assert.equal(handlers.size, 0); assert.equal(disposed, true);
});

test('full-source preview explicitly confirms future history and execution while saving only owned configuration',async t=>{
 const f=await fixture(t,{source:true}),before=await fs.readFile(f.history),view=await f.service.overview();
 const proof=await f.service.preview({expectedRevision:view.revision,scopeMode:'source',sourceId:'sourceA'});assert.equal(proof.sourceMode,true);assert.equal(proof.agentCount,1);assert.equal(proof.selectedTopics,1);assert(!JSON.stringify(proof).includes('PRIVATE_'));
 await f.save(proof);const saved=JSON.parse(await fs.readFile(f.file));assert.equal(saved.scopeMode,'source');assert.equal(saved.executionMode,'all-supported');assert.deepEqual(saved.topics,[]);assert.equal(saved.deviceId,view.deviceId);assert.deepEqual(await fs.readFile(f.history),before);await assert.rejects(fs.access(path.join(f.root,'.native-sync/state.json')),{code:'ENOENT'});
});
test('selected-to-source enrollment preserves state and device; unsettled local work cannot be converted',async t=>{
 const f=await fixture(t,{source:true}),old=await f.bind(),stateFile=path.join(f.root,'.native-sync/state.json'),before=await fs.readFile(stateFile);
 const proof=await f.service.preview({expectedRevision:(await f.service.overview()).revision,scopeMode:'source',sourceId:'sourceA'});await f.save(proof);assert.deepEqual(await fs.readFile(stateFile),before);assert.equal(JSON.parse(await fs.readFile(f.file)).deviceId,old.deviceId);assert.equal((await f.service.overview()).error,undefined);assert.equal((await f.service.overview()).restartRequired,true);
 const g=await fixture(t,{source:true});await g.bind();await g.queue.mutate(d,rows=>[...rows,{id:'pending-local',role:'user',content:'synthetic',timestamp:1}]);const pending=await fs.readFile(path.join(g.root,'.native-sync/state.json'));
 await assert.rejects(g.service.preview({expectedRevision:(await g.service.overview()).revision,scopeMode:'source',sourceId:'sourceA'}),{code:'SOURCE_SCOPE_NOT_SETTLED'});assert.deepEqual(await fs.readFile(path.join(g.root,'.native-sync/state.json')),pending);
});
