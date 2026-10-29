// Targeted Batch1 closure; no actual provider, native tool, AA or production access.
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{spawnSync}=require('node:child_process');
const {fixture,descriptors,tuple,publishExecutionConfigs}=require('./fixtures/executionPublishHarness.cjs');
const version=(f,key)=>f.latest(key)?.version;
const changed=f=>{for(let i=0;i<8;i++)f.setPrompt('a'+i,'\u4e2d'.repeat(5000));};
const count=(f,table)=>f.db.prepare('SELECT count(*) n FROM '+table).get().n;
async function admit(f,phone,key,id){const r=await phone('/conversations/'+key+'/messages',{requestId:id,text:'synthetic configuration admission'});assert.equal(r.status,202,JSON.stringify(r.body));const row=f.db.prepare('SELECT * FROM mobile_executions WHERE id=?').get(r.body.id);const snapshot=JSON.parse(row.config_snapshot);assert.equal(row.attempts,0);assert.equal(row.state,'queued');assert.equal(r.body.configHash,snapshot.hash);assert.equal(r.body.configVersion,snapshot.version);return {row,snapshot};}
for(const mode of ['reject','timeout','drop'])test('real HTTP second batch '+mode+' preserves per-topic snapshots, admission and retry idempotency',async t=>{
 const f=await fixture();t.after(()=>f.close());const phone=await f.phone(),v1=f.rows(),old=await admit(f,phone,'topic0','old_v1_request');changed(f);f.resetFault(mode);
 await assert.rejects(()=>f.publish(),e=>mode==='reject'?e.code==='SYNTHETIC_SECOND_BATCH_REJECTED':e.code==='NETWORK_UNAVAILABLE');
 assert.equal(f.fault.posts,2);assert.ok(f.fault.requests[0].bytes<=96000);assert.equal(version(f,'topic0'),2);assert.equal(version(f,'topic6'),mode==='drop'?2:1);
 const listed=await phone('/conversations');assert.equal(listed.status,200); for(const topic of listed.body.topics){assert.equal(topic.configVersion,topic.key==='unprepared'?null:version(f,topic.key));assert.equal(topic.executable,topic.key!=='unprepared');} // actual mobile directory projection
 const one=await admit(f,phone,'topic0','mixed_front_request'),two=await admit(f,phone,'topic6','mixed_later_request'),group=await admit(f,phone,'topic8','mixed_group_request');
 assert.equal(one.snapshot.version,2);assert.equal(two.snapshot.version,mode==='drop'?2:1);assert.equal(group.snapshot.version,mode==='drop'?2:1);
 assert.deepEqual(group.snapshot.group.members,['a0','a1']);assert.deepEqual(group.snapshot.agents.map(a=>[a.id,a.agentAlias]),[['a0','alias0'],['a1','alias1']]);
 assert.deepEqual(f.db.prepare('SELECT agent_id,state,attempts FROM mobile_execution_steps WHERE job_id=? ORDER BY step_index').all(group.row.id).map(r=>({...r})),[{agent_id:'a1',state:'queued',attempts:0},{agent_id:'a0',state:'queued',attempts:0}]);
 const before=f.snapshot(),blocked=await phone('/conversations/unprepared/messages',{requestId:'unprepared_request',text:'must not start'});assert.equal(blocked.status,409);assert.deepEqual(f.snapshot(),before);
 f.resetFault(null);await f.publish();assert.ok(descriptors.every((_,i)=>version(f,'topic'+i)===2));
 const stable=f.snapshot();await f.publish();assert.deepEqual(f.snapshot(),stable);
 for(const admitted of [old,one,two,group])assert.equal(f.db.prepare('SELECT config_snapshot FROM mobile_executions WHERE id=?').get(admitted.row.id).config_snapshot,admitted.row.config_snapshot);
 const replay=await phone('/conversations/topic0/messages',{requestId:'old_v1_request',text:'synthetic configuration admission'});assert.equal(replay.body.replayed,true);assert.equal(replay.body.id,old.row.id);assert.equal(replay.body.configVersion,1);assert.deepEqual(f.snapshot(),stable);
 assert.deepEqual(f.rows().filter(r=>r.version===1),v1);assert.equal(count(f,'mobile_native_tasks'),0);assert.equal(count(f,'mobile_native_invocations'),0);assert.equal(f.db.prepare('SELECT sum(attempts) n FROM mobile_executions').get().n,0);
 const evidence={mode,versionsBeforeRecovery:[one.snapshot.version,two.snapshot.version,group.snapshot.version],versionsAfterRecovery:descriptors.map((_,i)=>version(f,'topic'+i)),oldExecutionVersion:1,attempts:0,providerCalls:0};console.log('EVIDENCE '+JSON.stringify(evidence));
});
test('real publisher subprocess exits after committed second batch; DB reopen and original publication converge without new versions/jobs',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'nativesync-publish-crash-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));let f=await fixture({root});const phone=await f.phone(),old=await admit(f,phone,'topic0','crash_old_v1_request'),v1=f.rows();await f.close({remove:false});
 const child=spawnSync(process.execPath,[path.join(__dirname,'fixtures/executionPublishCrash.cjs'),root],{env:process.env,encoding:'utf8',timeout:10000});assert.equal(child.status,78,child.stdout+child.stderr);
 f=await fixture({root,seed:false});t.after(()=>f.close({remove:false}));changed(f);assert.ok(descriptors.every((_,i)=>version(f,'topic'+i)===2));const before=f.snapshot();await f.publish();await f.publish();assert.deepEqual(f.snapshot(),before);assert.deepEqual(f.rows().filter(r=>r.version===1),v1);assert.equal(f.db.prepare('SELECT config_snapshot FROM mobile_executions WHERE id=?').get(old.row.id).config_snapshot,old.row.config_snapshot);assert.equal(count(f,'mobile_native_tasks'),0);console.log('EVIDENCE '+JSON.stringify({childExit:child.status,versions:descriptors.map((_,i)=>version(f,'topic'+i)),sameOldExecution:true}));
});
test('real UTF8 single-row requests below/at/above96KB are preserved and accepted by unchanged protocol; oversized invalid row cannot erase old versions',async t=>{
 const f=await fixture();t.after(()=>f.close());const selected=[descriptors[0]],seen=[];let prompt='';
 const send=async(route,options)=>{if(options){const bytes=Buffer.byteLength(JSON.stringify(options.body));seen.push(bytes);}return f.send(route,options);};
 const run=()=>publishExecutionConfigs({topics:selected,readAgentConfig:async id=>f.config(id,prompt),send});
 // Determine overhead using the real projected row, not JS character length.
 const capture=async(route,options)=>options?{topics:options.body.topics.map(row=>{seen.push(Buffer.byteLength(JSON.stringify({topics:[row]})));return row;})}:f.send(route);
 await publishExecutionConfigs({topics:selected,readAgentConfig:async id=>f.config(id,''),send:capture});const overhead=seen.pop();
 for(const size of [95999,96000,96001,150000]){const n=size-overhead;prompt='\u4e2d'.repeat(Math.floor(n/3))+'x'.repeat(n%3);await run();assert.equal(seen.at(-1),size);assert.equal(JSON.parse(f.latest('topic0').config_json).systemPrompt,prompt);}
 const before=f.snapshot();prompt='x'.repeat(128001);await assert.rejects(run,e=>e.code==='INVALID_EXECUTION_CONFIG');assert.deepEqual(f.snapshot(),before);assert.equal(version(f,'topic1'),1);console.log('EVIDENCE '+JSON.stringify({actualUtf8Bytes:seen,legalLargeItem:150000,unchangedHostParserLimit:'300mb',noTruncation:true}));
});

