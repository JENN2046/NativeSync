
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {fixture,message,selected,older,sibling,foreign,limited,CHAT,SourceCatalog,SourceSync,createSyncRequest,wireTopic,messageHash}=require('./fixtures/boundedSourceHarness.cjs');
const b0={itemType:'agent',itemId:'two',topicId:'selected'},b1={itemType:'agent',itemId:'two',topicId:'old'},outsideB={itemType:'agent',itemId:'two',topicId:'excluded'},all=[selected,older,b0,b1];
async function seedTwo(t,{late=false}={}){const f=await fixture(t,{scope:limited(all)});if(!late){await f.owner('two',{topics:[{id:'selected',name:'B selected'},{id:'old',name:'B old'},{id:'excluded',name:'outside B'}]});await f.history(b0,[message('b0')]);await f.history(b1,[message('b1')]);await f.history(outsideB,[message('outside-b')]);}return f;}
test('M3 two explicitly granted Agents with two topics each retain identities and actual MobilePortal read API exposes exactly four topics to a synthetic readonly session',async t=>{
 const f=await seedTwo(t);f.reads=[];await f.adopt();await f.pump();assert.equal(f.store.metrics().journalRows,9);assert.equal(f.store.metrics().liveMessages,7);assert.equal(Object.keys(f.sync.state.plans).length,4);
 assert.ok(!f.reads.some(r=>r.owner==='other'||r.topic==='excluded'));assert.equal(f.store.sourceCatalog.entities('sourceA','agents').length,2);assert.equal(f.store.sourceCatalog.entities('sourceA','topics').length,4);
 const phone=await f.phone();assert.equal(phone.topics.length,4);assert.ok(phone.topics.every(t=>!t.executable&&t.historyReady));const totals=[];for(const topic of phone.topics){const rows=await phone.read(topic);assert.ok(rows.every(e=>e.ownerId===topic.ownerId&&e.topicId===topic.topicId));totals.push(rows.length);}assert.deepEqual(totals.sort(),[1,1,2,3]);f.assertOldFacts();
});
test('M3 late approved Agent/topics and native directory renames are discovered incrementally without binding/cursor resets',async t=>{
 const f=await seedTwo(t,{late:true});await f.adopt();await f.pump();const binding=structuredClone(f.sync.state.binding),cursor=f.adapter.state.cursor;assert.equal(f.store.metrics().journalRows,7);
 await f.owner('two',{topics:[{id:'selected',name:'late B0'}]});await f.history(b0,[message('late-b0')]);await f.sync.discover();await f.pump();assert.equal(f.store.metrics().journalRows,8);
 await f.owner('two',{name:'renamed B',topics:[{id:'selected',name:'renamed B0'},{id:'old',name:'pending B1'}]});await f.sync.discover();await f.sync.publish();assert.equal(f.sync.plan(b1),undefined);assert.equal(f.store.sourceCatalog.entities('sourceA','topics').find(t=>t.ownerId==='two'&&t.topicId==='old').ready,0);
 await f.history(b1,[message('late-b1')]);await f.sync.discover();await f.pump();assert.equal(f.store.metrics().journalRows,9);assert.deepEqual(f.sync.state.binding,binding);assert.ok(f.adapter.state.cursor>=cursor);assert.equal(f.store.sourceCatalog.entities('sourceA','agents').find(a=>a.ownerId==='two').name,'renamed B');f.assertOldFacts();
});
test('M3 same topic/message IDs across Agents remain independent through concurrent commits and reopen',async t=>{
 const f=await seedTwo(t);await f.adopt();await f.pump();await Promise.all([selected,b0].map(d=>f.queue.mutate(d,rows=>[...rows,message('same-across-agents',d.itemId)])));await f.pump();
 assert.equal(f.cloudRows(selected).find(e=>e.msgId==='same-across-agents').message.content,'one');assert.equal(f.cloudRows(b0).find(e=>e.msgId==='same-across-agents').message.content,'two');
 const plans=Object.values(f.sync.state.plans).map(p=>p.id),before=f.store.metrics(),binding=structuredClone(f.sync.state.binding);await f.close();await f.open();await f.pump();assert.deepEqual(f.store.metrics(),before);assert.deepEqual(Object.values(f.sync.state.plans).map(p=>p.id),plans);assert.deepEqual(f.sync.state.binding,binding);f.assertOldFacts();
});
test('M3 conflict in Agent A does not consume or block offline operations of Agent B',async t=>{
 const f=await seedTwo(t);await f.adopt();await f.pump();await f.queue.mutate(older,rows=>rows.map(m=>m.id==='old-1'?{...m,content:'A local',updatedAt:5}:m));const conflict=structuredClone(f.adapter.state.outbox[0]);
 f.store.apply({...wireTopic(older),msgId:'old-1',deviceId:'server:synthetic-peer',opId:'cloud-a',baseHash:messageHash(message('old-1')),action:'upsert',message:message('old-1','A cloud')});
 f.network.offline=true;await f.queue.mutate(b0,rows=>[...rows,message('B offline')]);await f.queue.mutate(b1,rows=>[...rows,message('B healthy')]);const bOps=f.adapter.state.outbox.filter(op=>op.ownerId==='two').map(op=>op.opId);await f.close();await f.open();f.network.offline=false;
 for(let i=0;i<5;i++){await f.sync.tick();await f.adapter.synchronize();}
 assert.ok(f.cloudRows(b0).some(e=>e.msgId==='B offline'));assert.ok(f.cloudRows(b1).some(e=>e.msgId==='B healthy'));assert.equal(f.adapter.state.outbox.length,1);assert.equal(f.adapter.state.outbox[0].opId,conflict.opId);assert.equal(f.adapter.state.outbox[0].baseHash,conflict.baseHash);for(const id of bOps)assert.equal(f.store.db.prepare('SELECT count(*) n FROM applied_ops WHERE op_id=?').get(id).n,1);f.assertOldFacts();
});
test('M3 explicit topic deletion retains central message/task facts and allows the other Agent to advance',async t=>{
 const f=await seedTwo(t);await f.adopt();await f.pump();const before=f.store.metrics(),ticket=await f.sync.beginDelete(wireTopic(older));await ticket.beforeConfigUpdate();await f.owner('one',{topics:[{id:'selected',name:'selected'},{id:'excluded',name:'excluded'}]});await ticket.changed();await ticket.destructive();
 const folder=path.dirname(f.queue.getHistoryPath(older.itemId,older.topicId));assert.ok(folder.startsWith(f.root+path.sep));await fs.rm(folder,{recursive:true});await ticket.commit();await f.sync.discover();await f.sync.tick();
 const deleted=f.store.sourceCatalog.entities('sourceA','topics').find(t=>t.ownerId==='one'&&t.topicId==='old');assert.equal(deleted.deleted,1);assert.deepEqual(f.store.metrics(),before);await assert.rejects(()=>f.queue.mutate(older,()=>[message('resurrect')]),e=>e.code==='SOURCE_DIRECTORY_DELETED');
 await f.queue.mutate(b0,rows=>[...rows,message('B after A deletion')]);await f.pump();assert.equal(f.store.metrics().journalRows,before.journalRows+1);const phone=await f.phone();assert.equal(phone.topics.length,3);assert.ok(!phone.topics.some(t=>t.ownerId==='one'&&t.topicId==='old'));f.assertOldFacts();
});
test('M3 broad limited-owner removal is refused without deleting its approved sibling or receipts',async t=>{
 const f=await seedTwo(t);await f.adopt();await f.pump();const bytes=await fs.readFile(f.adapter.statePath),before=f.store.metrics();await assert.rejects(()=>f.sync.beginDelete({ownerType:'agent',ownerId:'two'}),e=>e.code==='LIMITED_SOURCE_OWNER_DELETE_REQUIRES_TOPIC');assert.deepEqual(await fs.readFile(f.adapter.statePath),bytes);assert.deepEqual(f.store.metrics(),before);f.assertOldFacts();
});
test('M3 wrong source/device/space and in-place widening fail closed without rewriting existing bound state',async t=>{
 const f=await fixture(t);await f.adopt();await f.pump();const bytes=await fs.readFile(f.adapter.statePath);
 for(const change of [{sourceId:'other-source'},{deviceId:'other-device'},{spaceId:'other-space'},{sourceScope:limited(all)}])await assert.rejects(()=>SourceSync.verify({...f.connection,...change},f.adapter.state,f.send),e=>e.code==='SOURCE_BINDING_CHANGED');
 assert.throws(()=>new SourceCatalog(f.store,{NativeSyncFullSources:JSON.stringify([{sourceId:'sourceA',deviceId:'deviceA',scope:limited(all)}])}),e=>e.code==='SOURCE_SCOPE_CHANGED');assert.deepEqual(await fs.readFile(f.adapter.statePath),bytes);f.assertOldFacts();
});
test('M3 existing limited to new-source expansion remains BLOCKED: local binding and unique catalog ownership reject unsafe handover',async t=>{
 const f=await fixture(t);await f.adopt();await f.pump();const phone=await f.phone(),beforePhone=(await phone.call('/directory?kind=topics&limit=100')).topics;const bytes=await fs.readFile(f.adapter.statePath),before=f.store.metrics();
 const expanded=new SourceCatalog(f.store,{NativeSyncFullSources:JSON.stringify([{sourceId:'sourceA',deviceId:'deviceA',scope:limited([selected,older])},{sourceId:'sourceB',deviceId:'deviceA',scope:limited(all)}]),NativeMobileTopics:JSON.stringify([{key:'original',...wireTopic(selected)}])});
 const binding={sourceId:'sourceB',deviceId:'deviceA',spaceId:f.connection.spaceId,scopeHash:require(CHAT+'/modules/services/nativeSync/sourceScope').scopeHash(limited(all))};
 const body={opId:'new-source-handover',baseRevision:0,agents:[{ownerType:'agent',ownerId:'one',name:'one'},{ownerType:'agent',ownerId:'two',name:'two'}],topics:all.map(d=>({...wireTopic(d),name:d.topicId})),removed:[]};
 f.store.sourceCatalog=expanded;f.portal.sourceCatalog=expanded;await assert.rejects(()=>createSyncRequest({...f.connection,sourceId:'sourceB',sourceScope:limited(all)})('/api/v1/sync/source/catalog',{body}),e=>e.code==='SOURCE_IDENTITY_COLLISION');assert.equal(expanded.revision('sourceB'),0);assert.equal(expanded.entities('sourceB','topics').length,0);assert.equal(f.store.db.prepare("SELECT count(*) n FROM source_catalog_ops WHERE source_id='sourceB'").get().n,0);
 await assert.rejects(()=>SourceSync.verify({...f.connection,sourceId:'sourceB',sourceScope:limited(all)},f.adapter.state,f.send),e=>e.code==='SOURCE_BINDING_CHANGED');assert.deepEqual(await fs.readFile(f.adapter.statePath),bytes);assert.deepEqual(f.store.metrics(),before);assert.deepEqual((await phone.call('/directory?kind=topics&limit=100')).topics,beforePhone,'Failed migration must preserve existing readonly phone scope');f.assertOldFacts();
 t.diagnostic('BLOCKED_CAPABILITY: safe migration from an already-bound limited source to a wider source is not implemented; no state rewrite, second space or full-root fallback was used');
});
