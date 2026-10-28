'use strict';
const path = require('node:path');
const fs = require('node:fs/promises');
const { NativeSyncAdapter } = require('./adapter');
const { fail } = require('./protocol');
const { attachLocalRecovery } = require('./localAttachment');
const { registerNativeSyncQueries } = require('./queries');
const queueOwners = new WeakMap(), rootOwners = new Map();
function reserveOwner(queue, root) {
    const key=process.platform==='win32'?path.resolve(root).toLowerCase():path.resolve(root);
    if ((queue && queueOwners.has(queue)) || rootOwners.has(key) || (queue?.syncPolicy && !queue.syncPolicy.isRecoveryFence)) throw fail('SYNC_ALREADY_ATTACHED');
    const owner={};rootOwners.set(key,owner);if(queue)queueOwners.set(queue,owner);
    return ()=>{if(rootOwners.get(key)===owner)rootOwners.delete(key);if(queue&&queueOwners.get(queue)===owner)queueOwners.delete(queue);};
}

function syncHeaders(connection){
    if(connection.scopeMode==='source')return {'X-NativeSync-Source':connection.sourceId,'X-NativeSync-Device':connection.deviceId,'X-NativeSync-Space':connection.spaceId,...(require('./sourceScope').scopeHash(connection.sourceScope)?{'X-NativeSync-Scope':require('./sourceScope').scopeHash(connection.sourceScope)}:{})};
    return connection.topics?.length?{'X-NativeSync-Topics':Buffer.from(JSON.stringify(connection.topics.map(t=>[t.itemType||'agent',t.itemId,t.topicId]))).toString('base64url')}:{};
}
function createSyncRequest(connection,timeoutMs=8000) {
    const {url,token}=connection;
    return async(route,{body}={})=>{
        route=require('./connection').sourceRoute(connection,route);
        let response;
        try { response=await fetch(url+route,{method:body?'POST':'GET',headers:{...syncHeaders(connection),Authorization:`Bearer ${token}`,'Content-Type':'application/json','X-NativeSync-Protocol':'2','X-NativeSync-Capabilities':'attachments-v1,message-intents-v1'},body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.timeout(timeoutMs)}); }
        catch { throw fail('NETWORK_UNAVAILABLE'); }
        let value;try{value=await response.json();}catch{}
        if(!response.ok)throw Object.assign(fail(/^[A-Z][A-Z0-9_]{0,79}$/.test(value?.error?.code||'')?value.error.code:'SYNC_HTTP_ERROR'),{status:response.status});
        if(!value)throw fail('CORRUPT_HTTP_RESPONSE');
        return value;
    };
}

