'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{spawnSync}=require('node:child_process'),{DatabaseSync}=require('node:sqlite'),{createHash}=require('node:crypto');
const {fixture,selected,older,wireTopic,message,BOX,messageHash}=require('./fixtures/boundedSourceHarness.cjs');
const {CentralStore}=require(BOX+'/Plugin/NativeSync/sync/centralStore'),{createSyncHttpService}=require(BOX+'/Plugin/NativeSync/sync/httpService');
const op=(id,extra={})=>({...wireTopic(selected),msgId:id,deviceId:'synthetic-integrity',opId:id,action:'upsert',baseHash:null,message:message(id),...extra});
const corrupt=e=>e.code==='SYNC_STORAGE_CORRUPT'&&e.status===500;
test('legacy tables gain JSON guards without rewriting accepted rows, receipts or sequence identity',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'nativesync-old-json-')),file=path.join(root,'old.sqlite');t.after(()=>fs.rm(root,{recursive:true,force:true}));let db=new DatabaseSync(file),m=message('legacy'),hash=messageHash(m),receipt=JSON.stringify({seq:41,hash,deleted:false});
 db.exec('CREATE TABLE journal(seq INTEGER PRIMARY KEY AUTOINCREMENT,owner_type TEXT NOT NULL,owner_id TEXT NOT NULL,topic_id TEXT NOT NULL,msg_id TEXT NOT NULL,action TEXT NOT NULL,hash TEXT NOT NULL,message_json TEXT,device_id TEXT NOT NULL); CREATE TABLE messages(owner_type TEXT NOT NULL,owner_id TEXT NOT NULL,topic_id TEXT NOT NULL,msg_id TEXT NOT NULL,hash TEXT NOT NULL,deleted INTEGER NOT NULL,message_json TEXT,last_seq INTEGER NOT NULL,PRIMARY KEY(owner_type,owner_id,topic_id,msg_id)); CREATE TABLE applied_ops(device_id TEXT NOT NULL,op_id TEXT NOT NULL,request_hash TEXT NOT NULL,result_json TEXT NOT NULL,PRIMARY KEY(device_id,op_id))');
 db.prepare("INSERT INTO journal VALUES(41,'agent','one','selected','legacy','upsert',?,?,'legacy-device')").run(hash,JSON.stringify(m));db.prepare("INSERT INTO messages VALUES('agent','one','selected','legacy',?,0,?,41)").run(hash,JSON.stringify(m));db.prepare("INSERT INTO applied_ops VALUES('legacy-device','legacy-op',?,?)").run('a'.repeat(64),receipt);db.close();
 const store=new CentralStore(file);try{
  assert.equal(store.db.prepare('SELECT result_json FROM applied_ops').get().result_json,receipt);assert.equal(store.projectMessage(store.findMessage.get('agent','one','selected','legacy')).id,'legacy');
  assert.equal(store.db.prepare("SELECT count(*) n FROM sqlite_master WHERE type='trigger' AND name LIKE 'nativesync_json_%'").get().n,6);
  for(const [table,column]of [['journal','message_json'],['messages','message_json'],['applied_ops','result_json']])assert.throws(()=>store.db.prepare('UPDATE '+table+' SET '+column+'=?').run('{'),/NATIVESYNC_INVALID_JSON/);
  assert.throws(()=>store.db.prepare("INSERT INTO journal(owner_type,owner_id,topic_id,msg_id,action,hash,message_json,device_id) VALUES('agent','one','selected','bad','upsert',?,'{','synthetic')").run(hash),/NATIVESYNC_INVALID_JSON/);
  const next=store.apply(op('after-legacy'));assert.equal(next.seq,42);const deletion=store.apply(op('after-legacy',{opId:'delete-after-legacy',action:'delete',baseHash:next.hash,message:undefined}));assert.equal(deletion.seq,43);assert.equal(store.projectMessage(store.findMessage.get('agent','one','selected','after-legacy')),null);
 }finally{store.close();}
});
test('stored projections reject malformed JSON, wrong identity/hash, metadata authority and malformed deletion',async t=>{
 const f=await fixture(t),r=f.store.db.prepare("SELECT * FROM journal WHERE action='upsert' AND metadata_version=0 LIMIT 1").get();assert.ok(f.store.projectMessage(r));
 for(const change of [{message_json:'{'},{message_json:'null'},{message_json:'[]'},{message_json:'"valid-json-string"'},{message_json:null},{message_json:JSON.stringify({...JSON.parse(r.message_json),id:'wrong'})},{message_json:JSON.stringify({...JSON.parse(r.message_json),content:'synthetic-corrupt-private-content'})},{hash:'a'.repeat(64)},{action:'unknown'},{metadata_version:1,metadata_hash:'a'.repeat(64)},{metadata_version:0,metadata_hash:'a'.repeat(64)},{seq:0}])assert.throws(()=>f.store.projectMessage({...r,...change}),corrupt);
 const first=f.store.apply(op('valid-delete')),deleted=f.store.apply(op('valid-delete',{opId:'valid-delete-2',action:'delete',baseHash:first.hash,message:undefined})),d=f.store.db.prepare('SELECT * FROM journal WHERE seq=?').get(deleted.seq);assert.equal(f.store.projectMessage(d),null);assert.throws(()=>f.store.projectMessage({...d,message_json:'{}'}),corrupt);assert.throws(()=>f.store.projectMessage({...d,hash:'a'.repeat(64)}),corrupt);
});
test('authorized corruption is a sanitized HTTP500 and cannot advance desktop or mobile catch-up',async t=>{
 const f=await fixture(t);await f.adopt();await f.pump();const phone=await f.phone(),topic=phone.topics.find(t=>t.ownerId===selected.itemId&&t.topicId===selected.topicId),cursor=f.adapter.state.cursor,bad=f.store.apply(op('bad-history')),good=f.store.apply(op('healthy-history',{...wireTopic(older)}));
 const original=f.store.db.prepare('SELECT message_json FROM journal WHERE seq=?').get(bad.seq).message_json;
 f.injectLegacyStorageFault('journal',()=>f.store.db.prepare('UPDATE journal SET message_json=? WHERE seq=?').run('{"private":"synthetic-secret-fragment',bad.seq));
 await assert.rejects(()=>f.adapter.pull(),corrupt);assert.equal(f.adapter.state.cursor,cursor);assert.equal((await f.queue.read(older)).some(m=>m.id==='healthy-history'),false);
 const result=await phone.call('/conversations/'+topic.key+'/events?after='+cursor,undefined,500);assert.deepEqual(result,{error:{code:'SYNC_STORAGE_CORRUPT'}});
 const baseline=await phone.call('/conversations/'+topic.key+'/baseline',{requestId:'corrupt-baseline'});assert.deepEqual(await phone.call('/conversations/'+topic.key+'/baseline/'+baseline.id+'?after=0&limit=100',undefined,500),{error:{code:'SYNC_STORAGE_CORRUPT'}});
 f.store.db.prepare('UPDATE journal SET message_json=? WHERE seq=?').run(original,bad.seq);await f.adapter.pull();assert.equal(f.adapter.state.cursor,good.seq);assert.ok((await f.queue.read(older)).some(m=>m.id==='healthy-history'));
});
test('valid JSON corruption is rejected by the current mobile history projection as well',async t=>{
 const f=await fixture(t);await f.adopt();await f.pump();const phone=await f.phone(),topic=phone.topics.find(t=>t.ownerId===selected.itemId&&t.topicId===selected.topicId),receipt=f.store.apply(op('wrong-current')),r=f.store.findMessage.get('agent','one','selected','wrong-current');
 f.store.db.prepare('UPDATE messages SET message_json=? WHERE msg_id=?').run(JSON.stringify({...JSON.parse(r.message_json),content:'tampered-current'}),'wrong-current');
 assert.deepEqual(await phone.call('/conversations/'+topic.key+'?after='+(receipt.seq-1),undefined,500),{error:{code:'SYNC_STORAGE_CORRUPT'}});
 const before=f.store.metrics();assert.throws(()=>f.store.apply(op('wrong-current',{opId:'must-not-overwrite-corruption',baseHash:receipt.hash,message:message('wrong-current','new content')})),corrupt);assert.deepEqual(f.store.metrics(),before);
});
test('a corrupt idempotency receipt is an internal storage failure; original replay still works after restoration',async t=>{
 const f=await fixture(t),operation=op('receipt-validation'),first=f.store.apply(operation),before=f.store.metrics(),old=f.store.findOp.get(operation.deviceId,operation.opId).result_json;
 for(const invalid of ['{',JSON.stringify({seq:first.seq,hash:'a'.repeat(64),deleted:false}),JSON.stringify({seq:first.seq,hash:first.hash,deleted:false,metadataVersion:1})]){
  f.injectLegacyStorageFault('applied_ops',()=>f.store.db.prepare('UPDATE applied_ops SET result_json=? WHERE device_id=? AND op_id=?').run(invalid,operation.deviceId,operation.opId));assert.throws(()=>f.store.apply(operation),corrupt);assert.deepEqual(f.store.metrics(),before);
 }
 f.store.db.prepare('UPDATE applied_ops SET result_json=? WHERE device_id=? AND op_id=?').run(old,operation.deviceId,operation.opId);assert.deepEqual(f.store.apply(operation),{...first,replayed:true});assert.deepEqual(f.store.metrics(),before);
});
test('corrupt rows outside the authorized topic are not decoded or exposed',async t=>{
 const f=await fixture(t),cursor=f.store.metrics().headSeq,bad=f.store.apply(op('outside-poison')),good=f.store.apply(op('allowed-healthy',{...wireTopic(older)}));f.injectLegacyStorageFault('journal',()=>f.store.db.prepare('UPDATE journal SET message_json=? WHERE seq=?').run('{',bad.seq));
 const result=f.store.pull(cursor,100,[JSON.stringify(['agent','one','old'])]);assert.deepEqual(result.events.map(e=>e.msgId),['allowed-healthy']);assert.equal(result.nextSeq,good.seq);
});
async function handle(store,{url='/pull',method='GET',body,raw}={}){
 const service=createSyncHttpService(store),req={url,method,headers:{'x-nativesync-protocol':'2','x-nativesync-capabilities':'message-intents-v1,attachments-v1'},...(body===undefined?{}:{body}),async *[Symbol.asyncIterator](){yield raw??'{';}},response={writeHead(status){this.status=status;},end(text){this.body=JSON.parse(text);}};await service.handle(req,response);return response;
}
test('request errors stay 4xx; unexpected server and SQLite errors become sanitized 5xx',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'nativesync-http-errors-')),store=new CentralStore(path.join(root,'central.sqlite'));t.after(async()=>{store.close();await fs.rm(root,{recursive:true,force:true});});
 for(const request of [{url:'/pull?after_seq=-1'},{url:'/push',method:'POST',raw:'{'},{url:'/push',method:'POST',body:op('invalid-id',{ownerId:'../invalid'})},{url:'/push',method:'POST',body:op('invalid-content',{message:{id:'invalid-content',timestamp:1}})}])assert.equal((await handle(store,request)).status,400);
 const old=store.pull.bind(store);try{
  for(const injected of [Error('synthetic private contents'),Object.assign(Error('synthetic sqlite private'),{code:'ERR_SQLITE_ERROR',errcode:11}),Object.assign(Error('synthetic unavailable'),{code:'HOST_DRAINING',status:503})]){
   store.pull=()=>{throw injected;};const response=await handle(store);assert.equal(response.status,injected.status||500);assert.ok(['SYNC_INTERNAL_ERROR','SYNC_STORAGE_CORRUPT','HOST_DRAINING'].includes(response.body.error.code));assert.ok(!JSON.stringify(response.body).includes('private'));
  }
 }finally{store.pull=old;}
});
test('invalid source catalog and legacy proof identities remain client errors with every table unchanged',async t=>{
 const f=await fixture(t);await f.adopt();await f.pump();const before=f.store.metrics(),revision=f.store.sourceCatalog.revision('sourceA');
 await assert.rejects(()=>f.send('/api/v1/sync/source/catalog',{body:{opId:'invalid-source-identity',baseRevision:revision,agents:[{ownerType:'agent',ownerId:'../bad',name:'synthetic'}],topics:[],removed:[]}}),e=>e.status===400&&e.code==='INVALID_IDENTITY');
 await assert.rejects(()=>f.send('/api/v1/sync/source/verify-state',{body:{cursor:0,records:[{ownerType:'agent',ownerId:'../bad',topicId:'selected',msgId:'m',seq:1,hash:'a'.repeat(64)}]}}),e=>e.status===400&&e.code==='INVALID_IDENTITY');
 assert.deepEqual(f.store.metrics(),before);assert.equal(f.store.sourceCatalog.revision('sourceA'),revision);
});
function runCheck(file){return spawnSync(process.execPath,[path.resolve(__dirname,'../tools/check_sync_storage.cjs'),'--db',file,'--toolbox',BOX],{encoding:'utf8',env:{PATH:process.env.PATH,LANG:'C.UTF-8'},timeout:10000});}
async function persistentBytes(file){const result={};for(const name of [file,file+'-wal'])try{result[path.basename(name)]=createHash('sha256').update(await fs.readFile(name)).digest('hex');}catch(e){if(e.code!=='ENOENT')throw e;}return result;}
test('offline checker reads current WAL facts without changing data/schema/bytes or reporting body contents',async t=>{
 const f=await fixture(t),file=path.join(f.root,'central.sqlite');for(let i=0;i<140;i++)f.store.apply(op('check-page-'+i));f.store.db.exec('UPDATE messages SET rowid=-1 WHERE rowid=(SELECT min(rowid) FROM messages)');const before=await persistentBytes(file),schema=f.store.db.prepare('SELECT type,name,sql FROM sqlite_master ORDER BY name').all(),metrics=f.store.metrics(),result=runCheck(file);assert.equal(result.status,0,result.stderr);const report=JSON.parse(result.stdout);assert.equal(report.ok,true);assert.equal(report.issues,0);assert.equal(report.checked.journal,metrics.journalRows);assert.ok(report.checked.messages>128);assert.deepEqual(await persistentBytes(file),before);assert.deepEqual(f.store.metrics(),metrics);assert.deepEqual(f.store.db.prepare('SELECT type,name,sql FROM sqlite_master ORDER BY name').all(),schema);assert.ok(!result.stdout.includes('synthetic accepted message'));
});
test('offline checker reports corruption and broken references with bounded samples, without repairing',async t=>{
 const f=await fixture(t),file=path.join(f.root,'central.sqlite'),r=f.store.db.prepare('SELECT * FROM messages LIMIT 1').get();
 for(let i=0;i<25;i++)f.store.db.prepare('INSERT INTO messages VALUES(?,?,?,?,?,?,?,?,?,?)').run(r.owner_type,r.owner_id,r.topic_id,'corrupt-copy-'+i,r.hash,r.deleted,r.message_json,r.last_seq,r.metadata_version,r.metadata_hash);
 f.store.db.prepare('DELETE FROM messages WHERE owner_type=? AND owner_id=? AND topic_id=? AND msg_id=?').run(r.owner_type,r.owner_id,r.topic_id,r.msg_id);
 f.store.db.prepare("UPDATE applied_ops SET result_json=? WHERE rowid=(SELECT min(rowid) FROM applied_ops)").run(JSON.stringify({seq:99999,hash:'a'.repeat(64),deleted:false}));
 const before=await persistentBytes(file),result=runCheck(file);assert.equal(result.status,1,result.stderr);const report=JSON.parse(result.stdout);assert.equal(report.ok,false);assert.ok(report.issues>=26);assert.equal(report.samples.length,20);assert.deepEqual(await persistentBytes(file),before);
});
test('offline checker does not create missing databases or initialize legacy schemas',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'nativesync-check-missing-')),file=path.join(root,'missing.sqlite');t.after(()=>fs.rm(root,{recursive:true,force:true}));assert.equal(runCheck(file).status,2);await assert.rejects(()=>fs.access(file));
 const db=new DatabaseSync(file);db.exec('CREATE TABLE journal(seq INTEGER PRIMARY KEY)');db.close();const before=await fs.readFile(file),result=runCheck(file);assert.equal(result.status,1,result.stderr);assert.ok(JSON.parse(result.stdout).samples.some(s=>s.kind==='STORAGE_SCHEMA_UNSUPPORTED'));assert.deepEqual(await fs.readFile(file),before);
});

