'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { identity, stable, fail } = require('../services/nativeSync/protocol');
const { resolveConnection } = require('../services/nativeSync/connection');
const { initialImport } = require('../services/nativeSync/initialImport');
const { createSyncRequest } = require('../services/nativeSync/runtime');
const { durableJson } = require('../utils/durableJson');

const hash = value => createHash('sha256').update(value).digest('hex');
const descriptor = value => {
    const d = { itemId: value?.itemId, itemType: value?.itemType || 'agent', topicId: value?.topicId };
    identity({ ownerType: d.itemType, ownerId: d.itemId, topicId: d.topicId, msgId: '_' });
    return d;
};
const topicKey = d => JSON.stringify([d.itemType || 'agent', d.itemId, d.topicId]);
const sameTopics = (a, b) => stable(a.map(descriptor).map(topicKey).sort()) === stable(b.map(descriptor).map(topicKey).sort());
const safeCode = code => /^[A-Z][A-Z0-9_]{0,79}$/.test(code || '') ? code : 'SETUP_UNAVAILABLE';

class NativeSyncSettings {
    constructor({ appDataRoot, historyQueue, readSettings, requestFactory = createSyncRequest }) {
        this.root = path.resolve(appDataRoot);
        this.queue = historyQueue;
        this.readSettings = readSettings;
        this.requestFactory = requestFactory;
        this.file = path.join(this.root, '.native-sync', 'connection.json');
        this.approval = null;
        this.deviceDraft=randomUUID();
        this.tail = Promise.resolve();
        this.closed = false;
        // Keep a failed startup baseline distinct from an unconfigured startup.
        // A later refresh can inspect a corrected file, but still requires restart.
        this.initial = this.config().catch(() => ({ value: null, unreadable: true }));
    }

    async owned(file, { optional = false, limit, code = 'SETUP_FILE_INVALID' } = {}) {
        if (!path.resolve(file).startsWith(this.root + path.sep)) throw fail('OWNER_PATH_ALIAS');
        let current = path.parse(this.root).root;
        for (const segment of path.resolve(file).slice(current.length).split(path.sep)) {
            current = path.join(current, segment);
            try {
                const s = await fs.lstat(current);
                if (s.isSymbolicLink() || (s.isFile() && s.nlink !== 1)) throw fail('OWNER_PATH_ALIAS');
            } catch (error) {
                if (optional && error.code === 'ENOENT') return null;
                throw error;
            }
        }
        const stat = await fs.lstat(file);
        if (!stat.isFile() || (limit && stat.size > limit)) throw fail(code);
        const bytes = await fs.readFile(file);
        let value;
        try { value = JSON.parse(bytes); } catch { throw fail(code); }
        return { value, bytes, revision: hash(bytes) };
    }

    async config() {
        const file = await this.owned(this.file, { optional: true, limit: 65536, code: 'INVALID_SYNC_CONNECTION' });
        if (file && (!file.value || typeof file.value !== 'object' || Array.isArray(file.value))) throw fail('INVALID_SYNC_CONNECTION');
        return { value: file?.value || null, revision: file?.revision || 'missing' };
    }

    async binding(config) {
        const file = await this.owned(path.join(this.root, '.native-sync', 'state.json'), { optional: true, code: 'INVALID_SYNC_STATE' });
        if (!file) {
            if (this.queue()?.syncPolicy?.isRecoveryFence) throw fail('SETUP_RECOVERY_REQUIRED');
            return null;
        }
        const state = file.value;
        if (!state || ![1, 2, 3].includes(state.version) || !state.deviceId || !Array.isArray(state.topics)) throw fail('INVALID_SYNC_STATE');
        const stagedSource=config?.scopeMode==='source'&&config.fullSelectionApproved===true&&config.sourceScope?.mode==='full'&&config.sourceRoot===this.root&&typeof config.sourceId==='string'&&typeof config.spaceId==='string';
        if (!config || state.deviceId !== config.deviceId || (!state.source && !stagedSource && !sameTopics(state.topics, config.topics || []))) throw fail('SETUP_BINDING_MISMATCH');
        if (state.source && config.scopeMode !== 'source') throw fail('SETUP_BINDING_MISMATCH');
        return { deviceId: state.deviceId, topics: state.topics.map(descriptor), source: Boolean(state.source) };
    }

