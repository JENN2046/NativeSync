'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { identity, fail } = require('./protocol');

// Local admission precedes credentials and network. No second binding/state file.
// If a damaged state cannot attest its binding, startup remains fail-closed.
async function attachLocalRecovery({ queue, statePath }) {
    let topics = null, state = null, code = 'SYNC_STARTUP_RECOVERY_REQUIRED';
    const previous = queue?.syncPolicy;
    const previousObserver = queue?.commitObserver;
    const key = file => process.platform === 'win32' ? file.toLowerCase() : file;
    let bindings = new Set();
    let fullSource=false,sourceScope=null;
    const {normalizeScope,permits}=require('./sourceScope');
    const selected = d => topics === null || topics.some(t => t.itemId === d.itemId && t.itemType === (d.itemType || 'agent') && t.topicId === d.topicId);
    async function physicalPath(d) {
        const root = path.resolve(queue.userDataDir), file = queue.getHistoryPath(d.itemId, d.topicId);
        let current = root;
        for (const segment of ['', ...path.relative(root, file).split(path.sep)]) {
            if (segment) current = path.join(current, segment);
            try { const stat = await fs.lstat(current); if (stat.isSymbolicLink() || (stat.isFile() && stat.nlink > 1)) throw fail('OWNER_PATH_ALIAS'); }
            catch (error) { if (error.code !== 'ENOENT') throw error; }
        }
    }
    async function deny(d) {
        if (fullSource||(sourceScope&&permits(sourceScope,d))||selected(d)) throw fail(code);
        if (bindings.has(key(queue.getHistoryPath(d.itemId,d.topicId)))) throw fail('OWNER_PATH_CONFLICT');
    }
    const fence = {
        isRecoveryFence:true,
        get fullSource(){return fullSource;},
        get topics() { return topics; },
        get blocksAllWrites() { return topics === null; },
        isEnabled:selected, beforeMutation:deny, beforeWrite:deny,
        beforeRead:async d => { if (selected(d)) { if (topics === null) throw fail(code); await physicalPath(d); } },
        retryLocalCommit:async()=>{throw fail(code);},
        diagnostics:()=>({enabled:true,readOnly:true,degraded:code,selectedTopics:topics?.length ?? null,outboxSize:state?.outbox?.length ?? null,pending:state ? Boolean(state.pending) : null,localCommits:state ? Object.values(state.localCommits || {}).map(r=>({id:r.id,stage:r.stage,source:r.source,code:r.error?.code})) : null}),
    };
    if (queue) queue.configureSync(fence);
    try {
        const directory = await fs.lstat(path.dirname(statePath));
        if (!directory.isDirectory() || directory.isSymbolicLink()) throw fail('SYNC_STATE_ALIAS');
        const stat = await fs.lstat(statePath);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw fail('SYNC_STATE_ALIAS');
        try { state = JSON.parse(await fs.readFile(statePath,'utf8')); }
        catch (error) { if (error instanceof SyntaxError) throw fail('INVALID_SYNC_STATE_JSON'); throw error; }
        if (!state || ![1,2].includes(state.version) || typeof state.deviceId !== 'string' || !state.deviceId || !Array.isArray(state.topics) || (!state.topics.length&&!state.source) || !Array.isArray(state.outbox) || !Number.isSafeInteger(state.cursor) || state.cursor < 0 || !state.acked || typeof state.acked !== 'object') throw fail('INVALID_SYNC_STATE');
        if (state.version === 2 && (state.format !== 'native-message-intents-v1' || !state.localCommits || !state.receipts || !Array.isArray(state.inbox) || !state.drift)) throw fail('INVALID_SYNC_STATE');
        const normalized = state.topics.map(t=>({itemId:t.itemId,itemType:t.itemType || 'agent',topicId:t.topicId}));
        const nextBindings = new Set();
        for (const t of normalized) {
            identity({ownerType:t.itemType,ownerId:t.itemId,topicId:t.topicId,msgId:'_binding'});
            const file = queue?.getHistoryPath(t.itemId,t.topicId);
            if (file) { if (nextBindings.has(key(file))) throw fail('OWNER_PATH_CONFLICT'); nextBindings.add(key(file)); }
        }
        if(state.source){const b=state.source.binding;if(!b||!['sourceId','spaceId','rootHash'].every(k=>typeof b[k]==='string'&&b[k])||b.deviceId!==state.deviceId)throw fail('INVALID_SOURCE_BINDING');sourceScope=normalizeScope(b.scope);fullSource=!sourceScope;
            if(sourceScope&&normalized.some(d=>!permits(sourceScope,d)))throw fail('SOURCE_SCOPE_MISMATCH');}
        topics = normalized; bindings = nextBindings;
        return {exists:true,state,fence,setError:error=>{code=error;}};
    } catch (error) {
        if (error.code === 'ENOENT') {
            if (queue?.syncPolicy === fence) queue.configureSync(previous,previousObserver);
            return {exists:false,state:null,fence:previous,setError:()=>{}};
        }
        code = error.code || 'SYNC_STATE_UNAVAILABLE';
        throw error;
    }
}
module.exports = { attachLocalRecovery };
