// M2: actual native modules and HTTP/SQLite, entirely synthetic.
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {fixture,message,selected,older,sibling,foreign,limited,waitFor,CHAT,BOX,HistoryMutationQueue,NativeSyncAdapter,SourceSync,wireTopic,messageHash,stable}=require('./fixtures/boundedSourceHarness.cjs');
test('M2 approved additions, edits, explicit tombstones reach only the two topics and actual MobilePortal API stays readonly',async t=>{
 const f=await fixture(t);await f.adopt();await f.pump();assert.equal(f.store.metrics().journalRows,7);f.assertOldFacts();
 await f.queue.mutate(selected,rows=>[...rows,message('m2-new','new selected')]);await f.pump();
 await f.queue.mutate(older,rows=>rows.map(m=>m.id==='old-1'?{...m,content:'edited old',updatedAt:22}:m));await f.pump();
 await f.queue.mutate(older,rows=>rows.filter(m=>m.id!=='old-2'),{intent:{deleteIds:['old-2']}});await f.pump();
 assert.equal(f.store.metrics().journalRows,10);assert.equal(f.store.metrics().liveMessages,5);
 assert.equal(f.cloudRows(older).findLast(e=>e.msgId==='old-2').action,'delete');assert.equal((await f.queue.readSnapshot(older)).history.find(m=>m.id==='old-1').content,'edited old');
 const phone=await f.phone();assert.equal(phone.topics.length,2);assert.ok(phone.topics.every(t=>!t.executable&&t.historyReady));
 const before=f.store.metrics();for(const topic of phone.topics){const rows=await phone.read(topic);assert.ok(rows.every(e=>e.ownerId==='one'));}assert.deepEqual(f.store.metrics(),before);f.assertOldFacts();
});
test('M2 offline durable Outbox survives reopen; accepted response loss retries the original opId exactly once in Journal',async t=>{
 const f=await fixture(t);await f.adopt();await f.pump();f.network.offline=true;await f.queue.mutate(older,rows=>[...rows,message('offline')]);
 const op=structuredClone(f.adapter.state.outbox[0]),before=f.store.metrics();await assert.rejects(()=>f.adapter.synchronize(),e=>e.code==='NETWORK_UNAVAILABLE');assert.deepEqual(f.store.metrics(),before);
 await f.close();await f.open();assert.equal(f.adapter.state.outbox[0].opId,op.opId);assert.equal(f.adapter.state.outbox[0].baseHash,op.baseHash);
 f.network.offline=false;f.network.dropPush=1;await assert.rejects(()=>f.adapter.synchronize(),e=>e.code==='NETWORK_UNAVAILABLE');assert.equal(f.store.metrics().journalRows,before.journalRows+1);assert.equal(f.adapter.state.outbox[0].opId,op.opId);
 await f.close();await f.open();await f.pump();assert.equal(f.store.metrics().journalRows,before.journalRows+1);assert.equal(f.store.db.prepare('SELECT count(*) n FROM applied_ops WHERE device_id=? AND op_id=?').get('deviceA',op.opId).n,1);assert.equal(f.adapter.state.outbox.length,0);f.assertOldFacts();
});
test('M2 duplicate same opId replays; changed payload with that ID is rejected without new facts',async t=>{
 const f=await fixture(t);await f.adopt();await f.pump();await f.queue.mutate(selected,rows=>[...rows,message('duplicate')]);const op=f.adapter.wireOperation(f.adapter.state.outbox[0]);
 const a=await f.send('/api/v1/sync/source/push',{body:op}),b=await f.send('/api/v1/sync/source/push',{body:op});assert.equal(a.seq,b.seq);assert.equal(b.replayed,true);
 await assert.rejects(()=>f.send('/api/v1/sync/source/push',{body:{...op,message:{...op.message,content:'different'}}}),e=>e.code==='IDEMPOTENCY_KEY_REUSED');await f.pump();assert.equal(f.store.metrics().journalRows,8);f.assertOldFacts();
});
test('M2 conflict retains local operation and cloud fact, while healthy topic advances across reopen',async t=>{
 const f=await fixture(t);await f.adopt();await f.pump();await f.queue.mutate(older,rows=>rows.map(m=>m.id==='old-1'?{...m,content:'local edit',updatedAt:2}:m));const op=structuredClone(f.adapter.state.outbox[0]);
 // Trusted synthetic peer uses CentralStore.apply; this is not a simulated mobile write.
 const cloud=f.store.apply({...wireTopic(older),msgId:'old-1',deviceId:'server:synthetic-peer',opId:'peer-edit',action:'upsert',baseHash:messageHash(message('old-1')),message:message('old-1','cloud edit')});
 await f.queue.mutate(selected,rows=>[...rows,message('healthy')]);
 for(let i=0;i<4;i++){await f.sync.tick();await f.adapter.synchronize();}
 assert.equal((await f.queue.readSnapshot(older)).history.find(m=>m.id==='old-1').content,'local edit');assert.equal(f.cloudRows(older).findLast(e=>e.msgId==='old-1').hash,cloud.hash);
 assert.ok(f.cloudRows(selected).some(e=>e.msgId==='healthy'));const parked=f.adapter.state.outbox.find(x=>x.opId===op.opId);assert.ok(parked.status);assert.equal(parked.baseHash,op.baseHash);assert.deepEqual(parked.message,op.message);
 const before=f.store.metrics();await f.close();await f.open();for(let i=0;i<3;i++){await f.sync.tick();await f.adapter.synchronize();}assert.deepEqual(f.store.metrics(),before);assert.equal(f.adapter.state.outbox.find(x=>x.opId===op.opId).baseHash,op.baseHash);f.assertOldFacts();
});
test('M2 concurrent native commits preserve per-topic order and identical message IDs do not cross topic domains',async t=>{
 const f=await fixture(t);await f.adopt();await f.pump();
 await Promise.all([selected,older].flatMap(d=>Array.from({length:4},(_,i)=>f.queue.mutate(d,rows=>[...rows,message(i===0?'same-id':'parallel-'+i,d.topicId+' '+i)]))));await f.pump();
 for(const d of [selected,older]){const rows=f.cloudRows(d).filter(e=>e.msgId==='same-id'||e.msgId.startsWith('parallel-'));assert.deepEqual(rows.map(e=>e.message.content),Array.from({length:4},(_,i)=>d.topicId+' '+i));}
 assert.equal(f.store.metrics().journalRows,15);assert.equal(f.adapter.state.outbox.length,0);f.assertOldFacts();
});
test('M2 new-import pause fences uncaptured approved writes; outside topics remain native-local',async t=>{
 const f=await fixture(t);await f.adopt({discover:false});f.connection.sourcePaused=true;await f.close();await f.open();assert.equal(Object.keys(f.sync.state.plans).length,0);
 await assert.rejects(()=>f.queue.mutate(older,rows=>[...rows,message('not-captured')]),e=>e.code==='SOURCE_IMPORT_PAUSED');await f.queue.mutate(sibling,rows=>[...rows,message('outside-local')]);
 assert.equal(f.adapter.state.outbox.length,0);assert.equal(f.store.metrics().journalRows,5);assert.equal(Object.keys(f.sync.state.plans).length,0);
 f.connection.sourcePaused=false;await f.close();await f.open();await f.pump();assert.equal(f.store.metrics().journalRows,7);f.assertOldFacts();
});
test('M2 sourcePaused is not a completed-topic write freeze: a committed approved update still synchronizes',async t=>{
 const f=await fixture(t);await f.adopt();await f.pump();f.connection.sourcePaused=true;await f.close();await f.open();
 await f.queue.mutate(selected,rows=>[...rows,message('completed-while-paused')]);const op=f.adapter.state.outbox[0].opId;await f.sync.tick();await f.adapter.synchronize();assert.equal(f.store.metrics().journalRows,8);assert.equal(f.adapter.state.outbox.length,0);assert.equal(f.store.db.prepare('SELECT count(*) n FROM applied_ops WHERE op_id=?').get(op).n,1);f.assertOldFacts();
});
test('M2 actual disabled runtime stops Bridge and preserves fence, Outbox and scope; re-enable recovers original op',async t=>{
 const f=await fixture(t);await f.adopt();await f.pump();f.network.offline=true;await f.queue.mutate(selected,rows=>[...rows,message('pending-before-disable')]);const pending=structuredClone(f.adapter.state.outbox[0]),source=structuredClone(f.adapter.state.source.binding);await f.close();
 const {createNativeSyncRuntime}=require(CHAT+'/modules/services/nativeSync/runtime'),file=path.join(f.app,'.native-sync/connection.json');
 const config={version:1,enabled:false,scopeMode:'source',fullSelectionApproved:true,sourceId:'sourceA',spaceId:f.connection.spaceId,sourceRoot:f.app,deviceId:'deviceA',topics:[],sourceScope:f.connection.sourceScope,sourcePaused:false,serverUrl:'https://synthetic-runtime.invalid',credentialSource:'existing-vcp-settings'};await fs.writeFile(file,JSON.stringify(config));
 let runtime,q;const queues=[];f.cleanups.push(async()=>{await runtime?.close();for(const queue of queues)await queue.dispose();});
 async function open(){q=f.makeQueue();queues.push(q);runtime=await createNativeSyncRuntime({queue:q,appDataRoot:f.app,intervalMs:5,executionIntervalMs:60000,readSettings:async()=>({vcpServerUrl:'https://synthetic-runtime.invalid',vcpApiKey:'synthetic-only'}),readAgentConfig:f.readAgentConfig,readGroupConfig:f.readGroupConfig,request:f.send});}
 const sentBeforeDisable=f.sent.length;await open();assert.equal(runtime.adapter,null);await assert.rejects(()=>q.mutate(selected,rows=>[...rows,message('fenced')]),e=>e.code==='SYNC_CONNECTION_REQUIRED');await q.mutate(sibling,rows=>[...rows,message('local-outside-disabled')]);assert.equal(f.store.metrics().journalRows,7);assert.equal(f.sent.length,sentBeforeDisable,'Disabled Bridge must issue no transport request');
 await runtime.close();await q.dispose();await fs.writeFile(file,JSON.stringify({...config,enabled:true}));await open();assert.deepEqual(runtime.adapter.state.source.binding,source);assert.equal(runtime.adapter.state.outbox[0].opId,pending.opId);
 f.network.offline=false;await waitFor(()=>runtime.adapter.state.outbox.length===0&&f.store.metrics().journalRows===8,'reenable original Outbox');assert.equal(f.store.db.prepare('SELECT count(*) n FROM applied_ops WHERE op_id=?').get(pending.opId).n,1);f.adapter=runtime.adapter;f.assertOldFacts();
});
test('M2 every source entry rejects unapproved sibling/owner before import; native outside writes remain local',async t=>{
 const f=await fixture(t);f.reads=[];await f.adopt();await f.pump();assert.ok(!f.reads.some(r=>r.owner==='other'||(r.kind==='history'&&r.topic==='excluded')));assert.equal(Object.keys(f.sync.state.plans).length,2);
 await f.queue.mutate(sibling,rows=>[...rows,message('native-only-sibling')]);await f.queue.mutate(foreign,rows=>[...rows,message('native-only-owner')]);const before=f.store.metrics(),revision=f.sync.state.revision;
 for(const d of [sibling,foreign]){
  await assert.rejects(()=>f.sync.ensureTopic(d),e=>e.code==='SOURCE_TOPIC_NOT_APPROVED');await assert.rejects(()=>f.sync.ensureSnapshot(d),e=>e.code==='SOURCE_TOPIC_NOT_APPROVED');
  await assert.rejects(()=>f.send('/api/v1/sync/source/catalog',{body:{opId:'outside-'+d.itemId,baseRevision:revision,agents:[],topics:[{...wireTopic(d),name:'outside'}],removed:[]}}),e=>e.status===403);
  await assert.rejects(()=>f.send('/api/v1/sync/source/baselines',{body:{planId:'outside-'+d.itemId,...wireTopic(d)}}),e=>e.status===403);
  await assert.rejects(()=>f.send('/api/v1/sync/source/push',{body:{...wireTopic(d),deviceId:'deviceA',opId:'outside-'+d.itemId,msgId:'outside',action:'upsert',baseHash:null,message:message('outside')}}),e=>e.status===403);
 }
 await f.pump();assert.deepEqual(f.store.metrics(),before);assert.equal(f.store.sourceCatalog.entities('sourceA','topics').length,2);assert.equal(f.adapter.state.outbox.length,0);f.assertOldFacts();
});