    async catalog() {
        const result = [];
        for (const [folder, itemType] of [['Agents', 'agent'], ['AgentGroups', 'group']]) {
            const directory = path.join(this.root, folder);
            let entries;
            try {
                const s = await fs.lstat(directory);
                if (s.isSymbolicLink()) throw fail('OWNER_PATH_ALIAS');
                entries = await fs.readdir(directory, { withFileTypes: true });
            } catch (e) { if (e.code === 'ENOENT') continue; throw e; }
            for (const entry of entries) {
                if (!entry.isDirectory()) continue;
                const config = await this.owned(path.join(directory, entry.name, 'config.json'), { optional: true });
                if (!config) continue;
                for (const topic of config.value.topics || []) {
                    const d = descriptor({ itemId: entry.name, itemType, topicId: topic.id });
                    // Metadata only. Prompts, model credentials and history never cross this IPC.
                    result.push({ ...d, ownerName: String(config.value.name || entry.name), topicName: String(topic.name || topic.id) });
                }
            }
        }
        return result.sort((a, b) => a.ownerName.localeCompare(b.ownerName) || a.topicName.localeCompare(b.topicName));
    }

    async endpoint() {
        const settings = await this.readSettings();
        let url;
        try { url = new URL(settings.vcpServerUrl); } catch { throw fail('SYNC_HTTPS_REQUIRED'); }
        if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw fail('SYNC_HTTPS_REQUIRED');
        if (typeof settings.vcpApiKey !== 'string' || !settings.vcpApiKey) throw fail('EXISTING_DESKTOP_KEY_REQUIRED');
        return { origin: url.origin, credentialHash: hash(settings.vcpApiKey) };
    }

    async overview() {
        const result = { configured: false, enabled: false, revision: null, choices: [], topics: [], bindingLocked: false, sourceMode: false, restartRequired: false };
        try {
            const config = await this.config(), initial = await this.initial;
            result.revision = config.revision;
            result.configured = Boolean(config.value);
            result.enabled = config.value?.enabled === true;
            result.sourceMode = config.value?.scopeMode === 'source';
            result.fullSource=result.sourceMode&&config.value.fullSelectionApproved===true&&typeof config.value.sourceId==='string'&&typeof config.value.spaceId==='string'&&!require('../services/nativeSync/sourceScope').normalizeScope(config.value.sourceScope);
            result.sourceId=config.value?.sourceId||'';result.deviceId=config.value?.deviceId||this.deviceDraft;
            result.topics = (config.value?.topics || []).map(descriptor);
            result.bindingLocked = Boolean(await this.binding(config.value));
            result.restartRequired = initial.unreadable === true || stable(config.value) !== stable(initial.value);
            result.choices = await this.catalog();
            result.serverOrigin = null;
            if (config.value?.serverUrl) {
                const url = new URL(config.value.serverUrl);
                if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw fail('SYNC_HTTPS_REQUIRED');
                result.serverOrigin = url.origin;
            }
            try { result.backendOrigin = (await this.endpoint()).origin; } catch (e) { result.connectionError = safeCode(e.code); }
        } catch (e) { result.error = safeCode(e.code); }
        const policy = this.queue()?.syncPolicy;
        const d = policy?.diagnostics?.();
        result.current = {
            active: Boolean(policy && !policy.isRecoveryFence), readOnly: d?.readOnly === true,
            degraded: d?.degraded ? safeCode(d.degraded) : null,
            configurationError: d?.configurationError ? safeCode(d.configurationError) : null,
            attachmentError: d?.attachmentError ? safeCode(d.attachmentError) : null,
            pendingOperations: Number.isSafeInteger(d?.outboxSize) ? d.outboxSize : null,
            buffered: Number.isSafeInteger(d?.inboundBuffered) ? d.inboundBuffered : null,
            conflicts: Array.isArray(d?.conflicts) ? d.conflicts.length : null,
            source:d?.source?{agents:d.source.agents,topics:d.source.topics,pendingImports:d.source.pendingImports,completedImports:d.source.completedImports,directoryErrors:d.source.directoryErrors.length,configurationPending:d.source.configurationPending??null,configurationErrors:d.source.configurationErrors??null}:null,
        };
        return result;
    }

    serialize(operation) {
        if (this.closed) return Promise.reject(fail('SYNC_BRIDGE_CLOSED'));
        const p = this.tail.then(() => { if (this.closed) throw fail('SYNC_BRIDGE_CLOSED'); return operation(); });
        this.tail = p.catch(() => {});
        return p;
    }

