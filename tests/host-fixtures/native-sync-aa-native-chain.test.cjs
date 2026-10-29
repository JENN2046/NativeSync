'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const http = require('node:http'), { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const express = require('express');
const source = path.resolve(__dirname, '..');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label) {
    const end = Date.now() + 12000;
    for (;;) { const result = await check(); if (result) return result; assert.ok(Date.now() < end, label); await delay(10); }
}
async function listen(server) { await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); return server.address().port; }
async function close(server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
function copyCode(root, relative, copied) {
    if (copied.has(relative)) return;
    copied.add(relative);
    const file = path.resolve(source, relative), target = path.resolve(root, relative);
    assert.ok(file.startsWith(source + path.sep) && target.startsWith(root + path.sep));
    const bytes = fs.readFileSync(file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, bytes);
    for (const match of bytes.toString('utf8').matchAll(/require\(['"](\.[^'"]+)['"]\)/g)) {
        const base = path.resolve(path.dirname(file), match[1]);
        const dep = [base, base + '.js', base + '.json', path.join(base, 'index.js')].find(p => fs.existsSync(p) && fs.statSync(p).isFile());
        if (dep && /\.(?:js|cjs|json)$/.test(dep)) copyCode(root, path.relative(source, dep), copied);
    }
}

// Real NativeSync routes, ChatCompletionHandler, parser/executor, PluginManager,
// and AgentAssistant run in a fresh code-only fixture. The model HTTP endpoint
// is synthetic. This is not server.js bootstrap, a physical device, or a real
// provider claim. No product method is replaced at runtime.
test('AA chain: accepted mobile request uses native Handler/tools/AA, keeps late result identity and never creates a callback chat reply', { timeout: 30000 }, async t => {
    const root = process.env.VCP_R21_AA_CRASH_ROOT || fs.mkdtempSync(path.join(os.tmpdir(), 'native-aa-chain-')), copied = new Set();
    if (process.env.VCP_R21_AA_CRASH_ROOT) assert.ok(path.basename(root).startsWith('native-aa-chain-crash-'));
    for (const file of ['Plugin.js', 'Plugin/NativeSync/native-sync.js', 'Plugin/AgentAssistant/AgentAssistant.js', 'modules/chatCompletionHandler.js', 'modules/apiBearerAuth.js']) copyCode(root, file, copied);
    fs.cpSync(path.join(source,'Plugin','NativeSync'),path.join(root,'Plugin','NativeSync'),{recursive:true,filter:file=>!['node_modules','config.env'].includes(path.basename(file))});
    for (const name of ['NativeSync', 'AgentAssistant']) fs.copyFileSync(path.join(source, 'Plugin', name, 'plugin-manifest.json'), path.join(root, 'Plugin', name, 'plugin-manifest.json'));
    const dependencies = path.dirname(path.dirname(require.resolve('express/package.json')));
    fs.mkdirSync(path.join(root, 'node_modules'));
    for (const base of [process.env.VCP_R21_AA_DEPENDENCIES, dependencies].filter(Boolean)) {
        for (const name of fs.readdirSync(base)) {
            if (name.startsWith('.')) continue;
            const target = path.join(root, 'node_modules', name);
            if (!fs.existsSync(target)) fs.symlinkSync(path.join(base, name), target, 'dir');
        }
    }
    fs.mkdirSync(path.join(root, 'config'), { recursive: true });
    fs.writeFileSync(path.join(root, 'config', 'tool-call-records.config.json'), JSON.stringify({ enabled: false, autoCleanupEnabled: false }));
    fs.writeFileSync(path.join(root, 'toolApprovalConfig.json'), JSON.stringify({ enabled: false, fuzzyToolMatching: false }));
    fs.mkdirSync(path.join(root, 'ToolConfigs'), { recursive: true });
    fs.writeFileSync(path.join(root, 'ToolConfigs/jev_tool_call_exp.json'), JSON.stringify({ virtualToolName: 'JEV', categories: {}, maxExpandedCalls: 1 }));
    fs.mkdirSync(path.join(root, 'TVStxt')); fs.writeFileSync(path.join(root, 'TVStxt/JevToolCallDecision.txt'), '');
    fs.writeFileSync(path.join(root, 'Plugin/AgentAssistant/config.json'), JSON.stringify({
        delegationMaxRounds: 2, delegationTimeout: 20000,
        agents: [{ baseName: 'SYNTHETIC_AA', chineseName: 'SyntheticAA', modelId: 'synthetic-aa', systemPrompt: 'SYNTHETIC_READ_ONLY_AA', maxOutputTokens: 128 }],
    }));
    const originalEnv = { ...process.env }, key = 'synthetic-native-aa-host-only', origin = 'https://synthetic-aa.invalid';
    const counts = { parentProvider: 0, aaProvider: 0, callbacks: 0 }, providerRequests = [];
    let releaseAA, aaEntered = false, manager, plugin, host, model, aaModule;
    const held = new Promise(resolve => { releaseAA = resolve; });
    t.after(async () => {
        releaseAA();
        await manager?.shutdownAllPlugins();
        manager?.toolApprovalManager?.shutdown();
        const records = require.cache[path.join(root, 'modules/toolCallRecordStore.js')]; records?.exports.shutdown();
        if (host) await close(host); if (model) await close(model);
        for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
        Object.assign(process.env, originalEnv);
        fs.rmSync(root, { recursive: true, force: true });
    });
    const toolRequest = '<<<[TOOL_REQUEST]>>>\ntool_name:「始」AgentAssistant「末」,\nagent_name:「始」SyntheticAA「末」,\nprompt:「始」Summarize the isolated synthetic document.「末」,\ntask_delegation:「始」true「末」\n<<<[END_TOOL_REQUEST]>>>';
    model = http.createServer(async (req, res) => {
        try {
            assert.equal(req.url, '/v1/chat/completions'); assert.equal(req.headers.authorization, 'Bearer ' + key);
            const chunks = []; for await (const b of req) chunks.push(b);
            const body = JSON.parse(Buffer.concat(chunks)); providerRequests.push({ model: body.model, requestId: body.requestId || null });
            let content;
            if (body.model === 'synthetic-aa') {
                counts.aaProvider++; aaEntered = true;
                if (process.env.VCP_R21_AA_CRASH_ROOT) {
                    const db = new (require('node:sqlite').DatabaseSync)(path.join(root, 'data/central.sqlite'));
                    const links = db.prepare('SELECT execution_id,native_task_id,invocation_id FROM mobile_native_tasks').all();
                    fs.writeFileSync(path.join(root, 'launch-proof.json'), JSON.stringify({ counts, links })); db.close();
                    // This actual child process exits after AA has issued its
                    // native HTTP request, before any result/report can exist.
                    process.exit(79);
                }
                await held; content = 'SYNTHETIC_AA_FINAL_REPORT\n[[Flowlock::Complete]]';
            }
            else { assert.equal(body.model, 'synthetic-parent'); counts.parentProvider++; content = counts.parentProvider === 1 ? toolRequest : 'PARENT_REPLY_SAVED_WHILE_AA_RUNNING'; }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ id: 'synthetic-response-' + providerRequests.length, object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }] }));
        } catch (e) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: e.message })); }
    });
    const modelPort = await listen(model), app = express(); app.set('trust proxy', true); app.use(express.json());
    host = http.createServer(app); const hostPort = await listen(host);
    const topic = { key: 'native-aa', ownerType: 'agent', ownerId: 'synthetic-parent', topicId: 'topic-aa', agentAlias: 'SyntheticParent', model: 'synthetic-parent', agentName: 'Synthetic Parent' };
    Object.assign(process.env, { NativeSyncEnabled: 'true', NativeSyncDataDir: path.join(root, 'data'), NativeMobileEnabled: 'true', NativeMobileOrigin: origin, NativeMobileTopics: JSON.stringify([topic]), NativeMobileExecutionTimeoutMs: '20000', PORT: String(hostPort), Key: key, DebugMode: 'false' });
    plugin = require(path.join(root, 'Plugin/NativeSync/native-sync.js'));
    plugin.setMobileHostAuthority({ agentManager: { isAgent: alias => alias === 'SyntheticParent', getAgentPrompt: async () => 'SYNTHETIC_PARENT' }, verifyKey: async value => value === key });
    manager = require(path.join(root, 'Plugin.js')); manager.setProjectBasePath(root); await manager.loadPlugins();
    assert.deepEqual([...manager.plugins.keys()].sort(), ['AgentAssistant', 'NativeSync']);
    aaModule = manager.getServiceModule('AgentAssistant'); assert.equal(typeof aaModule.processToolCall, 'function');
    const native = require(path.join(root, 'modules/requestExecutionContext.js'));
    const Handler = require(path.join(root, 'modules/chatCompletionHandler.js'));
    const handler = new Handler({ apiUrl: 'http://127.0.0.1:' + modelPort, apiKey: key, pluginManager: manager,
        activeRequests: new Map(), modelRedirectHandler: { redirectModelForBackend: model => model }, writeDebugLog: async () => {},
        webSocketServer: { broadcast() {} }, DEBUG_MODE: false, SHOW_VCP_OUTPUT: false, VCPToolCode: false,
        maxVCPLoopNonStream: 3, maxVCPLoopStream: 3, apiRetries: 1, apiRetryDelay: 0, apiConnectionTimeoutMs: 15000,
        RAGMemoRefresh: false, detectors: [], superDetectors: [], cachedEmojiLists: new Map(), enableRoleDivider: false,
    });
    app.post('/plugin-callback/AgentAssistant/:id', (req, res) => {
        counts.callbacks++; const dir = path.join(root, 'VCPAsyncResults'); fs.mkdirSync(dir, { recursive: true });
        // Deliberately untrusted callback evidence: this fixture mirrors the
        // legacy file location without giving it a NativeSync observation hook.
        fs.writeFileSync(path.join(dir, 'AgentAssistant-' + req.params.id + '.json'), JSON.stringify(req.body));
        res.json({ status: 'success' });
    });
    app.use('/mobile', (req, res, next) => plugin.handleMobile(req, res, next));
    app.use(require(path.join(root, 'modules/apiBearerAuth.js'))(key));
    app.post('/v1/chat/completions', native.middleware, (req,res)=>{const end=res.end;res.end=function(data,...args){if(res.statusCode>=400)console.error('SYNTHETIC_HOST_ERROR '+String(data));return end.call(this,data,...args);};return handler.handle(req,res);});
    manager.initializeServices(app, express.Router(), root);
    plugin.setExecutionEndpoint({ url: 'http://127.0.0.1:' + hostPort + '/v1/chat/completions', key });
    const request = async (url, { body, cookie, bearer = key } = {}) => {
        const r = await fetch('http://127.0.0.1:' + hostPort + url, { method: body === undefined ? 'GET' : 'POST', headers: { Origin: origin, 'X-Forwarded-Proto': 'https', 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...(bearer ? { Authorization: 'Bearer ' + bearer } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
        return { status: r.status, cookie: r.headers.get('set-cookie')?.split(';')[0], data: await r.json() };
    };
    const grant = await request('/api/plugins/NativeSync/mobile/pairing', { body: {} }); assert.equal(grant.status, 200);
    const paired = await request('/mobile/api/pair', { body: { code: grant.data.pairingCode }, bearer: null }); assert.equal(paired.status, 200); const cookie = paired.cookie;
    const payload = { requestId: 'native-chain-request-001', text: 'SYNTHETIC_DELEGATE_REQUEST' };
    const accepted = await request('/mobile/api/conversations/native-aa/messages', { body: payload, cookie, bearer: null }); assert.equal(accepted.status, 202);
    const query = new URLSearchParams({ ownerType: topic.ownerType, ownerId: topic.ownerId, topicId: topic.topicId });
    const list = async () => (await request('/api/plugins/NativeSync/mobile/executions?' + query)).data.executions;
    let lastObserved;const job = await until(async () => { const row = (await list()).find(j => j.id === accepted.data.id);lastObserved=row; return aaEntered && row?.state === 'completed' && row.nativeTasks?.[0]?.state === 'running' && row; }, 'parent reply completes while actual AA remains running').catch(e=>{console.error(JSON.stringify({syntheticDiagnostic:{counts,providerRequests,job:lastObserved}}));throw e;});
    assert.equal(job.nativeTasks.length, 1); const task = job.nativeTasks[0];
    assert.equal(task.executionId, job.id); assert.ok(task.invocationId); assert.equal(task.recordId, null); assert.equal(task.stepId, null);
    assert.equal(job.toolInvocations.length, 1); assert.equal(job.toolInvocations[0].state, 'returned'); assert.equal(job.toolInvocations[0].invocationId, task.invocationId);
    assert.equal(counts.parentProvider, 2); assert.equal(counts.aaProvider, 1);
    const before = plugin.snapshot().metrics;
    const replay = await request('/mobile/api/conversations/native-aa/messages', { body: payload, cookie, bearer: null });
    assert.equal(replay.data.id, job.id); assert.equal(replay.data.replayed, true);
    await request('/plugin-callback/AgentAssistant/' + task.nativeTaskId, { body: { requestId: task.nativeTaskId, status: 'Succeed', message: 'FORGED_CALLBACK_RESULT' }, bearer: null });
    assert.equal((await list()).find(j => j.id === job.id).nativeTasks[0].state, 'running');
    assert.deepEqual(plugin.snapshot().metrics, before);
    releaseAA();
    const complete = await until(async () => { const row = (await list()).find(j => j.id === job.id); return row?.nativeTasks?.[0]?.state === 'completed' && row; }, 'native report and persistent task projection');
    const resultPath = '/api/plugins/NativeSync/mobile/executions/' + job.id + '/native-tasks/' + task.nativeTaskId + '/result?';
    const result = await request(resultPath + query); assert.equal(result.status, 200); assert.match(result.data.content, /SYNTHETIC_AA_FINAL_REPORT/);
    assert.equal(createHash('sha256').update(result.data.content).digest('hex'), complete.nativeTasks[0].resultHash);
    assert.equal(result.data.task.nativeTaskId, task.nativeTaskId);
    assert.equal((await request(resultPath + new URLSearchParams({ ownerType: 'agent', ownerId: 'wrong', topicId: topic.topicId }))).status, 403);
    assert.equal((await request(resultPath + query, { bearer: null })).status, 401);
    const phone = await request('/mobile/api/conversations/native-aa', { cookie, bearer: null });
    assert.equal(phone.data.executions[0].nativeTasks[0].nativeTaskId, task.nativeTaskId);
    assert.equal(phone.data.messages.length, 2); assert.equal(counts.parentProvider, 2); assert.equal(counts.aaProvider, 1);
    assert.deepEqual(plugin.snapshot().metrics, before);
    // Reopen just NativeSync while the native AA provider remains registered.
    await plugin.shutdown();
    await plugin.initialize({ NativeSyncEnabled: true, NativeSyncDataDir: path.join(root, 'data'), NativeMobileEnabled: true, NativeMobileOrigin: origin, NativeMobileTopics: JSON.stringify([topic]) });
    const recovered = (await list()).find(j => j.id === job.id);
    assert.equal(recovered.nativeTasks[0].nativeTaskId, task.nativeTaskId); assert.equal(recovered.nativeTasks[0].state, 'completed');
    assert.equal(counts.parentProvider, 2); assert.equal(counts.aaProvider, 1);
    t.diagnostic(JSON.stringify({ level: 'native-modules-with-synthetic-provider', executionId: job.id, requestId: job.requestId, delegationId: task.nativeTaskId, invocationId: task.invocationId, recordId: task.recordId, aaStateBeforeRelease: task.state, aaStateAfterRelease: recovered.nativeTasks[0].state, parentStateWhileAAHeld: job.state, toolState: job.toolInvocations[0].state, providerCalls: counts.parentProvider + counts.aaProvider, aaProviderCalls: counts.aaProvider, journalRows: before.journalRows, realProviderCalls: 0 }));
});

test('AA chain crash: real AA launch followed by child process exit restores unknown with the original delegation and no new dispatch', { timeout: 30000 }, async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'native-aa-chain-crash-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const child = spawnSync(process.execPath, ['--test', '--test-isolation=none', '--test-reporter=tap', '--test-name-pattern=^AA chain:', __filename], {
        env: { ...process.env, VCP_R21_AA_CRASH_ROOT: root }, encoding: 'utf8', timeout: 20000
    });
    assert.equal(child.status, 79, child.stdout + child.stderr);
    const evidence = JSON.parse(fs.readFileSync(path.join(root, 'launch-proof.json'), 'utf8'));
    assert.equal(evidence.counts.aaProvider, 1); assert.equal(evidence.links.length, 1);
    const original = evidence.links[0]; assert.match(original.native_task_id, /^aa-delegation-/);
    const { CentralStore } = require('../Plugin/NativeSync/sync/centralStore');
    const { ConversationExecution } = require('../Plugin/NativeSync/mobile/execution');
    const store = new CentralStore(path.join(root, 'data/central.sqlite'));
    const engine = new ConversationExecution({ store, topics: [{ key: 'native-aa', ownerType: 'agent', ownerId: 'synthetic-parent', topicId: 'topic-aa', agentAlias: 'SyntheticParent', model: 'synthetic-parent' }], agentManager: { isAgent: () => true } });
    try {
        const before = store.metrics(); await engine.nativeTasks.reconcile(true);
        const job = engine.public(engine.get(original.execution_id), 'unowned-observer');
        assert.equal(job.attempts, 1); assert.equal(job.nativeTasks.length, 1);
        assert.equal(job.nativeTasks[0].nativeTaskId, original.native_task_id);
        assert.equal(job.nativeTasks[0].invocationId, original.invocation_id);
        assert.equal(job.nativeTasks[0].state, 'unknown'); assert.equal(job.nativeTasks[0].reviewRequired, true);
        assert.equal(job.nativeTasks[0].resultRef, null); assert.ok(engine.dependencyHeld('native-aa'));
        assert.equal(engine.inFlight.size, 0); assert.deepEqual(store.metrics(), before);
        const archive = path.join(root, 'file/document/AgentTask');
        assert.equal(fs.existsSync(archive) ? fs.readdirSync(archive).filter(name => name.endsWith('.native.json')).length : 0, 0);
        t.diagnostic(JSON.stringify({ level: 'native-modules-child-process-exit', exitCode: 79, delegationId: original.native_task_id, invocationId: original.invocation_id, aaProviderCallsBeforeExit: 1, recoveredState: 'unknown', automaticDispatchesAfterReopen: 0, realProviderCalls: 0 }));
    } finally { await engine.close(); store.close(); }
});