test('online reads preserve older versions, tombstones and many operations sharing one accepted sequence',async t=>{
 const f=await fixture(t),firstOp=op('online-versions',{message:message('online-versions','v1')}),v1=f.store.apply(firstOp);
 const v2=f.store.apply(op('online-versions',{opId:'online-versions-v2',baseHash:v1.hash,message:message('online-versions','v2')}));
 const duplicate=op('online-versions',{deviceId:'another-device',opId:'same-state-new-op',baseHash:null,message:message('online-versions','v2')});
 const same=f.store.apply(duplicate);assert.equal(same.seq,v2.seq);assert.equal(f.store.apply(duplicate).seq,v2.seq);
 const deleted=f.store.apply(op('online-versions',{opId:'online-versions-delete',baseHash:v2.hash,action:'delete',message:undefined}));
 const events=f.store.pull(v1.seq-1,100).events.filter(e=>e.msgId==='online-versions');assert.deepEqual(events.map(e=>e.message?.content??null),['v1','v2',null]);assert.equal(events.at(-1).seq,deleted.seq);
 assert.equal(f.store.apply(firstOp).seq,v1.seq);assert.equal(f.store.apply(duplicate).seq,v2.seq);
 const baseline=f.store.sourceCatalog.page({owner_type:'agent',owner_id:selected.itemId,topic_id:selected.topicId,watermark:v1.seq,total_rows:1},v1.seq-1,100);assert.equal(baseline.events.find(e=>e.msgId==='online-versions').message.content,'v1');
});