    preview(input) { return this.serialize(() => this.prepare(input)); }
    async prepare(input) {
        this.approval = null;
        if(input?.scopeMode==='source')return this.prepareSource(input);
        if (!input || Object.keys(input).some(k => !['expectedRevision', 'topics'].includes(k)) || !Array.isArray(input.topics) || !input.topics.length || input.topics.length > 8) throw fail('INVALID_EXECUTION_SELECTION');
        const current = await this.config();
        if (input.expectedRevision !== current.revision) throw fail('SETUP_CONFIG_CHANGED');
        if (current.value?.scopeMode === 'source') throw fail('SETUP_SOURCE_READ_ONLY');
        const binding = await this.binding(current.value), topics = input.topics.map(descriptor);
        if (new Set(topics.map(topicKey)).size !== topics.length) throw fail('DUPLICATE_SELECTED_TOPIC');
        if (binding && !sameTopics(binding.topics, topics)) throw fail('SETUP_SCOPE_CHANGE_REQUIRED');
        const choices = await this.catalog();
        for (const d of topics) if (!choices.some(c => topicKey(c) === topicKey(d))) throw fail('SETUP_TOPIC_UNAVAILABLE');
        const physical = topics.map(d => this.queue().getHistoryPath(d.itemId, d.topicId));
        if (new Set(physical.map(f => process.platform === 'win32' ? f.toLowerCase() : f)).size !== physical.length) throw fail('OWNER_PATH_CONFLICT');
        const endpoint = await this.endpoint();
        if (binding && new URL(current.value.serverUrl).origin !== endpoint.origin) throw fail('DESKTOP_BACKEND_IDENTITY_MISMATCH');
        const next = { ...(current.value || {}), version: 1, enabled: true, scopeMode: 'selected', historySelectionApproved: true,
            deviceId: current.value?.deviceId || randomUUID(), topics, serverUrl: endpoint.origin, credentialSource: 'existing-vcp-settings',
            publishCatalog: current.value?.publishCatalog !== false, publishExecutionConfigs: current.value ? current.value.publishExecutionConfigs === true : true,
            syncAttachments: current.value?.syncAttachments === true };
        if (!binding) {
            next.approvedHistory = [];
            for (const d of topics) {
                const record = await this.queue().run(d, () => this.owned(this.queue().getHistoryPath(d.itemId, d.topicId), { code: 'INVALID_HISTORY' }));
                if (!Array.isArray(record.value)) throw fail('INVALID_HISTORY');
                next.approvedHistory.push({ ...d, rawFileSha256: record.revision });
            }
        }
        const connection = await resolveConnection(next, { appDataRoot: this.root, readSettings: this.readSettings });
        const send = this.requestFactory(connection);
        await send('/api/v1/sync/status');
        if (next.publishCatalog || next.publishExecutionConfigs) {
            const configured = await send('/api/plugins/NativeSync/mobile/execution-configs');
            for (const d of topics) if (!configured.topics?.some(t => t.ownerType === d.itemType && t.ownerId === d.itemId && t.topicId === d.topicId)) throw fail('SETUP_SERVER_TOPIC_REQUIRED');
        }
        const proof = binding ? { existingState: true, selectedTopics: topics.length } : await initialImport({ queue: this.queue(), appDataRoot: this.root, connection, request: (route, body) => send(route, { body }) });
        const token = randomUUID();
        this.approval = { token, at: Date.now(), next, revision: current.revision, credentialHash: endpoint.credentialHash, hadBinding: Boolean(binding) };
        return { token, serverOrigin: endpoint.origin, ...proof, topics: topics.map(d => choices.find(c => topicKey(c) === topicKey(d))) };
    }

