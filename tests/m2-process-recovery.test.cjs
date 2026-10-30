
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),{spawn}=require('node:child_process');
const {fixture,older,selected}=require('./fixtures/boundedSourceHarness.cjs');
for(const stage of ['plan-durable','message-accepted','local-committed'])test('M2 real process exit at '+stage+' preserves original identities and bounded exactly-once acceptance',async t=>{
 const f=await fixture(t);await f.adopt({discover:false});if(stage==='local-committed')await f.pump();await f.close();
 const receipt=path.join(f.root,stage+'.json'),spec=path.join(f.root,'child.json');await fs.writeFile(spec,JSON.stringify({app:f.app,connection:f.connection,stage,receipt,topic:selected}));
 const child=spawn(process.execPath,[path.join(__dirname,'fixtures/boundedCrashChild.cjs'),spec],{env:{PATH:process.env.PATH,HOME:f.root,LANG:'C.UTF-8',NATIVESYNC_TEST_HOSTS:process.env.NATIVESYNC_TEST_HOSTS},stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);const exit=await new Promise(r=>child.on('exit',(code,signal)=>r({code,signal})));assert.equal(exit.signal,null);assert.equal(exit.code,stage==='local-committed'?74:73,output);
 const r=JSON.parse(await fs.readFile(receipt,'utf8'));assert.equal(r.pid,child.pid);assert.notEqual(r.pid,process.pid);t.diagnostic(JSON.stringify({boundary:stage,childPid:child.pid,exitCode:exit.code,receiptStage:r.stage}));
 const durable=JSON.parse(await fs.readFile(path.join(f.app,'.native-sync/state.json'),'utf8'));
 if(stage==='message-accepted'){assert.equal(f.store.metrics().journalRows,6);const p=Object.values(durable.source.plans).find(p=>p.descriptor.topicId===older.topicId);assert.equal(p.localIndex,0);}
 if(stage==='local-committed'){assert.equal(f.store.metrics().journalRows,7);assert.deepEqual(durable.outbox.map(o=>o.opId),r.opIds);}
 await f.open();await f.pump();assert.equal(f.store.metrics().journalRows,stage==='local-committed'?8:7);f.assertOldFacts();const before=f.store.metrics();await f.close();await f.open();await f.pump();assert.deepEqual(f.store.metrics(),before);
});