test('legal wrong-owner journal routing fails closed across pull, mobile events, baselines, projection and execution history',async t=>{
 const foreign={itemType:'agent',itemId:'other',topicId:selected.topicId};
 const f=await fixture(t,{scope:{mode:'full'},executionBindings:[{key:'integrity-foreign',...wireTopic(foreign),agentAlias:'synthetic-one',model:'synthetic-model'}]});
 await f.owner('other',{topics:[{id:foreign.topicId,name:'foreign'},{id:'excluded',name:'excluded'}]});await f.history(foreign,[message('foreign-existing')]);await f.adopt();await f.pump();
 await f.portal.engine.configs.publish({topics:[{...wireTopic(foreign),expectedVersion:0,config:{name:'Integrity',systemPrompt:'[[VCPToolUse=Forbidden]]\nSynthetic',model:'synthetic-model',maxOutputTokens:32}}]});
 const phone=await f.phone(),a=phone.topics.find(v=>v.ownerId===selected.itemId&&v.topicId===selected.topicId),b=phone.topics.find(v=>v.ownerId===foreign.itemId&&v.topicId===foreign.topicId),receipt=f.store.apply(op('wrong-routing'));
 f.store.db.prepare('UPDATE journal SET owner_id=? WHERE seq=?').run(foreign.itemId,receipt.seq);
 assert.throws(()=>f.store.pull(receipt.seq-1,100,[JSON.stringify([b.ownerType,b.ownerId,b.topicId])]),corrupt);
 await assert.rejects(()=>f.send('/api/v1/sync/source/pull?after_seq='+(receipt.seq-1)),corrupt);
 assert.deepEqual(await phone.call('/conversations/'+b.key+'/events?after='+(receipt.seq-1),undefined,500),{error:{code:'SYNC_STORAGE_CORRUPT'}});
 const baseline=await phone.call('/conversations/'+b.key+'/baseline',{requestId:'online-routing-baseline'});
 assert.deepEqual(await phone.call('/conversations/'+b.key+'/baseline/'+baseline.id+'?after=0&limit=100',undefined,500),{error:{code:'SYNC_STORAGE_CORRUPT'}});
 assert.deepEqual(await phone.call('/conversations/'+a.key+'?after='+(receipt.seq-1),undefined,500),{error:{code:'SYNC_STORAGE_CORRUPT'}});
 assert.throws(()=>f.store.apply(op('wrong-routing')),corrupt);
 const engine=f.portal.engine,topic=engine.topics.get(b.key);topic.agentAlias='synthetic-one';
 const accepted=engine.accept('integrity-session',{topicKey:b.key,requestId:'integrity-context',text:'synthetic'});engine.endpoint={url:'http://127.0.0.1:1/v1/chat/completions',key:'synthetic'};await engine.run(engine.get(accepted.id));const job=engine.get(accepted.id);assert.equal(job.state,'failed');assert.equal(job.error_code,'SYNC_STORAGE_CORRUPT');assert.equal(job.request_dispatched,0);
 // Group history uses the same barrier before context reaches any model.
 const groupA={ownerType:'group',ownerId:'integrity-a',topicId:'t'},groupB={ownerType:'group',ownerId:'integrity-b',topicId:'t'};
 const ga=f.store.apply(op('group-source',{...groupA,opId:'group-source'}));f.store.apply(op('group-healthy',{...groupB,opId:'group-healthy'}));f.store.db.prepare('UPDATE journal SET owner_id=? WHERE seq=?').run(groupB.ownerId,ga.seq);engine.topics.set('integrity-group',{key:'integrity-group',...groupB});
 assert.throws(()=>require(BOX+'/Plugin/NativeSync/mobile/groupTurn').history(engine,{id:'integrity-group-job',topic_key:'integrity-group',ordinal:0,user_seq:f.store.metrics().headSeq}),corrupt);
});