    async sourceCheck(next,current){
        const file=await this.owned(path.join(this.root,'.native-sync','state.json'),{optional:true,code:'INVALID_SYNC_STATE'}),state=file?.value;
        if(state&&!state.source){
            if(state.version!==3||state.outbox?.length||state.inbox?.length||state.pending||Object.keys(state.localCommits||{}).length||Object.keys(state.drift||{}).length)throw fail('SOURCE_SCOPE_NOT_SETTLED');
        }
        const connection=await resolveConnection(next,{appDataRoot:this.root,readSettings:this.readSettings}),send=this.requestFactory(connection);
        const source=await require('../services/nativeSync/sourceSync').SourceSync.verify(connection,state,send);
        return source;
    }
    async prepareSource(input){
        if(Object.keys(input).some(k=>!['expectedRevision','scopeMode','sourceId'].includes(k))||!/^[A-Za-z0-9_-]{1,96}$/.test(input.sourceId||''))throw fail('FULL_SOURCE_BINDING_REQUIRED');
        const current=await this.config();if(input.expectedRevision!==current.revision)throw fail('SETUP_CONFIG_CHANGED');
        const binding=await this.binding(current.value),endpoint=await this.endpoint();
        if(binding&&new URL(current.value.serverUrl).origin!==endpoint.origin)throw fail('DESKTOP_BACKEND_IDENTITY_MISMATCH');
        const settings=await this.readSettings(),deviceId=current.value?.deviceId||this.deviceDraft;
        const probe={scopeMode:'source',sourceId:input.sourceId,deviceId,url:endpoint.origin,token:settings.vcpApiKey,topics:[]};
        const info=await this.requestFactory(probe)('/api/v1/sync/source/info?'+new URLSearchParams({sourceId:input.sourceId,deviceId}));
        if(info.sourceId!==input.sourceId||info.deviceId!==deviceId||info.executionMode!=='all-supported'||info.executionConfigPaging!==true)throw fail('SOURCE_EXECUTION_NOT_APPROVED');
        const next={...(current.value||{}),version:1,enabled:true,scopeMode:'source',fullSelectionApproved:true,sourceId:input.sourceId,deviceId,spaceId:info.spaceId,sourceRoot:this.root,sourceScope:{mode:'full'}, scopeTransition: info.scope ? { opId: require('crypto').randomUUID(), expectedScopeHash: require('../services/nativeSync/sourceScope').hashScope(info.scope) } : undefined,topics:[],executionTopics:[],executionMode:'all-supported',serverUrl:endpoint.origin,credentialSource:'existing-vcp-settings',publishCatalog:true,publishExecutionConfigs:true,syncAttachments:true};
        await this.sourceCheck(next,current);
        const read=folder=>async id=>(await this.owned(path.join(this.root,folder,id,'config.json'))).value;
        const directory=await require('../services/nativeSync/sourceDirectory').sourceDirectory({appDataRoot:this.root,readAgentConfig:read('Agents'),readGroupConfig:read('AgentGroups'),connection:{sourceScope:{mode:'full'}}});
        const token=randomUUID();this.approval={token,at:Date.now(),next,revision:current.revision,credentialHash:endpoint.credentialHash,hadBinding:Boolean(binding),source:true};
        return {token,sourceMode:true,sourceId:next.sourceId,serverOrigin:endpoint.origin,selectedTopics:directory.topics.length,agentCount:directory.agents.filter(a=>a.ownerType==='agent').length,groupCount:directory.agents.filter(a=>a.ownerType==='group').length,directoryErrors:directory.errors.length,existingState:Boolean(binding)};
    }
    save(input) { return this.serialize(() => this.persist(input)); }
    async persist(input) {
        if (!input || Object.keys(input).some(k => !['expectedRevision', 'enabled', 'approvalToken', 'confirmed'].includes(k)) || typeof input.enabled !== 'boolean') throw fail('INVALID_SYNC_CONNECTION');
        const current = await this.config();
        if (input.expectedRevision !== current.revision) throw fail('SETUP_CONFIG_CHANGED');
        if (current.value?.scopeMode === 'source'&&!this.approval?.source&&current.value.executionMode!=='all-supported') throw fail('SETUP_SOURCE_READ_ONLY');
        if(current.value?.scopeMode==='source'&&!this.approval?.source&&require('../services/nativeSync/sourceScope').normalizeScope(current.value.sourceScope))throw fail('SETUP_SOURCE_READ_ONLY');
        const binding = await this.binding(current.value);
        let next;
        if (input.enabled) {
            const a = this.approval;
            if (!a || input.confirmed !== true || input.approvalToken !== a.token || a.revision !== current.revision || Date.now() - a.at > 600000) throw fail('SETUP_CONFIRMATION_REQUIRED');
            const endpoint = await this.endpoint();
            if (endpoint.origin !== a.next.serverUrl || endpoint.credentialHash !== a.credentialHash) throw fail('SETUP_CONNECTION_CHANGED');
            if (a.hadBinding !== Boolean(binding) || (binding && (a.source?binding.deviceId!==a.next.deviceId:!sameTopics(binding.topics, a.next.topics)))) throw fail('SETUP_BINDING_MISMATCH');
            next = a.next;
            if(a.source){await this.sourceCheck(next,current);}else{
            const choices = await this.catalog();
            if (next.topics.some(d => !choices.some(c => topicKey(c) === topicKey(d)))) throw fail('SETUP_TOPIC_UNAVAILABLE');
            if (!binding) for (const d of next.approvedHistory) {
                const record = await this.queue().run(d, () => this.owned(this.queue().getHistoryPath(d.itemId, d.topicId), { code: 'INVALID_HISTORY' }));
                if (record.revision !== d.rawFileSha256) throw fail('APPROVED_HISTORY_CHANGED');
            }
            }
        } else {
            if (!current.value) return { saved: true, restartRequired: false };
            next = { ...current.value, enabled: false };
        }
        // No state/cursor/Outbox writes; the running Bridge remains untouched.
        if ((await this.config()).revision !== current.revision) throw fail('SETUP_CONFIG_CHANGED');
        let warning = null;
        try {
            await fs.mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
            await durableJson(this.file, next);
        }
        catch (e) {
            const actual = await this.config().catch(() => null);
            if (!actual || stable(actual.value) !== stable(next)) throw fail('SETUP_SAVE_UNCONFIRMED');
            warning = 'SETUP_DURABILITY_UNCONFIRMED';
        }
        this.approval = null;
        const initial = await this.initial;
        return { saved: true, warning, restartRequired: initial.unreadable === true || stable(next) !== stable(initial.value), revision: (await this.config()).revision };
    }

    async close() { this.closed = true; await this.tail; this.approval = null; }
}
module.exports = { NativeSyncSettings };
