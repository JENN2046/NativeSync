'use strict';
const {randomUUID}=require('node:crypto');
const {identity,stable,sha256}=require('./protocol');
const fail=(code,status=409)=>Object.assign(Error(code),{code,status});
const opaque=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,96}$/.test(value);
const tuple=d=>[d.ownerType,d.ownerId,d.topicId||''];
function validateIdentity(d,owner=false){identity({...d,topicId:owner?'_owner':d.topicId,msgId:'_catalog'});return d;}
function avatar(value){if(value!=null&&(typeof value!=='string'||value.length>24000||!/^data:image\/(png|jpeg|webp);base64,[a-zA-Z0-9+/=]+$/.test(value)))throw fail('INVALID_AVATAR',400);return value||null;}
function fields(value,allowed){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!allowed.includes(k)))throw fail('INVALID_SOURCE_CATALOG',400);}

// Directory and baseline metadata share the existing central SQLite. Journal
// remains the only message ledger; snapshots reconstruct its immutable prefix.
class SourceCatalog{
 constructor(store,config={}){
  this.store=store;this.db=store.db;
  const grants=JSON.parse(config.NativeSyncFullSources||'[]');
  if(!Array.isArray(grants)||grants.length>32)throw fail('INVALID_SOURCE_GRANTS',400);
  this.grants=new Map();
  for(const grant of grants){fields(grant,['sourceId','deviceId','label']);if(!opaque(grant.sourceId)||!opaque(grant.deviceId)||this.grants.has(grant.sourceId)||(grant.label!==undefined&&(typeof grant.label!=='string'||grant.label.length>100)))throw fail('INVALID_SOURCE_GRANTS',400);this.grants.set(grant.sourceId,{...grant});}
  this.staticTopics=JSON.parse(config.NativeMobileTopics||'[]');if(!Array.isArray(this.staticTopics))throw fail('INVALID_SOURCE_GRANTS',400);
  this.db.exec('BEGIN IMMEDIATE');
  try{
   this.db.exec(`CREATE TABLE IF NOT EXISTS native_sync_metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS source_catalog_versions(source_id TEXT PRIMARY KEY,revision INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS source_bindings(source_id TEXT PRIMARY KEY,device_id TEXT NOT NULL,space_id TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS source_catalog_entities(source_id TEXT NOT NULL,owner_type TEXT NOT NULL,owner_id TEXT NOT NULL,topic_id TEXT NOT NULL,metadata TEXT NOT NULL,deleted INTEGER NOT NULL DEFAULT 0,ready INTEGER NOT NULL DEFAULT 0,revision INTEGER NOT NULL,PRIMARY KEY(source_id,owner_type,owner_id,topic_id),UNIQUE(owner_type,owner_id,topic_id));
    CREATE TABLE IF NOT EXISTS source_catalog_ops(source_id TEXT NOT NULL,op_id TEXT NOT NULL,request_hash TEXT NOT NULL,result_json TEXT NOT NULL,PRIMARY KEY(source_id,op_id));
    CREATE TABLE IF NOT EXISTS source_baselines(id TEXT PRIMARY KEY,source_id TEXT NOT NULL,device_id TEXT NOT NULL,plan_id TEXT NOT NULL,owner_type TEXT NOT NULL,owner_id TEXT NOT NULL,topic_id TEXT NOT NULL,watermark INTEGER NOT NULL,total_rows INTEGER NOT NULL,completed INTEGER NOT NULL DEFAULT 0,UNIQUE(source_id,plan_id));
    CREATE TABLE IF NOT EXISTS source_observations(source_id TEXT PRIMARY KEY,observed_at INTEGER NOT NULL,metadata TEXT NOT NULL);`);
   this.db.prepare('INSERT OR IGNORE INTO native_sync_metadata(key,value) VALUES(?,?)').run('spaceId',randomUUID());
   this.spaceId=this.db.prepare('SELECT value FROM native_sync_metadata WHERE key=?').get('spaceId').value;
   for(const [sourceId,grant] of this.grants){
    const binding=this.db.prepare('SELECT * FROM source_bindings WHERE source_id=?').get(sourceId);
    if(binding&&(binding.device_id!==grant.deviceId||binding.space_id!==this.spaceId))throw fail('SOURCE_BINDING_CHANGED');
    this.db.prepare('INSERT OR IGNORE INTO source_bindings VALUES(?,?,?)').run(sourceId,grant.deviceId,this.spaceId);
    this.db.prepare('INSERT OR IGNORE INTO source_catalog_versions(source_id,revision) VALUES(?,0)').run(sourceId);
   }
   this.db.exec('COMMIT');
  }catch(error){this.db.exec('ROLLBACK');throw error;}
 }
 binding(value){
  if(!value||!opaque(value.sourceId)||!opaque(value.deviceId)||typeof value.spaceId!=='string')throw fail('INVALID_SOURCE_BINDING',400);
  const grant=this.grants.get(value.sourceId);if(!grant||grant.deviceId!==value.deviceId)throw fail('SOURCE_NOT_APPROVED',403);
  if(value.spaceId!==this.spaceId)throw fail('SOURCE_SPACE_MISMATCH',403);
  const saved=this.db.prepare('SELECT * FROM source_bindings WHERE source_id=?').get(value.sourceId);if(!saved||saved.device_id!==value.deviceId||saved.space_id!==value.spaceId)throw fail('SOURCE_BINDING_CHANGED',403);
  return grant;
 }
 info(sourceId,deviceId){const grant=this.grants.get(sourceId);if(!grant||grant.deviceId!==deviceId)throw fail('SOURCE_NOT_APPROVED',403);return {version:1,sourceId,deviceId,spaceId:this.spaceId,revision:this.revision(sourceId)};}
 revision(sourceId){return this.db.prepare('SELECT revision FROM source_catalog_versions WHERE source_id=?').get(sourceId)?.revision||0;}
 keyFor(sourceId,d){return this.staticTopics.find(t=>tuple(t).every((v,i)=>v===tuple(d)[i]))?.key||'full_'+sha256(stable([sourceId,...tuple(d)])).slice(0,40);}
 publish(binding,body){
  this.binding(binding);fields(body,['opId','baseRevision','agents','topics','removed']);
  if(!opaque(body.opId)||!Number.isSafeInteger(body.baseRevision)||body.baseRevision<0||![body.agents,body.topics,body.removed].every(Array.isArray)||body.agents.length+body.topics.length+body.removed.length>128||Buffer.byteLength(JSON.stringify(body))>96000)throw fail('INVALID_SOURCE_CATALOG',400);
  const agents=body.agents.map(row=>{fields(row,['ownerType','ownerId','name','avatar']);validateIdentity(row,true);if(typeof row.name!=='string'||row.name.length>200)throw fail('INVALID_SOURCE_CATALOG',400);return {...row,avatar:avatar(row.avatar),topicId:''};});
  const topics=body.topics.map(row=>{fields(row,['ownerType','ownerId','topicId','name','archived','sourceState','previouslyAttached']);validateIdentity(row);if(typeof row.name!=='string'||row.name.length>500||(row.archived!==undefined&&typeof row.archived!=='boolean')||(row.previouslyAttached!==undefined&&typeof row.previouslyAttached!=='boolean')||(row.sourceState!==undefined&&!['available','file-pending','unavailable'].includes(row.sourceState)))throw fail('INVALID_SOURCE_CATALOG',400);return {...row,key:this.keyFor(binding.sourceId,row)};});
  const removed=body.removed.map(row=>{fields(row,['ownerType','ownerId','topicId','kind']);if(!['owner','topic'].includes(row.kind))throw fail('INVALID_SOURCE_CATALOG',400);validateIdentity(row,row.kind==='owner');return {...row,topicId:row.kind==='owner'?'':row.topicId};});
  const requestHash=sha256(stable(body));this.db.exec('BEGIN IMMEDIATE');
  try{
   const prior=this.db.prepare('SELECT request_hash,result_json FROM source_catalog_ops WHERE source_id=? AND op_id=?').get(binding.sourceId,body.opId);
   if(prior){if(prior.request_hash!==requestHash)throw fail('IDEMPOTENCY_KEY_REUSED');this.db.exec('COMMIT');return {...JSON.parse(prior.result_json),replayed:true};}
   if(this.revision(binding.sourceId)!==body.baseRevision)throw fail('SOURCE_DIRECTORY_REVISION_CONFLICT');
   const revision=body.baseRevision+1;
   for(const row of [...agents,...topics]){
    const collision=this.db.prepare('SELECT source_id,deleted FROM source_catalog_entities WHERE owner_type=? AND owner_id=? AND topic_id=?').get(...tuple(row));
    if(collision&&collision.source_id!==binding.sourceId)throw fail('SOURCE_IDENTITY_COLLISION');
    if(collision?.deleted)throw fail('SOURCE_ENTITY_DELETED');
    if(row.topicId){const parent=agents.find(a=>a.ownerType===row.ownerType&&a.ownerId===row.ownerId)||this.entity(binding.sourceId,row.ownerType,row.ownerId,'');if(!parent||parent.deleted)throw fail('SOURCE_OWNER_UNAVAILABLE');}
    const old=this.entity(binding.sourceId,...tuple(row));
    const legacy=this.staticTopics.some(t=>tuple(t).every((v,i)=>v===tuple(row)[i]));
    const ready=old?.ready||(row.topicId&&legacy&&row.previouslyAttached===true?1:0);
    this.db.prepare('INSERT INTO source_catalog_entities(source_id,owner_type,owner_id,topic_id,metadata,ready,revision) VALUES(?,?,?,?,?,?,?) ON CONFLICT(source_id,owner_type,owner_id,topic_id) DO UPDATE SET metadata=excluded.metadata,revision=excluded.revision').run(binding.sourceId,...tuple(row),JSON.stringify(row),ready?1:0,revision);
   }
   for(const row of removed){const entry=this.entity(binding.sourceId,...tuple(row));if(entry)this.db.prepare('UPDATE source_catalog_entities SET deleted=1,revision=? WHERE source_id=? AND owner_type=? AND owner_id=? AND topic_id=?').run(revision,binding.sourceId,...tuple(row));}
   this.db.prepare('UPDATE source_catalog_versions SET revision=? WHERE source_id=?').run(revision,binding.sourceId);
   const result={version:1,revision,published:agents.length+topics.length,removed:removed.length};this.db.prepare('INSERT INTO source_catalog_ops VALUES(?,?,?,?)').run(binding.sourceId,body.opId,requestHash,JSON.stringify(result));this.db.exec('COMMIT');return {...result,replayed:false};
  }catch(error){this.db.exec('ROLLBACK');throw error;}
 }
 entity(sourceId,ownerType,ownerId,topicId){return this.db.prepare('SELECT * FROM source_catalog_entities WHERE source_id=? AND owner_type=? AND owner_id=? AND topic_id=?').get(sourceId,ownerType,ownerId,topicId);}
 entities(sourceId,kind){if(!this.grants.has(sourceId))return [];return this.db.prepare("SELECT * FROM source_catalog_entities WHERE source_id=? AND "+(kind==='agents'?"topic_id=''":"topic_id<>''")+' ORDER BY owner_type,owner_id,topic_id').all(sourceId).map(r=>({...r,...JSON.parse(r.metadata)}));}
 activeTopic(sourceId,d){const row=this.entity(sourceId,...tuple(d)),owner=this.entity(sourceId,d.ownerType,d.ownerId,'');return row&&!row.deleted&&owner&&!owner.deleted?row:null;}
 topicKeys(sourceId){return this.entities(sourceId,'topics').filter(t=>this.activeTopic(sourceId,t)).map(t=>JSON.stringify(tuple(t)));}
 hasFullEntries(){return Boolean(this.db.prepare('SELECT 1 FROM source_catalog_entities LIMIT 1').get());}
 verifyLegacy(binding,body){this.binding(binding);fields(body,['cursor','records']);if(!Number.isSafeInteger(body.cursor)||body.cursor<0||!Array.isArray(body.records)||body.records.length>128)throw fail('INVALID_SOURCE_PROOF',400);if(body.cursor>Number(this.store.headStmt.get().seq))throw fail('SOURCE_HISTORY_DOMAIN_MISMATCH');for(const item of body.records){fields(item,['ownerType','ownerId','topicId','msgId','seq','hash','metadataHash']);identity(item);const row=this.db.prepare('SELECT * FROM journal WHERE seq=?').get(item.seq);if(!row||row.owner_type!==item.ownerType||row.owner_id!==item.ownerId||row.topic_id!==item.topicId||row.msg_id!==item.msgId||row.hash!==item.hash||(item.metadataHash&&item.metadataHash!==(row.metadata_hash||sha256(stable({})))))throw fail('SOURCE_HISTORY_DOMAIN_MISMATCH');}return {verified:true};}
 beginBaseline(binding,body){
  this.binding(binding);fields(body,['planId','ownerType','ownerId','topicId']);validateIdentity(body);if(!opaque(body.planId)||!this.activeTopic(binding.sourceId,body))throw fail('SOURCE_TOPIC_UNAVAILABLE',403);
  const prior=this.db.prepare('SELECT * FROM source_baselines WHERE source_id=? AND plan_id=?').get(binding.sourceId,body.planId);
  if(prior){if(!tuple(body).every((v,i)=>v===tuple({ownerType:prior.owner_type,ownerId:prior.owner_id,topicId:prior.topic_id})[i]))throw fail('IDEMPOTENCY_KEY_REUSED');return this.baselineInfo(prior);}
  this.db.exec('BEGIN IMMEDIATE');try{const watermark=Number(this.store.headStmt.get().seq),total=this.db.prepare('SELECT count(DISTINCT msg_id) n FROM journal WHERE owner_type=? AND owner_id=? AND topic_id=? AND seq<=?').get(...tuple(body),watermark).n;const id=randomUUID();this.db.prepare('INSERT INTO source_baselines(id,source_id,device_id,plan_id,owner_type,owner_id,topic_id,watermark,total_rows) VALUES(?,?,?,?,?,?,?,?,?)').run(id,binding.sourceId,binding.deviceId,body.planId,...tuple(body),watermark,total);this.db.exec('COMMIT');return this.baselineInfo(this.db.prepare('SELECT * FROM source_baselines WHERE id=?').get(id));}catch(error){this.db.exec('ROLLBACK');throw error;}
 }
 baselineInfo(row){return {version:1,id:row.id,planId:row.plan_id,sourceId:row.source_id,topic:{ownerType:row.owner_type,ownerId:row.owner_id,topicId:row.topic_id},watermark:row.watermark,total:row.total_rows,completed:Boolean(row.completed)};}
 baseline(binding,id,after=0,limit=100){
  this.binding(binding);const row=this.db.prepare('SELECT * FROM source_baselines WHERE id=? AND source_id=? AND device_id=?').get(id,binding.sourceId,binding.deviceId);
  if(!row)throw fail('BASELINE_NOT_FOUND',404);const d={ownerType:row.owner_type,ownerId:row.owner_id,topicId:row.topic_id};if(!this.activeTopic(binding.sourceId,d))throw fail('SOURCE_TOPIC_UNAVAILABLE',403);
  return this.page(row,after,limit);
 }
 // Internal read path: Portal has already resolved and authorized the exact
 // Topic. Reader IDs bind snapshots to that device session, not to a grant
 // supplied by the browser. It cannot publish source metadata or messages.
 beginMobile(readerId,topic,requestId){
  if(!opaque(requestId))throw fail('INVALID_CURSOR',400);validateIdentity(topic);
  const sourceId=topic.sourceId||'_selected',deviceId='read_'+sha256(readerId).slice(0,24),planId='read_'+sha256(stable([readerId,topic.key,requestId]));
  const prior=this.db.prepare('SELECT * FROM source_baselines WHERE source_id=? AND plan_id=?').get(sourceId,planId);if(prior)return this.baselineInfo(prior);
  this.db.exec('BEGIN IMMEDIATE');try{const watermark=Number(this.store.headStmt.get().seq),total=this.db.prepare('SELECT count(DISTINCT msg_id) n FROM journal WHERE owner_type=? AND owner_id=? AND topic_id=? AND seq<=?').get(...tuple(topic),watermark).n,id=randomUUID();this.db.prepare('INSERT INTO source_baselines(id,source_id,device_id,plan_id,owner_type,owner_id,topic_id,watermark,total_rows) VALUES(?,?,?,?,?,?,?,?,?)').run(id,sourceId,deviceId,planId,...tuple(topic),watermark,total);this.db.exec('COMMIT');return this.baselineInfo(this.db.prepare('SELECT * FROM source_baselines WHERE id=?').get(id));}catch(e){this.db.exec('ROLLBACK');throw e;}
 }
 mobilePage(readerId,topic,id,after=0,limit=100){
  const row=this.db.prepare('SELECT * FROM source_baselines WHERE id=? AND device_id=?').get(id,'read_'+sha256(readerId).slice(0,24));
  if(!row||row.owner_type!==topic.ownerType||row.owner_id!==topic.ownerId||row.topic_id!==topic.topicId)throw fail('BASELINE_NOT_FOUND',404);
  return this.page(row,after,limit);
 }
 page(row,after,limit){
  const d={ownerType:row.owner_type,ownerId:row.owner_id,topicId:row.topic_id};
  if(!Number.isSafeInteger(after)||after<0||!Number.isSafeInteger(limit)||limit<1||limit>500)throw fail('INVALID_CURSOR',400);
  const records=this.db.prepare(`WITH grouped AS(SELECT msg_id,MIN(seq) first_seq,MAX(seq) last_seq FROM journal WHERE owner_type=? AND owner_id=? AND topic_id=? AND seq<=? GROUP BY msg_id)
   SELECT j.*,g.first_seq FROM grouped g JOIN journal j ON j.seq=g.last_seq WHERE g.first_seq>? ORDER BY g.first_seq LIMIT ?`).all(...tuple(d),row.watermark,after,limit+1);
  const page=records.slice(0,limit),events=page.map(r=>{
   const prior=r.action==='delete'?this.db.prepare('SELECT seq,hash,metadata_version,metadata_hash,action FROM journal WHERE owner_type=? AND owner_id=? AND topic_id=? AND msg_id=? AND seq<? ORDER BY seq DESC LIMIT 1').get(...tuple(d),r.msg_id,r.seq):null;
   return {seq:Number(r.seq),...d,msgId:r.msg_id,action:r.action,hash:r.hash,message:this.store.projectMessage(r),sourceDevice:r.device_id,position:Number(r.first_seq),...(prior?.action==='upsert'?{previous:{seq:prior.seq,hash:prior.hash,metadataVersion:prior.metadata_version,metadataHash:prior.metadata_hash}}:{})};
  });return {...this.baselineInfo(row),events,next:page.at(-1)?.first_seq??after,hasMore:records.length>limit};
 }
 completeBaseline(binding,id){this.binding(binding);const row=this.db.prepare('SELECT * FROM source_baselines WHERE id=? AND source_id=? AND device_id=?').get(id,binding.sourceId,binding.deviceId);if(!row)throw fail('BASELINE_NOT_FOUND',404);if(!this.activeTopic(binding.sourceId,{ownerType:row.owner_type,ownerId:row.owner_id,topicId:row.topic_id}))throw fail('SOURCE_TOPIC_UNAVAILABLE',403);this.db.exec('BEGIN IMMEDIATE');try{this.db.prepare('UPDATE source_baselines SET completed=1 WHERE id=?').run(id);this.db.prepare('UPDATE source_catalog_entities SET ready=1 WHERE source_id=? AND owner_type=? AND owner_id=? AND topic_id=?').run(row.source_id,row.owner_type,row.owner_id,row.topic_id);this.db.exec('COMMIT');return {ready:true};}catch(error){this.db.exec('ROLLBACK');throw error;}}
 observe(binding,body){this.binding(binding);fields(body,['pendingImports','pendingOperations','conflicts','attachmentsPending','directoryErrors']);if(Object.entries(body).some(([k,v])=>!(k==='attachmentsPending'&&v===null)&&(!Number.isSafeInteger(v)||v<0)))throw fail('INVALID_SOURCE_STATUS',400);this.db.prepare('INSERT INTO source_observations VALUES(?,?,?) ON CONFLICT(source_id) DO UPDATE SET observed_at=excluded.observed_at,metadata=excluded.metadata').run(binding.sourceId,Date.now(),JSON.stringify(body));return {recorded:true};}
 progress(sourceId){const row=this.db.prepare('SELECT * FROM source_observations WHERE source_id=?').get(sourceId);return row?{...JSON.parse(row.metadata),observedAt:row.observed_at,freshness:'last-known'}:{pendingImports:null,pendingOperations:null,conflicts:null,attachmentsPending:null,observedAt:null,freshness:'unknown'};}
}
module.exports={SourceCatalog,opaque,tuple};