test('mixed config admissions actually execute their frozen v1/v2 snapshots once after recovery, and replays/publication do not redispatch',async t=>{
 const http=require('node:http'),f=await fixture();t.after(()=>f.close());const requests=[];
 const model=http.createServer(async(req,res)=>{assert.equal(req.socket.remoteAddress,'127.0.0.1');let raw='';for await(const chunk of req)raw+=chunk;requests.push(JSON.parse(raw));res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:'synthetic execution result'}}]}));});await new Promise(r=>model.listen(0,'127.0.0.1',r));t.after(async()=>{model.closeAllConnections();await new Promise(r=>model.close(r));});
 const phone=await f.phone(),old=await admit(f,phone,'topic0','execute_old_v1_request');changed(f);f.resetFault('reject');await assert.rejects(()=>f.publish(),e=>e.code==='SYNTHETIC_SECOND_BATCH_REJECTED');
 const front=await admit(f,phone,'topic0','execute_front_v2_request'),later=await admit(f,phone,'topic6','execute_later_v1_request'),group=await admit(f,phone,'topic8','execute_group_v1_request');f.resetFault(null);await f.publish();
 f.plugin.setExecutionEndpoint({url:'http://127.0.0.1:'+model.address().port+'/v1/chat/completions',key:'synthetic-only'});
 const rows=[old,front,later,group],until=Date.now()+7000;
 while(rows.some(r=>f.db.prepare('SELECT state FROM mobile_executions WHERE id=?').get(r.row.id).state!=='completed')){if(Date.now()>until)throw Error(JSON.stringify(f.db.prepare('SELECT id,state,error_code FROM mobile_executions').all()));await new Promise(r=>setTimeout(r,5));}
 assert.equal(requests.length,5);assert.equal(requests.filter(r=>r.messages[0].content==='v1').length,2);assert.equal(requests.filter(r=>r.messages[0].content==='\u4e2d'.repeat(5000)).length,1);
 assert.equal(f.db.prepare('SELECT count(*) n FROM mobile_executions').get().n,4);assert.equal(f.db.prepare('SELECT sum(attempts) n FROM mobile_executions').get().n,4);assert.equal(f.db.prepare('SELECT sum(attempts) n FROM mobile_execution_steps').get().n,2);
 const before=f.snapshot();for(const [key,id] of [['topic0','execute_old_v1_request'],['topic0','execute_front_v2_request'],['topic6','execute_later_v1_request'],['topic8','execute_group_v1_request']]){const replay=await phone('/conversations/'+key+'/messages',{requestId:id,text:'synthetic configuration admission'});assert.equal(replay.body.replayed,true);}
 await f.publish();assert.deepEqual(f.snapshot(),before);assert.equal(requests.length,5);assert.equal(count(f,'mobile_native_tasks'),0);assert.equal(count(f,'mobile_native_invocations'),0);for(const r of rows)assert.equal(f.db.prepare('SELECT config_snapshot FROM mobile_executions WHERE id=?').get(r.row.id).config_snapshot,r.row.config_snapshot);
 console.log('EVIDENCE '+JSON.stringify({loopbackRequests:5,executions:4,groupSteps:2,configVersions:rows.map(r=>r.snapshot.version),replayAdditionalRequests:0,tools:0,AA:0,realProvider:0}));
});
