'use strict';
const {identity}=require('./protocol');
const fail=(code,status=403)=>Object.assign(Error(code),{code,status});
const binding=req=>({sourceId:req.headers?.['x-nativesync-source'],deviceId:req.headers?.['x-nativesync-device'],spaceId:req.headers?.['x-nativesync-space'],scopeHash:req.headers?.['x-nativesync-scope']});
function scopeRequest(store,req){
 if(req.nativeSyncScopeApplied)return;
 const full=req.headers?.['x-nativesync-source'],selected=req.headers?.['x-nativesync-topics'];
 if(full!==undefined&&selected!==undefined)throw fail('AMBIGUOUS_SYNC_SCOPE',400);
 if(full!==undefined){
  if(!store.sourceCatalog||req.nativeSyncTopics!==undefined)throw fail('SOURCE_NOT_APPROVED');
  const value=binding(req);store.sourceCatalog.binding(value);req.nativeSyncSourceBinding=value;
  req.nativeSyncMetadataPublisher=true;req.nativeSyncDeviceId=value.deviceId;req.nativeSyncTopics=store.sourceCatalog.topicKeys(value.sourceId);
 }else if(selected!==undefined){
  if(typeof selected!=='string'||selected.length>12000)throw fail('INVALID_TOPIC_SCOPE',400);
  let rows;try{rows=JSON.parse(Buffer.from(selected,'base64url').toString('utf8'));}catch{throw fail('INVALID_TOPIC_SCOPE',400);}
  if(!Array.isArray(rows)||!rows.length||rows.length>8)throw fail('INVALID_TOPIC_SCOPE',400);
  const keys=rows.map(row=>{if(!Array.isArray(row)||row.length!==3)throw fail('INVALID_TOPIC_SCOPE',400);try{identity({ownerType:row[0],ownerId:row[1],topicId:row[2],msgId:'_'});}catch{throw fail('INVALID_TOPIC_SCOPE',400);}return JSON.stringify(row);});
  if(req.nativeSyncTopics!==undefined&&keys.some(k=>!req.nativeSyncTopics.includes(k)))throw fail('TOPIC_NOT_ALLOWED');
  req.nativeSyncMetadataPublisher=req.nativeSyncTopics===undefined;req.nativeSyncTopics=keys;
 }else if(req.nativeSyncTopics===undefined&&store.sourceCatalog?.hasFullEntries()){
  // An old unscoped Desktop request cannot attest which of the now-expanded
  // topics it selected. Require the compatible scoped client, never leak data.
  throw fail('SCOPED_SYNC_CLIENT_UPGRADE_REQUIRED',409);
 }
 req.nativeSyncScopeApplied=true;
}
async function body(req){if(req.body!==undefined)return req.body;let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>128000)throw fail('BODY_TOO_LARGE',413);}try{return JSON.parse(raw);}catch{throw fail('INVALID_SOURCE_REQUEST',400);}}
async function sourceRequest(store,req,url){
 if(req.headers?.['x-nativesync-topics']!==undefined)throw fail('AMBIGUOUS_SYNC_SCOPE',400);
 const catalog=store.sourceCatalog;if(!catalog)throw fail('SOURCE_PROTOCOL_UNAVAILABLE',409);
 if(req.nativeSyncTopics!==undefined)throw fail('SOURCE_ADMIN_REQUIRED');
 if(req.method==='GET'&&url.pathname==='/source/info'){
  if([...url.searchParams.keys()].some(k=>!['sourceId','deviceId'].includes(k)))throw fail('INVALID_SOURCE_REQUEST',400);
  return catalog.info(url.searchParams.get('sourceId'),url.searchParams.get('deviceId'),req.headers?.['x-nativesync-scope']);
 }
 const bound=binding(req);if(req.method==='POST'&&url.pathname==='/source/scope-transition')return catalog.transition(bound,await body(req));catalog.binding(bound);
 if(req.method==='POST'&&url.pathname==='/source/catalog')return catalog.publish(bound,await body(req));
 if(req.method==='POST'&&url.pathname==='/source/verify-state')return catalog.verifyLegacy(bound,await body(req));
 if(req.method==='POST'&&url.pathname==='/source/baselines')return catalog.beginBaseline(bound,await body(req));
 const match=/^\/source\/baselines\/([a-f0-9-]{36})(\/complete)?$/.exec(url.pathname);
 if(match&&req.method==='GET'&&!match[2])return catalog.baseline(bound,match[1],Number(url.searchParams.get('after')||0),Number(url.searchParams.get('limit')||100));
 if(match&&req.method==='POST'&&match[2])return catalog.completeBaseline(bound,match[1]);
 if(req.method==='POST'&&url.pathname==='/source/progress')return catalog.observe(bound,await body(req));
 throw fail('NOT_FOUND',404);
}
function metrics(store,allowed){
 if(allowed===undefined)return store.metrics();
 const serialized=JSON.stringify(allowed),condition='json_array(owner_type,owner_id,topic_id) IN (SELECT value FROM json_each(?))';
 return {headSeq:Number(store.headStmt.get().seq),journalRows:store.db.prepare('SELECT count(*) n FROM journal WHERE '+condition).get(serialized).n,liveMessages:store.db.prepare('SELECT count(*) n FROM messages WHERE deleted=0 AND '+condition).get(serialized).n,appliedOps:store.db.prepare('SELECT count(*) n FROM applied_ops WHERE json_extract(result_json,\'$.seq\') IN (SELECT seq FROM journal WHERE '+condition+')').get(serialized).n};
}
module.exports={scopeRequest,sourceRequest,metrics};