test('projection head holes, mismatched heads and dangling newer journal rows are rejected without overwriting evidence',async t=>{
 const f=await fixture(t),r=f.store.apply(op('head-check')),where=['agent',selected.itemId,selected.topicId,'head-check'];
 const get=()=>f.store.findMessage.get(...where),set=f.store.db.prepare('UPDATE messages SET last_seq=? WHERE owner_type=? AND owner_id=? AND topic_id=? AND msg_id=?');
 set.run(999999,...where);assert.throws(()=>f.store.projectMessage(get()),corrupt);set.run(r.seq,...where);
 f.store.db.prepare('UPDATE journal SET hash=? WHERE seq=?').run('b'.repeat(64),r.seq);assert.throws(()=>f.store.projectMessage(get()),corrupt);f.store.db.prepare('UPDATE journal SET hash=? WHERE seq=?').run(r.hash,r.seq);
 const original=f.store.db.prepare('SELECT * FROM journal WHERE seq=?').get(r.seq),columns=Object.keys(original).filter(k=>k!=='seq');const tail=Number(f.store.db.prepare('INSERT INTO journal('+columns.join(',')+') VALUES('+columns.map(()=>'?').join(',')+')').run(...columns.map(k=>original[k])).lastInsertRowid);
 assert.throws(()=>f.store.projectMessage(get()),corrupt);assert.equal(get().last_seq,r.seq);assert.equal(f.store.db.prepare('SELECT seq FROM journal WHERE seq=?').get(tail).seq,tail);
});

