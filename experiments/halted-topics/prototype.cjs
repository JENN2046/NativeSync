'use strict';
// Isolated protocol experiment. Nothing in overlays imports this module.
const {DatabaseSync}=require('node:sqlite');
const {createHash}=require('node:crypto');
const path=require('node:path');
const CAPABILITY='halted-topics-experiment-v1';
const fail=(code,status=409)=>Object.assign(Error(code),{code,status});
const keyOf=row=>JSON.stringify([row.owner_type??row.ownerType,row.owner_id??row.ownerId,row.topic_id??row.topicId]);
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const integer=n=>Number.isSafeInteger(n)&&n>=0;
const plain=rows=>JSON.parse(JSON.stringify(rows));

class Server {
 constructor(file,product,{fault=()=>{}}={}){
  this.product=product;this.fault=fault;
  this.store=new(require(path.join(product,'VCPToolBox/Plugin/NativeSync/sync/centralStore'))).CentralStore(file);
  this.db=this.store.db;this.db.exec(`PRAGMA synchronous=FULL;
   CREATE TABLE IF NOT EXISTS experiment_topic_halts(topic TEXT PRIMARY KEY,generation INTEGER NOT NULL,status TEXT NOT NULL,first_unsafe_seq INTEGER NOT NULL,repair_digest TEXT,repaired_head INTEGER);
   CREATE TABLE IF NOT EXISTS experiment_trusted_backups(digest TEXT PRIMARY KEY,topic TEXT NOT NULL);
   CREATE TRIGGER IF NOT EXISTS experiment_halted_journal_insert BEFORE INSERT ON journal
   WHEN EXISTS(SELECT 1 FROM experiment_topic_halts WHERE topic=json_array(NEW.owner_type,NEW.owner_id,NEW.topic_id) AND status='halted')
   BEGIN SELECT RAISE(ABORT,'EXPERIMENT_TOPIC_HALTED'); END;
  `);
  this.protocol=require(path.join(product,'VCPToolBox/Plugin/NativeSync/sync/protocol'));
 }
 rows(topic){const [a,b,c]=JSON.parse(topic);return this.db.prepare('SELECT * FROM journal WHERE owner_type=? AND owner_id=? AND topic_id=? ORDER BY seq').all(a,b,c);}
 halts(allowed){return this.db.prepare('SELECT * FROM experiment_topic_halts ORDER BY topic').all().filter(r=>allowed.includes(r.topic));}
 head(){return this.store.metrics().headSeq;}
 authorize(topic,allowed){if(!allowed.includes(topic))throw fail('TOPIC_NOT_ALLOWED',403);}
 mark(topic,seq){
  const old=this.db.prepare('SELECT * FROM experiment_topic_halts WHERE topic=?').get(topic);
  const generation=old?(old.status==='halted'?old.generation:old.generation+1):1;
  const first=old?.status==='halted'?Math.min(seq,old.first_unsafe_seq):seq;
  this.db.prepare(`INSERT INTO experiment_topic_halts(topic,generation,status,first_unsafe_seq) VALUES(?,?,'halted',?)
   ON CONFLICT(topic) DO UPDATE SET generation=excluded.generation,status='halted',first_unsafe_seq=excluded.first_unsafe_seq,repair_digest=NULL,repaired_head=NULL`).run(topic,generation,first);
 }
 event(row){return {seq:row.seq,ownerType:row.owner_type,ownerId:row.owner_id,topicId:row.topic_id,msgId:row.msg_id,action:row.action,hash:row.hash,message:this.store.projectMessage(row),sourceDevice:row.device_id};}
 pull(cursor,limit,allowed,capability=CAPABILITY){
  if(capability!==CAPABILITY)throw fail('HALTED_TOPICS_PROTOCOL_REQUIRED');
  if(!integer(cursor)||!Number.isSafeInteger(limit)||limit<1||limit>128||cursor>this.head())throw fail('INVALID_CURSOR',400);
  this.db.exec('BEGIN IMMEDIATE');
  try{
   const rows=this.db.prepare('SELECT * FROM journal WHERE seq>? ORDER BY seq LIMIT ?').all(cursor,limit);
   const valid=[];
   for(const row of rows){
    // Invalid routing cannot be safely assigned to an authorized topic. Do
    // not decode unauthorized bodies, nor guess ownership of unclassifiable data.
    try{this.protocol.identity({ownerType:row.owner_type,ownerId:row.owner_id,topicId:row.topic_id,msgId:row.msg_id});}
    catch{throw fail('UNCLASSIFIABLE_STORAGE_CORRUPTION',500);}
    const topic=keyOf(row);if(!allowed.includes(topic))continue;
    try{valid.push(this.event(row));}catch(e){if(e.code!=='SYNC_STORAGE_CORRUPT')throw e;this.mark(topic,row.seq);}
   }
   const barriers=this.halts(allowed),held=new Set(barriers.filter(x=>x.status==='halted').map(x=>x.topic));
   const events=valid.filter(e=>!held.has(keyOf(e))),headSeq=this.head(),nextSeq=rows.at(-1)?.seq??cursor;
   this.fault('halt-before-commit');this.db.exec('COMMIT');this.fault('halt-after-commit');
   return {protocol:CAPABILITY,baseCursor:cursor,events,headSeq,nextSeq,hasMore:nextSeq<headSeq,haltedTopics:plain(barriers)};
  }catch(e){if(this.db.isTransaction)this.db.exec('ROLLBACK');throw e;}
 }
 assertWritable(topic){if(this.halts([topic])[0]?.status==='halted')throw fail('TOPIC_HALTED',503);}
 push(op){this.assertWritable(keyOf(op));try{return this.store.apply(op);}catch(e){if(e.message.includes('EXPERIMENT_TOPIC_HALTED'))throw fail('TOPIC_HALTED',503);throw e;}}
 legacyPull(cursor,limit,allowed){
  if(this.halts(allowed).some(x=>x.status==='halted'))throw fail('HALTED_TOPICS_PROTOCOL_REQUIRED');
  return this.store.pull(cursor,limit,allowed);
 }
 backup(topic){
  const [a,b,c]=JSON.parse(topic),journal=plain(this.rows(topic)),messages=plain(this.db.prepare('SELECT * FROM messages WHERE owner_type=? AND owner_id=? AND topic_id=? ORDER BY msg_id').all(a,b,c));
  return {topic,journal,messages,digest:hash({topic,journal,messages})};
 }
 trustCurrentBackup(backup){
  // Test-only administrative enrollment, performed while the original topic
  // is healthy. Uploaded replacement bytes cannot enroll their own digest.
  this.verifyTopic(backup.topic);if(this.backup(backup.topic).digest!==backup.digest)throw fail('BACKUP_NOT_CURRENT');
  this.db.prepare('INSERT OR IGNORE INTO experiment_trusted_backups VALUES(?,?)').run(backup.digest,backup.topic);
 }
 verifyTopic(topic){
  const latest=new Map();for(const row of this.rows(topic)){this.store.projectMessage(row);latest.set(row.msg_id,row);}
  const [a,b,c]=JSON.parse(topic),messages=this.db.prepare('SELECT * FROM messages WHERE owner_type=? AND owner_id=? AND topic_id=?').all(a,b,c);
  if(messages.length!==latest.size)throw fail('TOPIC_PROJECTION_INCOMPLETE',500);
  for(const row of messages){
   this.store.projectMessage(row);const last=latest.get(row.msg_id);
   if(!last||row.last_seq!==last.seq||row.hash!==last.hash||row.deleted!==(last.action==='delete'?1:0)||row.message_json!==last.message_json||row.metadata_version!==last.metadata_version||row.metadata_hash!==last.metadata_hash)throw fail('TOPIC_PROJECTION_INCONSISTENT',500);
  }
  return hash(plain(this.rows(topic)));
 }
 repair(topic,generation,trustedBackup){
  // This argument represents an independently trusted pre-fault backup. A
  // matching digest alone is not a proof of trust or a production repair tool.
  if(trustedBackup.topic!==topic||hash({topic,journal:trustedBackup.journal,messages:trustedBackup.messages})!==trustedBackup.digest||!this.db.prepare('SELECT 1 FROM experiment_trusted_backups WHERE digest=? AND topic=?').get(trustedBackup.digest,topic))throw fail('UNTRUSTED_REPAIR_SOURCE');
  this.db.exec('BEGIN IMMEDIATE');
  try{
   const old=this.halts([topic])[0];if(!old||old.status!=='halted'||old.generation!==generation)throw fail('HALT_GENERATION_CHANGED');
   const current=this.rows(topic);
   if(current.length!==trustedBackup.journal.length||current.some((r,i)=>r.seq!==trustedBackup.journal[i].seq||keyOf(r)!==topic||r.msg_id!==trustedBackup.journal[i].msg_id))throw fail('REPAIR_SNAPSHOT_NOT_EXACT');
   for(const row of trustedBackup.journal){
    this.db.prepare('UPDATE journal SET action=?,hash=?,message_json=?,metadata_version=?,metadata_hash=?,device_id=? WHERE seq=?').run(row.action,row.hash,row.message_json,row.metadata_version,row.metadata_hash,row.device_id,row.seq);
   }
   const [a,b,c]=JSON.parse(topic),prior=this.db.prepare('SELECT msg_id,last_seq FROM messages WHERE owner_type=? AND owner_id=? AND topic_id=? ORDER BY msg_id').all(a,b,c);
   if(prior.length!==trustedBackup.messages.length||prior.some((r,i)=>r.msg_id!==trustedBackup.messages[i].msg_id||r.last_seq!==trustedBackup.messages[i].last_seq))throw fail('REPAIR_SNAPSHOT_NOT_EXACT');
   for(const row of trustedBackup.messages)this.db.prepare('UPDATE messages SET hash=?,deleted=?,message_json=?,metadata_version=?,metadata_hash=? WHERE owner_type=? AND owner_id=? AND topic_id=? AND msg_id=?').run(row.hash,row.deleted,row.message_json,row.metadata_version,row.metadata_hash,a,b,c,row.msg_id);
   const digest=this.verifyTopic(topic);this.db.prepare("UPDATE experiment_topic_halts SET status='repaired',repair_digest=?,repaired_head=? WHERE topic=? AND generation=? AND status='halted'").run(digest,this.head(),topic,generation);
   this.fault('repair-before-commit');this.db.exec('COMMIT');this.fault('repair-after-commit');return this.halts([topic])[0];
  }catch(e){if(this.db.isTransaction)this.db.exec('ROLLBACK');throw e;}
 }
 catchup(topic,generation,after,through,limit,allowed){
  this.authorize(topic,allowed);
  if(!integer(after)||!integer(through)||after>through||through>this.head()||!Number.isSafeInteger(limit)||limit<1||limit>128)throw fail('INVALID_CATCHUP_CURSOR',400);
  this.db.exec('BEGIN');
  try{
   const barrier=this.halts([topic])[0];
   if(!barrier||generation!==barrier.generation)throw fail('HALT_GENERATION_CHANGED');
   if(barrier.status!=='repaired')throw fail('TOPIC_STILL_HALTED',503);
   this.verifyTopic(topic);
   const all=this.rows(topic);
   if(hash(plain(all.filter(r=>r.seq<=barrier.repaired_head)))!==barrier.repair_digest)throw fail('REPAIR_CERTIFICATE_CHANGED',500);
   const rows=all.filter(r=>r.seq>after&&r.seq<=through),page=rows.slice(0,limit),hasMore=rows.length>limit;
   const frame={protocol:CAPABILITY,topic,generation,baseCursor:after,through,nextCursor:hasMore?page.at(-1).seq:through,hasMore,repairDigest:barrier.repair_digest,events:page.map(r=>this.event(r))};this.db.exec('COMMIT');return frame;
  }catch(e){if(this.db.isTransaction)this.db.exec('ROLLBACK');throw e;}
 }
 close(){this.store.close();}
}

