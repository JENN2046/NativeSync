'use strict';
// R4 wire contract on a host-owned HTTP server. Authentication and listening
// belong to VCPToolBox; the plugin opens no second server or authentication lane.
const { SyncError } = require('./centralStore');
function createSyncHttpService(store) {
    let closing = false, active = 0, drain;
    const drained = new Promise(resolve => { drain = resolve; });
    const send = (res, code, body) => {
        res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify(body));
    };
    async function handle(req, res) {
        if (closing) return send(res, 503, { error: { code: 'SYNC_SERVICE_STOPPED', message: 'Native sync service is stopping' } });
        active++;
        try {
            const url = new URL(req.url, 'http://localhost');
            if(['/source/push','/source/pull','/source/status'].includes(url.pathname)){
                if(!req.headers?.['x-nativesync-source'])throw new SyncError('SOURCE_BINDING_REQUIRED','Full-source binding required',403);
                require('./sourceHttp').scopeRequest(store,req);
                url.pathname=url.pathname.slice('/source'.length);
            }else if(url.pathname.startsWith('/source/')){const result=await require('./sourceHttp').sourceRequest(store,req,url);store.onSourceChange?.();return send(res,200,result);}
            require('./sourceHttp').scopeRequest(store,req);
            if (req.method === 'GET' && url.pathname === '/pull') {
                const result=store.pull(Number(url.searchParams.get('after_seq') ?? 0), Number(url.searchParams.get('limit') ?? 100), req.nativeSyncTopics);
                if(req.headers['x-nativesync-protocol']!=='2'&&result.events.some(e=>e.message?._nativeSyncMetadata))throw new SyncError('METADATA_PROTOCOL_UPGRADE_REQUIRED','NativeSync metadata protocol 2 required',409);
                if(!String(req.headers['x-nativesync-capabilities']||'').split(',').includes('message-intents-v1')&&result.events.some(e=>e.message?._nativeSyncMetadata?.fields.continuity))throw new SyncError('MESSAGE_INTENT_PROTOCOL_UPGRADE_REQUIRED','Native message intent capability required',409);
                if(!String(req.headers['x-nativesync-capabilities']||'').split(',').includes('attachments-v1')&&result.events.some(e=>e.message?._nativeSyncMetadata?.fields.attachmentData?.some(a=>a.contentHash||a.frameHashes?.length)))throw new SyncError('ATTACHMENT_PROTOCOL_UPGRADE_REQUIRED','Attachment identity/frame capability required',409);
                return send(res,200,result);
            }
            if (req.method === 'GET' && url.pathname === '/status') return send(res, 200, require('./sourceHttp').metrics(store,req.nativeSyncTopics));
            if (req.method === 'POST' && url.pathname === '/push') {
                // Express may already have consumed JSON before plugin routes.
                let op = req.body;
                if (op === undefined) {
                    let raw = '';
                    for await (const chunk of req) {
                        raw += chunk;
                        if (Buffer.byteLength(raw) > 1024 * 1024) throw new SyncError('BODY_TOO_LARGE', '1 MiB maximum', 413);
                    }
                    op = JSON.parse(raw);
                } else if (Buffer.byteLength(JSON.stringify(op)) > 1024 * 1024) throw new SyncError('BODY_TOO_LARGE', '1 MiB maximum', 413);
                store.sourceCatalog?.authorizePush(req.nativeSyncSourceBinding,op);
                if(req.nativeSyncTopics!==undefined&&!req.nativeSyncTopics.includes(JSON.stringify([op?.ownerType,op?.ownerId,op?.topicId])))throw new SyncError('TOPIC_NOT_ALLOWED','Operation is outside the selected source',403);
                if(req.nativeSyncSourceBinding&&op?.deviceId!==req.nativeSyncSourceBinding.deviceId)throw new SyncError('SOURCE_DEVICE_MISMATCH','Operation device changed',403);
                return send(res, 200, store.apply(op,{metadataPublisher:req.nativeSyncMetadataPublisher??(req.nativeSyncTopics===undefined),attachmentPrincipal:req.nativeSyncDeviceId?'desktop:'+req.nativeSyncDeviceId:'host-bearer'}));
            }
            return send(res, 404, { error: { code: 'NOT_FOUND', message: 'Unknown route' } });
        } catch (error) {
            return send(res, error.status || 400, { error: { code: error.code || 'BAD_REQUEST', message: error.message } });
        } finally { active--; if (closing && active === 0) drain(); }
    }
    return { handle, async close() { closing = true; if (active > 0) await drained; store.close(); } };
}
module.exports = { createSyncHttpService };
