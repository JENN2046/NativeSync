'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { identity, fail } = require('./protocol');
const {normalizeScope}=require('./sourceScope');

// Explicit, non-secret selection. Authentication stays in existing desktop
// backend settings and may only be sent to that same HTTPS origin.
async function readConnection({ appDataRoot, readSettings }) {
    const file = path.join(path.resolve(appDataRoot), '.native-sync', 'connection.json');
    try {
        const directory = await fs.lstat(path.dirname(file));
        if (directory.isSymbolicLink() || !directory.isDirectory()) throw fail('SYNC_CONNECTION_ALIAS');
    } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    let config;
    try {
        const stat = await fs.lstat(file);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 65536) throw fail('SYNC_CONNECTION_ALIAS');
        config = JSON.parse(await fs.readFile(file, 'utf8'));
    } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    if (config.enabled !== true) return null;
    const fields = ['version', 'enabled', 'historySelectionApproved', 'deviceId', 'topics', 'serverUrl', 'credentialSource', 'approvedHistory', 'publishCatalog', 'publishExecutionConfigs', 'syncAttachments', 'scopeMode', 'sourceId', 'spaceId', 'sourceRoot', 'fullSelectionApproved', 'executionTopics', 'sourceScope', 'sourcePaused', 'scopeTransition'];
    if (Object.keys(config).some(key => !fields.includes(key))) throw fail('UNEXPECTED_SYNC_CONNECTION_FIELD');
    const full=config.scopeMode==='source';
    const sourceScope=normalizeScope(config.sourceScope);
    if(config.scopeTransition!==undefined){const t=config.scopeTransition;if(!full||(!sourceScope&&config.sourceScope?.mode!=='full')||!t||Object.keys(t).some(k=>!['opId','expectedScopeHash'].includes(k))||!/^[A-Za-z0-9_-]{1,96}$/.test(t.opId||'')||!/^[a-f0-9]{64}$/.test(t.expectedScopeHash||''))throw fail('INVALID_SCOPE_TRANSITION');}
    if((sourceScope||config.sourcePaused!==undefined)&&!full)throw fail('INVALID_SYNC_SCOPE');
    if(config.sourcePaused!==undefined&&((!sourceScope&&config.sourcePaused!==false)||typeof config.sourcePaused!=='boolean'))throw fail('INVALID_SYNC_SCOPE');
    if(config.scopeMode!==undefined&&!['selected','source'].includes(config.scopeMode))throw fail('INVALID_SYNC_SCOPE');
    if(full){
        if(config.version!==1||config.fullSelectionApproved!==true||!['sourceId','spaceId'].every(k=>typeof config[k]==='string'&&/^[A-Za-z0-9_-]{1,96}$/.test(config[k]))||typeof config.sourceRoot!=='string'||path.resolve(config.sourceRoot)!==path.resolve(appDataRoot))throw fail('FULL_SOURCE_BINDING_REQUIRED');
        if(!Array.isArray(config.topics)||config.topics.length)throw fail('FULL_SOURCE_USES_NATIVE_DIRECTORY');
        if(!Array.isArray(config.executionTopics||[])||(config.executionTopics||[]).length>128)throw fail('INVALID_EXECUTION_SELECTION');
        for(const t of config.executionTopics||[]){identity({ownerType:t.itemType||'agent',ownerId:t.itemId,topicId:t.topicId,msgId:'_'});if(sourceScope&&!require('./sourceScope').permits(sourceScope,t))throw fail('SOURCE_SCOPE_MISMATCH');}
    }
    if (config.version !== 1 || (!full&&config.historySelectionApproved !== true) || typeof config.deviceId !== 'string' || !config.deviceId || !Array.isArray(config.topics) || (!full&&(!config.topics.length || config.topics.length > 8)) || (config.syncAttachments !== undefined && typeof config.syncAttachments !== 'boolean') || (config.publishExecutionConfigs !== undefined && typeof config.publishExecutionConfigs !== 'boolean') || (config.publishCatalog !== undefined && typeof config.publishCatalog !== 'boolean')) throw fail('INVALID_SYNC_CONNECTION');
    if(!full&&config.syncAttachments===true&&config.publishExecutionConfigs!==true)throw fail('ATTACHMENTS_REQUIRE_VERSIONED_CONFIG');
    for (const topic of config.topics) identity({ ownerType: topic.itemType || 'agent', ownerId: topic.itemId, topicId: topic.topicId, msgId: '_' });
    if (!full&&config.topics.some(topic => topic.itemType === 'group') && config.publishExecutionConfigs !== true) throw fail('GROUP_EXECUTION_CONFIG_REQUIRED');
    let endpoint;
    try { endpoint = new URL(config.serverUrl); } catch { throw fail('SYNC_HTTPS_REQUIRED'); }
    if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.pathname !== '/' || endpoint.search || endpoint.hash) throw fail('SYNC_HTTPS_REQUIRED');
    if (config.credentialSource !== 'existing-vcp-settings' || typeof readSettings !== 'function') throw fail('DESKTOP_SETTINGS_AUTHORITY_REQUIRED');
    const settings = await readSettings();
    let backend;
    try { backend = new URL(settings.vcpServerUrl); } catch { throw fail('DESKTOP_BACKEND_IDENTITY_MISMATCH'); }
    if (backend.origin !== endpoint.origin || backend.username || backend.password || backend.search || backend.hash) throw fail('DESKTOP_BACKEND_IDENTITY_MISMATCH');
    if (typeof settings.vcpApiKey !== 'string' || !settings.vcpApiKey) throw fail('EXISTING_DESKTOP_KEY_REQUIRED');
    return { scopeMode:full?'source':'selected', ...(full?{sourceId:config.sourceId,spaceId:config.spaceId,sourceRoot:path.resolve(appDataRoot),executionTopics:config.executionTopics||[],...(sourceScope?{sourceScope,sourcePaused:config.sourcePaused===true,...(config.scopeTransition?{scopeTransition:config.scopeTransition}:{})}:(config.scopeTransition?{sourceScope:{mode:'full'},scopeTransition:config.scopeTransition}:{}))}:{}), syncAttachments:config.syncAttachments===true,url: endpoint.origin, token: settings.vcpApiKey, deviceId: config.deviceId, topics: config.topics, approvedHistory: config.approvedHistory, publishExecutionConfigs: config.publishExecutionConfigs === true, publishCatalog: config.publishCatalog !== false };
}
// A legacy server may ignore an unfamiliar header. Explicit full-source paths
// therefore fail closed on old servers even for an already paired device.
function sourceRoute(connection,route){
    if(connection?.scopeMode!=='source')return route;
    route=route.replace(/^\/api\/v1\/sync\/(push|pull|status)(?=\?|$)/,'/api/v1/sync/source/$1');
    const prefix='/api/plugins/NativeSync/';
    if(route.startsWith(prefix)&&!route.slice(prefix.length).startsWith('source/'))route=prefix+'source/'+route.slice(prefix.length);
    return route;
}
module.exports = { readConnection,sourceRoute };
