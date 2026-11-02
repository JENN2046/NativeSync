'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),{spawnSync}=require('node:child_process'),{DatabaseSync}=require('node:sqlite'),{createHash}=require('node:crypto');
const {fixture,selected,older,wireTopic,message,BOX}=require('./fixtures/boundedSourceHarness.cjs');
const context=require(BOX+'/modules/requestExecutionContext'),lifecycle=require('./fixtures/executionLifecyclePrototype.cjs'),batch=require('./fixtures/predicateBatchPrototype.cjs');
const schema='CREATE TABLE mobile_executions(id TEXT PRIMARY KEY,state TEXT,kind TEXT,cancel_requested INTEGER,request_dispatched INTEGER,tool_started INTEGER,pending_operation TEXT,error_code TEXT,updated_at INTEGER)';
const row=(id,change={})=>({id,state:'running',kind:null,cancel_requested:0,request_dispatched:1,tool_started:0,pending_operation:null,error_code:null,updated_at:1,...change});
function insert(db,r){const keys=Object.keys(r);db.prepare('INSERT INTO mobile_executions('+keys.join(',')+') VALUES('+keys.map(()=>'?').join(',')+')').run(...keys.map(k=>r[k]));}
const step=r=>require('../packages/execution-decisions/src/lifecycle.mjs').step(r,{type:'restart',observedAt:12345});
test('JSON CHECK rejects syntax but cannot establish message identity or hash integrity',()=>{
 const db=new DatabaseSync(':memory:');try{
  db.exec('CREATE TABLE guarded(seq INTEGER PRIMARY KEY AUTOINCREMENT,message_json TEXT CHECK(message_json IS NULL OR json_valid(message_json)),hash TEXT)');
  const put=db.prepare('INSERT INTO guarded(message_json,hash) VALUES(?,?)');assert.throws(()=>put.run('{','bad'),/CHECK constraint failed/);
  assert.equal(put.run(JSON.stringify({id:'wrong',content:'changed'}),'not-a-content-hash').lastInsertRowid,1);put.run(null,'tombstone');
  assert.equal(db.prepare('SELECT count(*) n FROM guarded').get().n,2);
 }finally{db.close();}
});
test('current Journal has no topic sequence/op id and same accepted op replays the original receipt',async t=>{
 const f=await fixture(t),op={...wireTopic(selected),msgId:'repair-op',deviceId:'synthetic-peer',opId:'repair-op',action:'upsert',baseHash:null,message:message('repair-op')},first=f.store.apply(op),before=f.store.metrics();
 const columns=f.store.db.prepare('PRAGMA table_info(journal)').all().map(c=>c.name);assert.ok(!columns.includes('topic_seq')&&!columns.includes('op_id'));
 assert.deepEqual(f.store.apply(op),{...first,replayed:true});assert.deepEqual(f.store.metrics(),before);
 const event=f.store.pull(first.seq-1).events[0];assert.ok(!Object.hasOwn(event,'opId')&&!Object.hasOwn(event,'topicSeq'));
});
test('online integrity barrier rejects the historical old-version republication counterexample',async t=>{
 const f=await fixture(t);await f.adopt();await f.pump();
 const op={...wireTopic(selected),msgId:'repair-version',deviceId:'synthetic-peer',opId:'repair-version-1',action:'upsert',baseHash:null,message:message('repair-version','version-1')},first=f.store.apply(op);
 await f.adapter.pull();const second=f.store.apply({...op,opId:'repair-version-2',baseHash:first.hash,message:message('repair-version','version-2')});await f.adapter.pull();
 assert.equal((await f.queue.read(selected)).find(m=>m.id===op.msgId).content,'version-2');
 // Deliberately unsafe repair: bypass CentralStore only in this temporary DB.
 const original=f.store.db.prepare('SELECT * FROM journal WHERE seq=?').get(first.seq),keys=Object.keys(original).filter(k=>k!=='seq');
 const appended=Number(f.store.db.prepare('INSERT INTO journal('+keys.join(',')+') VALUES('+keys.map(()=>'?').join(',')+')').run(...keys.map(k=>original[k])).lastInsertRowid);
 assert.ok(appended>second.seq);await assert.rejects(()=>f.adapter.pull(),e=>e.code==='SYNC_STORAGE_CORRUPT'&&e.status===500);
 assert.equal(f.adapter.state.cursor,second.seq);
 assert.equal((await f.queue.read(selected)).find(m=>m.id===op.msgId).content,'version-2');
 assert.equal(f.store.db.prepare('SELECT hash FROM messages WHERE msg_id=?').get(op.msgId).hash,second.hash);
});
test('server repair before resuming the unchanged cursor recovers both topics without a new protocol',async t=>{
 const f=await fixture(t);await f.adopt();await f.pump();const cursor=f.adapter.state.cursor;
 const op={...wireTopic(selected),msgId:'repair-in-place',deviceId:'synthetic-peer',opId:'repair-in-place',action:'upsert',baseHash:null,message:message('repair-in-place')},bad=f.store.apply(op),good=f.store.apply({...op,...wireTopic(older),msgId:'healthy-repair',opId:'healthy-repair',message:message('healthy-repair')});
 const json=f.store.db.prepare('SELECT message_json FROM journal WHERE seq=?').get(bad.seq).message_json;f.injectLegacyStorageFault('journal',()=>f.store.db.prepare('UPDATE journal SET message_json=? WHERE seq=?').run('{',bad.seq));
 // The real adapter/HTTP path exposes the repaired storage error; no request is malformed.
 await assert.rejects(()=>f.adapter.pull(),e=>e.code==='SYNC_STORAGE_CORRUPT'&&e.status===500);assert.equal(f.adapter.state.cursor,cursor);
 const request=f.sent.at(-1);assert.ok(request.route.includes('pull'));
 f.store.db.prepare('UPDATE journal SET message_json=? WHERE seq=?').run(json,bad.seq);await f.adapter.pull();
 assert.equal(f.adapter.state.cursor,good.seq);assert.ok((await f.queue.read(selected)).some(m=>m.id===op.msgId));assert.ok((await f.queue.read(older)).some(m=>m.id==='healthy-repair'));
});
async function prepared(t){
 const f=await fixture(t,{executionBindings:[{key:'boundary-topic',...wireTopic(older),agentAlias:'synthetic-one'}]});await f.adopt();await f.pump();
 await f.portal.engine.configs.publish({topics:[{...wireTopic(older),expectedVersion:0,config:{name:'Synthetic',systemPrompt:'[[VCPToolUse=Forbidden]]\nSynthetic',model:'synthetic-model',maxOutputTokens:32}}]});return f;
}
test('real effect-loss review can be resolved over authenticated PWA HTTP without retrying the old effect',async t=>{
 const f=await prepared(t),phone=await f.phone(),sessionJob=await phone.call('/conversations/boundary-topic/messages',{requestId:'manual-resolution-1',text:'synthetic'},202),job=f.portal.engine.get(sessionJob.id),effectFile=path.join(f.root,'manual-effect.txt'),input=path.join(f.root,'manual-input.json');
 await fs.writeFile(input,JSON.stringify({root:f.root,dbPath:path.join(f.root,'central.sqlite'),jobId:job.id,effectFile}));
 const child=spawnSync(process.execPath,[path.join(__dirname,'fixtures/executionBoundaryChild.cjs'),input,'external-effect'],{env:process.env,encoding:'utf8',timeout:10000});assert.equal(child.status,78,child.stderr);f.portal.engine.recover();
 assert.ok(f.portal.engine.dependencyHeld('boundary-topic'));assert.throws(()=>f.portal.engine.resolveReview(job.id,'foreign-session','acknowledge_and_abandon_remaining'),e=>e.status===404);
 const before=f.store.metrics(),native=f.portal.engine.nativeTasks.invocations(job.id);assert.equal(native[0].state,'started');
 const resolved=await phone.call('/executions/'+job.id+'/resolve',{action:'acknowledge_and_abandon_remaining'});assert.equal(resolved.reviewResolved,true);assert.equal(resolved.state,'cancelled');assert.ok(!f.portal.engine.dependencyHeld('boundary-topic'));
 assert.deepEqual(f.store.metrics(),before);assert.deepEqual(f.portal.engine.nativeTasks.invocations(job.id),native);assert.equal(f.portal.engine.get(job.id).attempts,1);assert.match(f.portal.engine.get(job.id).error_code,/REVIEW_REQUIRED$/);
 const next=await phone.call('/conversations/boundary-topic/messages',{requestId:'manual-resolution-2',text:'new explicit request'},202);assert.notEqual(next.id,job.id);assert.equal((await fs.readFile(effectFile,'utf8')).trim(),'effect');
});
test('existing native AA provider query resolves unknown task evidence without dispatching it again',async t=>{
 const f=await prepared(t),job=f.portal.engine.accept('probe-session',{topicKey:'boundary-topic',requestId:'probe-existing',text:'synthetic'}),release=context.register(job.id,null,f.portal.engine.nativeTasks.hooks(job.id));let accepted,dispatches=0;
 try{await context.run(job.id,new AbortController().signal,()=>context.runToolInvocation({pluginName:'AgentAssistant'},async()=>{dispatches++;accepted=await context.acceptNativeTask({pluginName:'AgentAssistant',nativeTaskId:'aa-delegation-probe',agentBaseName:'synthetic-one'});}));}finally{release();}
 f.store.db.prepare("UPDATE mobile_executions SET state='completed',attempts=1 WHERE id=?").run(job.id);await f.portal.engine.nativeTasks.reconcile(true);assert.equal(f.portal.engine.nativeTasks.list(job.id)[0].state,'unknown');assert.ok(f.portal.engine.dependencyHeld('boundary-topic'));
 const content='synthetic native archived result',proof={...accepted.identity,state:'completed',schemaVersion:1,revision:1,nativeStatus:'Succeed',resultRef:'synthetic-only-archive',resultHash:createHash('sha256').update(content).digest('hex'),summary:'synthetic',endTime:12345};
 let queries=0;const unregister=context.registerNativeTaskProvider('AgentAssistant',async identity=>{queries++;assert.equal(identity.invocationId,accepted.identity.invocationId);return {...proof,...(identity.includeResult?{resultContent:content}:{})};});
 try{const before=f.store.metrics();await f.portal.engine.nativeTasks.reconcile(true);assert.equal(f.portal.engine.nativeTasks.list(job.id)[0].state,'completed');assert.ok(!f.portal.engine.dependencyHeld('boundary-topic'));assert.equal((await f.portal.engine.nativeTaskResult('boundary-topic',job.id,proof.nativeTaskId)).content,content);assert.equal(dispatches,1);assert.equal(queries,2);assert.deepEqual(f.store.metrics(),before);}finally{unregister();}
});
test('predicate batching preserves per-row results, chunks parameters and rejects duplicate identities',()=>{
 const db=new DatabaseSync(':memory:'),oracle=new DatabaseSync(':memory:');db.exec(schema);oracle.exec(schema);
 try{const plans=[];let i=0;for(const state of ['running','cancelling','waiting_approval'])for(const dispatched of [null,0,1])for(const cancel of [0,1])for(const tool of [0,1]){const r=row('row-'+i++,{state,request_dispatched:dispatched,cancel_requested:cancel,tool_started:tool});insert(db,r);insert(oracle,r);plans.push(step(r));}
  for(let n=0;n<2100;n++){const r=row('extra-'+n);insert(db,r);insert(oracle,r);plans.push(step(r));}
  for(const p of plans)lifecycle.applyDecision(oracle,p);const stats=batch.applyPlans(db,plans);assert.equal(stats.groups,36);assert.ok(stats.statements>stats.groups);assert.deepEqual(db.prepare('SELECT * FROM mobile_executions ORDER BY id').all(),oracle.prepare('SELECT * FROM mobile_executions ORDER BY id').all());
  assert.throws(()=>batch.applyPlans(db,[plans[0],plans[0]]),e=>e.code==='INVALID_EXECUTION_DECISION');
 }finally{db.close();oracle.close();}
});
test('every guarded field remains authoritative; a stale later group rolls back earlier groups',()=>{
 for(const [field,value]of Object.entries({state:'waiting_approval',kind:'group_message',cancel_requested:1,request_dispatched:0,tool_started:1,pending_operation:'{"new":"fact"}'})){
  const db=new DatabaseSync(':memory:');try{db.exec(schema);const a=row('first'),b=row('later',{state:'cancelling'});insert(db,a);insert(db,b);const plans=[step(a),step(b)];db.prepare('UPDATE mobile_executions SET '+field+'=? WHERE id=?').run(value,b.id);const before=db.prepare('SELECT * FROM mobile_executions ORDER BY id').all();assert.throws(()=>batch.applyPlans(db,plans),e=>e.code==='EXECUTION_OBSERVATION_STALE');assert.deepEqual(db.prepare('SELECT * FROM mobile_executions ORDER BY id').all(),before);}finally{db.close();}
 }
});
test('group count is data dependent: distinct durable pending operations produce 100 groups',()=>{
 const plans=Array.from({length:100},(_,i)=>step(row('pending-'+i,{pending_operation:JSON.stringify({opId:'unique-'+i})})));assert.equal(batch.groupPlans(plans).length,100);
});