class Client {
 constructor(file,allowed,{fault=()=>{}}={}){
  this.db=new DatabaseSync(file);this.allowed=[...allowed];this.fault=fault;
  this.db.exec(`PRAGMA journal_mode=WAL;PRAGMA synchronous=FULL;
   CREATE TABLE IF NOT EXISTS global_cursor(id INTEGER PRIMARY KEY CHECK(id=1),cursor INTEGER NOT NULL,observed_head INTEGER NOT NULL);INSERT OR IGNORE INTO global_cursor VALUES(1,0,0);
   CREATE TABLE IF NOT EXISTS halted_topic_cursors(topic TEXT PRIMARY KEY,generation INTEGER NOT NULL,cursor INTEGER NOT NULL,state TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS client_messages(topic TEXT NOT NULL,msg_id TEXT NOT NULL,seq INTEGER NOT NULL,deleted INTEGER NOT NULL,hash TEXT NOT NULL,message_json TEXT,PRIMARY KEY(topic,msg_id));`);
 }
 cursor(){return this.db.prepare('SELECT cursor FROM global_cursor').get().cursor;}
 holds(){return plain(this.db.prepare('SELECT * FROM halted_topic_cursors ORDER BY topic').all());}
 map(topic){return this.holds().find(x=>x.topic===topic);}
 snapshot(){return {globalCursor:this.cursor(),haltedTopicCursors:this.holds(),messages:plain(this.db.prepare('SELECT * FROM client_messages ORDER BY topic,msg_id').all())};}
 status(){const active=this.holds().filter(x=>x.state!=='complete'),head=this.db.prepare('SELECT observed_head FROM global_cursor').get().observed_head;return {globalCursor:this.cursor(),observedHead:head,complete:active.length===0&&this.cursor()>=head,integrity:active.length?'known-incomplete':'no-known-halt',haltedTopics:active.map(x=>x.topic)};}
 event(e){
  if(!this.allowed.includes(keyOf(e)))throw fail('TOPIC_NOT_ALLOWED',403);
  const previous=this.db.prepare('SELECT seq FROM client_messages WHERE topic=? AND msg_id=?').get(keyOf(e),e.msgId);
  // Needed when an older damaged row is discovered behind a previously
  // scanned cursor: repair must never replace an already newer projection.
  if(previous&&previous.seq>=e.seq)return;
  this.db.prepare(`INSERT INTO client_messages VALUES(?,?,?,?,?,?) ON CONFLICT(topic,msg_id) DO UPDATE SET seq=excluded.seq,deleted=excluded.deleted,hash=excluded.hash,message_json=excluded.message_json`).run(keyOf(e),e.msgId,e.seq,e.action==='delete'?1:0,e.hash,e.message?JSON.stringify(e.message):null);
 }
 global(frame){
  const cursor=this.cursor();if(frame.protocol!==CAPABILITY||frame.baseCursor!==cursor||!integer(frame.nextSeq)||frame.nextSeq<cursor||frame.nextSeq>frame.headSeq)throw fail('GLOBAL_CURSOR_RACE');
  this.db.exec('BEGIN IMMEDIATE');
  try{
   for(const barrier of frame.haltedTopics){
    if(!this.allowed.includes(barrier.topic)||!['halted','repaired'].includes(barrier.status)||!Number.isSafeInteger(barrier.generation)||barrier.generation<1||!Number.isSafeInteger(barrier.first_unsafe_seq)||barrier.first_unsafe_seq<1)throw fail('INVALID_HALT_DESCRIPTOR');
    const old=this.map(barrier.topic);if(old&&barrier.generation<old.generation)throw fail('HALT_GENERATION_REWIND');
    if(!old||old.generation<barrier.generation){const after=Math.min(cursor,barrier.first_unsafe_seq-1,old?.cursor??cursor);this.db.prepare('INSERT INTO halted_topic_cursors VALUES(?,?,?,?) ON CONFLICT(topic) DO UPDATE SET generation=excluded.generation,cursor=excluded.cursor,state=excluded.state').run(barrier.topic,barrier.generation,after,barrier.status==='repaired'?'recovering':'halted');}
    else if(old.state!=='complete'&&barrier.status==='repaired')this.db.prepare("UPDATE halted_topic_cursors SET state='recovering' WHERE topic=?").run(barrier.topic);
    else if(old.state==='complete'&&barrier.status==='halted')throw fail('HALT_GENERATION_REUSED');
   }
   let previous=cursor;
   for(const event of frame.events){
    if(!Number.isSafeInteger(event.seq)||event.seq<=previous||event.seq>frame.nextSeq||!this.allowed.includes(keyOf(event)))throw fail('INVALID_GLOBAL_PAGE');
    previous=event.seq;if(!this.map(keyOf(event))||this.map(keyOf(event)).state==='complete')this.event(event);
   }
   this.db.prepare('UPDATE global_cursor SET cursor=?,observed_head=MAX(observed_head,?)').run(frame.nextSeq,frame.headSeq);
   this.fault('client-before-commit');this.db.exec('COMMIT');this.fault('client-after-commit');
  }catch(e){if(this.db.isTransaction)this.db.exec('ROLLBACK');throw e;}
 }
 recovered(frame){
  const old=this.map(frame.topic);
  if(frame.protocol!==CAPABILITY||!old||old.state==='complete'||old.generation!==frame.generation||old.cursor!==frame.baseCursor||frame.through!==this.cursor())throw fail('CATCHUP_CURSOR_RACE');
  if(!integer(frame.nextCursor)||frame.nextCursor<old.cursor||frame.nextCursor>frame.through||!frame.hasMore&&frame.nextCursor!==frame.through)throw fail('INVALID_CATCHUP_PAGE');
  this.db.exec('BEGIN IMMEDIATE');
  try{
   let previous=old.cursor;
   for(const event of frame.events){if(keyOf(event)!==frame.topic||!Number.isSafeInteger(event.seq)||event.seq<=previous||event.seq>frame.nextCursor)throw fail('INVALID_CATCHUP_PAGE');this.event(event);previous=event.seq;}
   this.db.prepare('UPDATE halted_topic_cursors SET cursor=?,state=? WHERE topic=?').run(frame.nextCursor,frame.hasMore?'recovering':'complete',frame.topic);
   this.fault('client-before-commit');this.db.exec('COMMIT');this.fault('client-after-commit');
  }catch(e){if(this.db.isTransaction)this.db.exec('ROLLBACK');throw e;}
 }
 close(){this.db.close();}
}
module.exports={Server,Client,CAPABILITY,keyOf,hash,fail};
