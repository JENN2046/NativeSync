'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),{execFileSync,spawnSync}=require('node:child_process'),{pathToFileURL}=require('node:url'),{DatabaseSync}=require('node:sqlite');
const {fixture,older,wireTopic,BOX}=require('./fixtures/boundedSourceHarness.cjs');
const lifecycle=require(BOX+'/Plugin/NativeSync/mobile/executionLifecycle'),nativeContext=require(BOX+'/modules/requestExecutionContext');
async function prepared(t){
 const f=await fixture(t,{executionBindings:[{key:'boundary-topic',...wireTopic(older),agentAlias:'synthetic-one'}]});await f.adopt();await f.pump();
 await f.portal.engine.configs.publish({topics:[{...wireTopic(older),expectedVersion:0,config:{name:'Synthetic boundary',systemPrompt:'[[VCPToolUse=Forbidden]]\nSynthetic only',model:'synthetic-model',maxOutputTokens:32}}]});
 f.job=f.portal.engine.accept('boundary-session',{topicKey:'boundary-topic',requestId:'boundary-original-request',text:'synthetic'});return f;
}
async function appendEffect(file){const handle=await fs.open(file,'a',0o600);try{await handle.writeFile('effect\n');await handle.sync();}finally{await handle.close();}}
const schema="CREATE TABLE mobile_executions(id TEXT PRIMARY KEY,state TEXT,kind TEXT,cancel_requested INTEGER,request_dispatched INTEGER,tool_started INTEGER,pending_operation TEXT,updated_at INTEGER,error_code TEXT,user_seq INTEGER,reply_message_id TEXT,terminal_state TEXT)";
const initial=(change={})=>({id:'synthetic',state:'running',kind:null,cancel_requested:0,request_dispatched:null,tool_started:0,pending_operation:null,updated_at:1,error_code:null,user_seq:null,reply_message_id:null,terminal_state:'completed',...change});
function insert(db,row){const keys=Object.keys(row);db.prepare('INSERT INTO mobile_executions('+keys.join(',')+') VALUES('+keys.map(()=>'?').join(',')+')').run(...keys.map(k=>row[k]));}
test('pure restart decisions match the fixed original SQL across 252 flag/state combinations',async()=>{
 const {step}=await import(pathToFileURL(path.resolve(__dirname,'../packages/execution-decisions/src/lifecycle.mjs')));
 const old=execFileSync('git',['show','0c5cf07:overlays/VCPToolBox/Plugin/NativeSync/mobile/execution.js'],{encoding:'utf8'}),sql=old.match(/this\.db\.prepare\("(UPDATE mobile_executions SET state=CASE[^\n]+)"\)\.run\(Date\.now\(\)\);/)[1];
 const oracle=new DatabaseSync(':memory:'),actual=new DatabaseSync(':memory:');oracle.exec(schema);actual.exec(schema);let cases=0;
 try{for(const state of ['preparing','publishing','queued','running','waiting_approval','cancelling','completed'])for(const kind of [null,'group_message','group_invitation'])for(const cancel of [0,1])for(const dispatched of [null,0,1])for(const tool of [0,1]){
  const row=initial({state,kind,cancel_requested:cancel,request_dispatched:dispatched,tool_started:tool});oracle.exec('DELETE FROM mobile_executions');actual.exec('DELETE FROM mobile_executions');insert(oracle,row);insert(actual,row);oracle.prepare(sql).run(12345);
  const plan=step(Object.freeze({...row}),Object.freeze({type:'restart',observedAt:12345}));if(plan)lifecycle.applyDecision(actual,plan);assert.deepEqual(actual.prepare('SELECT * FROM mobile_executions').get(),oracle.prepare('SELECT * FROM mobile_executions').get());cases++;
 }}finally{oracle.close();actual.close();}assert.equal(cases,252);
});
test('10000 deterministic restart transitions are reproducible but do not authorize stale SQLite writes',async()=>{
 const {step}=await import(pathToFileURL(path.resolve(__dirname,'../packages/execution-decisions/src/lifecycle.mjs')));let seed=0x4e415449;const rand=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return seed>>>0;};
 for(let i=0;i<10000;i++){
  const row=Object.freeze(initial({state:['running','cancelling','waiting_approval'][rand()%3],cancel_requested:rand()%2,request_dispatched:[null,0,1][rand()%3],tool_started:rand()%2})),input=Object.freeze({type:'restart',observedAt:i}),a=step(row,input);assert.deepEqual(a,step(row,input));assert.ok(a.patch.state!=='queued');if(row.request_dispatched!==0||row.tool_started!==0)assert.equal(a.patch.state,'review_required');assert.equal(step({...row,...a.patch},{type:'restart',observedAt:i+1}),null);
 }
 const db=new DatabaseSync(':memory:');db.exec(schema);const row=initial({cancel_requested:1,request_dispatched:0}),plan=step(row,{type:'restart',observedAt:100});insert(db,row);db.prepare('UPDATE mobile_executions SET request_dispatched=1 WHERE id=?').run(row.id);assert.throws(()=>lifecycle.applyDecision(db,plan),e=>e.code==='EXECUTION_OBSERVATION_STALE');assert.equal(db.prepare('SELECT state FROM mobile_executions').get().state,'running');db.close();
});
test('awaited native hooks prevent dispatch when the actual SQLite acceptance write is rejected',async t=>{
 const f=await prepared(t),file=path.join(f.root,'external-effect.txt');f.store.db.exec("CREATE TRIGGER reject_native_dispatch BEFORE INSERT ON mobile_native_invocations BEGIN SELECT RAISE(ABORT,'synthetic receipt rejection'); END;");
 const release=nativeContext.register(f.job.id,null,f.portal.engine.nativeTasks.hooks(f.job.id));try{await assert.rejects(()=>nativeContext.run(f.job.id,new AbortController().signal,()=>nativeContext.runToolInvocation({pluginName:'SyntheticEffect'},()=>appendEffect(file))),/synthetic receipt rejection/);}finally{release();}
 await assert.rejects(()=>fs.access(file),e=>e.code==='ENOENT');assert.equal(f.store.db.prepare('SELECT count(*) n FROM mobile_native_invocations').get().n,0);assert.equal(f.portal.engine.get(f.job.id).tool_started,0);
});
test('negative control: ordinary async events permit an effect before the same SQLite rejection is known',async t=>{
 const {EventEmitter}=require('node:events'),f=await prepared(t),file=path.join(f.root,'external-event-only.txt');f.store.db.exec("CREATE TRIGGER reject_native_dispatch BEFORE INSERT ON mobile_native_invocations BEGIN SELECT RAISE(ABORT,'synthetic receipt rejection'); END;");
 const bus=new EventEmitter(),pending=[];let release;const barrier=new Promise(r=>{release=r;}),hook=f.portal.engine.nativeTasks.hooks(f.job.id);
 bus.on('before',event=>{pending.push((async()=>{await barrier;return hook.onToolDispatch(event);})().catch(e=>e));});
 bus.emit('before',{nativeRequestId:f.job.id,invocationId:'event-only-synthetic',pluginName:'SyntheticEffect'});await appendEffect(file);release();const error=await pending[0];assert.match(error.message,/synthetic receipt rejection/);assert.equal((await fs.readFile(file,'utf8')).trim(),'effect');assert.equal(f.store.db.prepare('SELECT count(*) n FROM mobile_native_invocations').get().n,0);
});
for(const stage of ['reply-intent','reply-applied','external-effect'])test('actual child exit at '+stage+' preserves existing work without blind re-execution',async t=>{
 const f=await prepared(t),effectFile=path.join(f.root,'effect-count.txt'),input=path.join(f.root,'execution-boundary-input.json');await fs.writeFile(input,JSON.stringify({root:f.root,dbPath:path.join(f.root,'central.sqlite'),jobId:f.job.id,effectFile}));
 const child=spawnSync(process.execPath,[path.join(__dirname,'fixtures/executionBoundaryChild.cjs'),input,stage],{env:process.env,encoding:'utf8',timeout:10000});assert.equal(child.status,78,child.stderr);assert.equal((await fs.readFile(effectFile,'utf8')).trim().split('\n').length,1);
 const before=f.store.metrics(),pending=f.portal.engine.get(f.job.id);f.portal.engine.recover();const recovered=f.portal.engine.get(f.job.id);assert.equal(recovered.attempts,1);
 if(stage==='external-effect'){
  assert.equal(recovered.state,'review_required');assert.equal(f.store.metrics().journalRows,before.journalRows);assert.equal(f.portal.engine.nativeTasks.uncertainTools(f.job.id),true);assert.throws(()=>f.portal.engine.accept('boundary-session',{topicKey:'boundary-topic',requestId:'must-not-bypass-hold',text:'next'}),e=>e.code==='DEPENDENCY_REVIEW_REQUIRED');
  // Deliberately incorrect recovery branch: a local started receipt cannot
  // tell whether the independent external action happened before process loss.
  await appendEffect(effectFile);assert.equal((await fs.readFile(effectFile,'utf8')).trim().split('\n').length,2);
 }else {
  assert.equal(pending.state,'publishing');assert.equal(recovered.state,'completed');assert.equal(recovered.pending_operation,null);assert.ok(recovered.reply_message_id);assert.equal(f.store.metrics().journalRows,before.journalRows+(stage==='reply-intent'?1:0));const after=f.store.metrics();f.portal.engine.recover();assert.deepEqual(f.store.metrics(),after);assert.equal((await fs.readFile(effectFile,'utf8')).trim().split('\n').length,1);
 }
});
test('native AA acceptance must be acknowledged before its launch continuation can run',async t=>{
 const f=await prepared(t),file=path.join(f.root,'native-aa-launch.txt');f.store.db.exec("CREATE TRIGGER reject_native_accept BEFORE INSERT ON mobile_native_tasks BEGIN SELECT RAISE(ABORT,'synthetic AA acceptance rejection'); END;");
 const release=nativeContext.register(f.job.id,null,f.portal.engine.nativeTasks.hooks(f.job.id));
 try{await assert.rejects(()=>nativeContext.run(f.job.id,new AbortController().signal,()=>nativeContext.runToolInvocation({pluginName:'AgentAssistant'},async()=>{await nativeContext.acceptNativeTask({pluginName:'AgentAssistant',nativeTaskId:'aa-delegation-synthetic',agentBaseName:'synthetic-one'});await appendEffect(file);})),/synthetic AA acceptance rejection/);}finally{release();}
 await assert.rejects(()=>fs.access(file),e=>e.code==='ENOENT');assert.equal(f.store.db.prepare('SELECT count(*) n FROM mobile_native_tasks').get().n,0);assert.equal(f.store.db.prepare('SELECT state FROM mobile_native_invocations WHERE execution_id=?').get(f.job.id).state,'error');
});
test('poisoned Journal blocks a healthy later topic; naive skipping falsely reports complete catch-up',async t=>{
 const {selected,message}=require('./fixtures/boundedSourceHarness.cjs');const f=await fixture(t);await f.adopt();await f.pump();const cursor=f.adapter.state.cursor;
 const poison=f.store.apply({...wireTopic(selected),msgId:'poison-record',deviceId:'synthetic-peer',opId:'poison-record',action:'upsert',baseHash:null,message:message('poison-record')}),healthy=f.store.apply({...wireTopic(older),msgId:'healthy-after-poison',deviceId:'synthetic-peer',opId:'healthy-after-poison',action:'upsert',baseHash:null,message:message('healthy-after-poison')});
 const originalJson=f.store.db.prepare('SELECT message_json FROM journal WHERE seq=?').get(poison.seq).message_json;f.store.db.prepare('UPDATE journal SET message_json=? WHERE seq=?').run('{',poison.seq);
 await assert.rejects(()=>f.adapter.pull(),e=>e.code==='BAD_REQUEST');assert.equal(f.adapter.state.cursor,cursor);assert.equal((await f.queue.read(older)).some(m=>m.id==='healthy-after-poison'),false);
 const originalPull=f.store.pull.bind(f.store);
 // Deliberately unsafe alternative: retain the scan watermark but silently
 // discard malformed authorized rows. This is not a production implementation.
 f.store.pull=(after,limit=100,allowed)=>{
  const rows=f.store.db.prepare('SELECT * FROM journal WHERE seq>? ORDER BY seq LIMIT ?').all(after,limit),events=[],scope=allowed?new Set(allowed):null;
  for(const row of rows){if(scope&&!scope.has(JSON.stringify([row.owner_type,row.owner_id,row.topic_id])))continue;try{events.push({seq:row.seq,ownerType:row.owner_type,ownerId:row.owner_id,topicId:row.topic_id,msgId:row.msg_id,action:row.action,hash:row.hash,message:f.store.projectMessage(row),sourceDevice:row.device_id});}catch{}}
  const headSeq=f.store.headStmt.get().seq,nextSeq=rows.at(-1)?.seq??after;return {events,headSeq,nextSeq,hasMore:nextSeq<headSeq};
 };
 try{await f.adapter.pull();assert.equal(f.adapter.state.cursor,healthy.seq);assert.equal((await f.queue.read(older)).some(m=>m.id==='healthy-after-poison'),true);}finally{f.store.pull=originalPull;f.store.db.prepare('UPDATE journal SET message_json=? WHERE seq=?').run(originalJson,poison.seq);}
 await f.adapter.pull();assert.equal((await f.queue.read(selected)).some(m=>m.id==='poison-record'),false);assert.equal(f.adapter.diagnostics().materializedThrough,healthy.seq);assert.equal(f.adapter.state.inbox.length,0);
});