test('all page associations share a read snapshot while a different connection commits a legitimate update',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'native-read-snapshot-')),file=path.join(root,'central.sqlite'),reader=new CentralStore(file),writer=new CentralStore(file);t.after(async()=>{reader.close();writer.close();await fs.rm(root,{recursive:true,force:true});});
 const v1=writer.apply(op('snapshot-concurrent',{message:message('snapshot-concurrent','before')}));
 const result=reader.readSnapshot(()=>{
  const rows=reader.db.prepare('SELECT * FROM messages').all();assert(reader.db.isTransaction);
  writer.apply(op('snapshot-concurrent',{opId:'snapshot-after',baseHash:v1.hash,message:message('snapshot-concurrent','after')}));
  return reader.projectRows(rows);
 });assert.equal(result[0].content,'before');assert.equal(reader.readProjected(db=>db.prepare('SELECT * FROM messages').all())[0].message.content,'after');assert.equal(reader.db.isTransaction,false);
});

test('targeted verification uses indexed message identities and batches across the 128-row boundary',async t=>{
 const f=await fixture(t);for(let i=0;i<129;i++)f.store.apply(op('batch-head-'+i));
 const tuple=JSON.stringify([['agent',selected.itemId,selected.topicId,'batch-head-0']]);
 for(const [statement,index]of [[f.store.readProjections,'sqlite_autoindex_messages'],[f.store.readLatestSeqs,'idx_journal_message']]){
  const plan=f.store.db.prepare('EXPLAIN QUERY PLAN '+statement.sourceSQL).all(tuple).map(r=>r.detail).join('\n');assert(plan.includes(index),plan);assert(!/\bSCAN (?:m|j|messages|journal)\b/.test(plan),plan);
 }
 const sizes=[],original=f.store.readProjections.all.bind(f.store.readProjections);f.store.readProjections.all=(value)=>{sizes.push(JSON.parse(value).length);return original(value);};
 const page=f.store.pull(0,500,[JSON.stringify(['agent',selected.itemId,selected.topicId])]);assert.equal(page.events.filter(e=>e.msgId.startsWith('batch-head-')).length,129);assert(sizes.length>=2);assert(sizes.every(n=>n<=128));
});