async function createNativeSyncRuntime({ queue, appDataRoot, args = [], isolated = false, notify, notifyExecutionStatus, intervalMs = 250, executionIntervalMs = 5000, readSettings, readAgentConfig, readGroupConfig, readTavernRules, readExecutionPolicy, thumbnail, request, requestBinary, storeAttachment, ipcMain, sourceFault, agentConfigEvents }) {
    const poc = args.includes('--native-sync-poc');
    if (poc && !isolated) throw fail('ISOLATED_APP_DATA_REQUIRED');
    if (!poc && !appDataRoot) return null;
    const option = name => args.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
    if (poc) {
        let endpoint;
        try { endpoint = new URL(option('native-sync-url')); } catch { throw fail('ISOLATED_LOOPBACK_REQUIRED'); }
        if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1') throw fail('ISOLATED_LOOPBACK_REQUIRED');
    }
    const releaseOwner=reserveOwner(queue,appDataRoot);
    let local,adapter,queries,sourceSync,sourceListener;
    try {
    const statePath = path.join(appDataRoot, '.native-sync', 'state.json');
    local = await attachLocalRecovery({queue,statePath});
    const connection = poc ? null : await require('./connection').readConnection({ appDataRoot, readSettings });
    if (!poc && !connection) {
        if (!local.exists && !ipcMain) { releaseOwner(); return null; }
        local.setError('SYNC_CONNECTION_REQUIRED');
        let closing;
        const dormant={
            adapter:null,
            async getExecutionStatus(){return {enabled:false};},
            async getNativeTaskResult(){throw fail('NATIVE_TASK_RESULT_UNAVAILABLE');},
            close(){return closing ||= (async()=>{await queries?.close();releaseOwner();})();},
        };
        if(ipcMain)queries=registerNativeSyncQueries({ipcMain,getRuntime:()=>dormant});
        return dormant;
    }
    let existingState = local.exists, prepared = !connection;
    const send = request || createSyncRequest(connection || {});
    const full=connection?.scopeMode==='source';
    let source;
    if(full){connection.previousSelectedTopics=!local.state?.source?local.state?.topics:undefined;source=await require('./sourceSync').SourceSync.verify(connection,local.state,send);connection.topics=local.state?.topics.map(t=>({...t}))||[];}
    let publicationError = null,bootstrap;
    const publishConfiguration = async () => {
        if (!connection?.publishExecutionConfigs || (full&&!connection.executionTopics.length)) return;
        try {
            await require('./executionConfigs').publishExecutionConfigs({topics:full?connection.executionTopics:connection.topics,readAgentConfig,readGroupConfig,readTavernRules,readExecutionPolicy,send});
            publicationError = null;
        } catch (error) { publicationError = error.code || 'CONFIG_PUBLICATION_FAILED'; }
    };
    const prepare = async () => {
        if (connection&&!full) {
            bootstrap=(await require('./initialImport').initialImport({ queue, appDataRoot, connection, request: (route, body) => send(route, { body }) })).bootstrap;
            if (connection.publishCatalog) {
                const metadata = await require('./catalog').catalog({ appDataRoot, topics: connection.topics, readAgentConfig, readGroupConfig, thumbnail });
                await send('/api/plugins/NativeSync/mobile/catalog', { body: metadata });
            }
        }
        // A private configuration failure cannot disable history catch-up. The
        // host still refuses new execution without a verified snapshot; this
        // catch only isolates publication from the existing history transport.
        await publishConfiguration();
        prepared = true;
    };
    // Existing shared histories attach Queue policy locally before network work.
    // First attachment still requires the approved online comparison.
    if (!existingState) await prepare();
    adapter = await NativeSyncAdapter.open({ queue, statePath,bootstrap, ...(full?{source,sourceAdoptionVerified:!local.state?.source}:{}), ...(connection || { url: option('native-sync-url'), deviceId: option('native-sync-device'), topics: JSON.parse(option('native-sync-topics') || '[]'), token: 'isolated-poc-token' }), ...((connection || request) ? { request: send } : {}), notify });
    if(full){sourceSync=await new (require('./sourceSync').SourceSync)({adapter,connection,appDataRoot,readAgentConfig,readGroupConfig,send,fault:sourceFault}).open();
        sourceListener=()=>{sourceSync.dirty=true;};agentConfigEvents?.on?.('agent-config-updated',sourceListener);
        await sourceSync.discover();}
    const download=requestBinary||(async route=>{
        route=require('./connection').sourceRoute(connection,route);
        let response;try{response=await fetch(connection.url+route,{headers:{...syncHeaders(connection),Authorization:`Bearer ${connection.token}`,'X-NativeSync-Protocol':'2','X-NativeSync-Capabilities':'attachments-v1,message-intents-v1'},redirect:'error',signal:AbortSignal.timeout(30000)});}catch{throw fail('NETWORK_UNAVAILABLE');}
        if(!response.ok){let code;try{code=(await response.json()).error?.code;}catch{}throw fail(/^ATTACHMENT_[A-Z_]+$/.test(code||'')?code:'ATTACHMENT_DOWNLOAD_FAILED');}
        const chunks=[];let size=0;for await(const chunk of response.body){size+=chunk.length;if(size>20*1024*1024)throw fail('ATTACHMENT_FILE_TOO_LARGE');chunks.push(chunk);}return Buffer.concat(chunks);
    });
    const attachments=connection?.syncAttachments?new (require('./attachments').DesktopAttachments)({queue,appDataRoot,connection,send,download,storeAttachment}):null;
    const { NativeExecutionStatus, localDelivery } = require('./executionStatus');
    const withLocal = result => ({ ...result, local: localDelivery(adapter, { itemType: result.topic.ownerType, itemId: result.topic.ownerId, topicId: result.topic.topicId }) });
    const executionStatus = connection ? await NativeExecutionStatus.open({
        connection:full?{...connection,topics:adapter.topics}:connection, file: path.join(appDataRoot, '.native-sync', 'execution-status.json'), request: send,
        notify: result => notifyExecutionStatus?.(withLocal(result)),
    }) : null;
    let runtime;
    if(ipcMain)queries=registerNativeSyncQueries({ipcMain,getRuntime:()=>runtime});
    // Read-only execution discovery has its own timer/promise. Slow or failed
    // status reads must never hold the History catch-up loop or Queue policy.
    let stopped = false, running = null, executionRunning = null, lastConfigCheck = Date.now(), lastAttachmentCheck = 0;
    const executionTimer = executionStatus ? setInterval(() => {
        if (stopped || executionRunning) return;
        executionRunning = executionStatus.refreshAll().catch(() => {}).finally(() => { executionRunning = null; });
    }, executionIntervalMs) : null;
    executionTimer?.unref?.();
    const timer = setInterval(() => {
        if (stopped || running) return;
        running = (async () => { if (!prepared) await prepare(); if(sourceSync){await sourceSync.tick();executionStatus?.addTopics(adapter.topics);} if(connection?.publishExecutionConfigs && Date.now()-lastConfigCheck>=5000){await publishConfiguration();lastConfigCheck=Date.now();} adapter.configurationError=publicationError; const checkAttachments=attachments&&Date.now()-lastAttachmentCheck>=5000; if(checkAttachments)try{await attachments.uploadLocal();adapter.attachmentError=null;}catch(e){adapter.attachmentError=e.code||'ATTACHMENT_SYNC_FAILED';} await adapter.synchronize(); adapter.lastTransportError=null; if(checkAttachments){try{await attachments.restoreRemote();}catch(e){adapter.attachmentError=e.code||'ATTACHMENT_SYNC_FAILED';}lastAttachmentCheck=Date.now();adapter.attachmentSkipped=attachments.skipped;} if(sourceSync)await sourceSync.report(); })().catch(error => {
            adapter.degraded = error.code || 'SYNC_FAILED';
            adapter.lastTransportError={code:adapter.degraded,status:error.status??null};
        }).finally(() => { running = null; });
    }, intervalMs);
    timer.unref?.();
    let closing;
    runtime = {
        adapter,
        async getExecutionStatus(d, { refresh = true } = {}) {
            if (stopped) throw fail('SYNC_BRIDGE_CLOSED');
            if (!executionStatus) return { enabled: false };
            return withLocal(refresh ? await executionStatus.refresh(d) : executionStatus.read(d));
        },
        async getNativeTaskResult(d, executionId, nativeTaskId) {
            if (stopped) throw fail('SYNC_BRIDGE_CLOSED');
            if (!executionStatus) throw fail('NATIVE_TASK_RESULT_UNAVAILABLE');
            return executionStatus.result(d, executionId, nativeTaskId);
        },
        close() {
            if(closing)return closing;
            stopped=true;clearInterval(timer);clearInterval(executionTimer);
            closing=(async()=>{
                await queries?.close();
                await running;await executionRunning;
                // Host quit admission already stops new native requests. Keep the
                // capture observer until admitted local Queue work has settled.
                await Promise.allSettled([...(queue?.queues?.values() || [])]);
                if(sourceListener)agentConfigEvents?.off?.('agent-config-updated',sourceListener);await executionStatus?.close();await adapter.close();releaseOwner();
            })();
            return closing;
        },
    };
    return runtime;
    } catch(error) {
        if(sourceListener)agentConfigEvents?.off?.('agent-config-updated',sourceListener);
        local?.setError(error.code || 'SYNC_STARTUP_FAILED');
        await queries?.close();
        if(adapter){adapter.startupError=error.code || 'SYNC_STARTUP_FAILED';await adapter.close();}
        // The real host must reach native startup when a known local binding
        // can remain fenced. Standalone callers retain their rejection contract.
        // An unreadable/unattested state never reaches this fallback.
        if(ipcMain && local && error.code !== 'SYNC_ALREADY_ATTACHED') {
            let closing;
            const degraded={
                adapter:null, startupError:error.code || 'SYNC_STARTUP_FAILED',
                async getExecutionStatus(){return {enabled:false,degraded:this.startupError};},
                async getNativeTaskResult(){throw fail('NATIVE_TASK_RESULT_UNAVAILABLE');},
                close(){return closing ||= (async()=>{await queries?.close();releaseOwner();})();},
            };
            try {queries=registerNativeSyncQueries({ipcMain,getRuntime:()=>degraded});}
            catch(registrationError){releaseOwner();throw registrationError;}
            return degraded;
        }
        releaseOwner();
        throw error;
    }
}
module.exports = { createNativeSyncRuntime,createSyncRequest,syncHeaders };
