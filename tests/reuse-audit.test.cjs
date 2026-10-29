
'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {fixture,message,selected,older,limited,SourceCatalog,wireTopic}=require('./fixtures/boundedSourceHarness.cjs');
const b0={itemType:'agent',itemId:'two',topicId:'b0'},b1={itemType:'agent',itemId:'two',topicId:'b1'};
async function bypassPinForRiskControl(f){
 // Deliberately bypass an internal invariant in a TEMP DB only, to test the
 // unsafe alternative "just remove the pin". Normal config cannot do this.
 const wider=limited([selected,older,b0,b1]);f.store.sourceCatalog.grants.set('sourceA',{sourceId:'sourceA',deviceId:'deviceA',scope:wider});f.connection.sourceScope=wider;
 await f.send('/api/v1/sync/source/catalog',{body:{opId:'unsafe-control-only',baseRevision:f.sync.state.revision,agents:[{ownerType:'agent',ownerId:'two',name:'two'}],topics:[b0,b1].map(d=>({...wireTopic(d),name:d.topicId})),removed:[]}});
}
test('Reuse audit: normal in-source widening remains refused; preapproved incremental discovery does not require handover',async t=>{
 const f=await fixture(t);await f.adopt();await f.pump();const before=f.store.metrics();assert.throws(()=>new SourceCatalog(f.store,{NativeSyncFullSources:JSON.stringify([{sourceId:'sourceA',deviceId:'deviceA',scope:limited([selected,older,b0,b1])}])}),e=>e.code==='SOURCE_SCOPE_CHANGED');assert.deepEqual(f.store.metrics(),before);f.assertOldFacts();
});
test('Reuse audit risk control: a source-scoped old cookie is live source authority, not a two-topic snapshot',async t=>{
 const f=await fixture(t);await f.adopt();await f.pump();const phone=await f.phone();assert.equal(phone.topics.length,2);await bypassPinForRiskControl(f);const later=(await phone.call('/directory?kind=topics&limit=100')).topics;assert.equal(later.length,4);assert.ok(later.every(t=>!t.executable));t.diagnostic('UNSAFE_ALTERNATIVE_CONFIRMED: bypassing the pin would expand the old source cookie from 2 to 4 topics; not an exploitable normal API path or a successful migration');
});
test('Reuse audit minimal adapter: source snapshot pairing reuses exact-topic grants and does not inherit future source topics',async t=>{
 const f=await fixture(t);await f.adopt();await f.pump();const phone=await f.phone({snapshot:true});assert.equal(phone.topics.length,2);const session=await phone.call('/session');assert.equal(session.directory.scopeMode,'selected');await bypassPinForRiskControl(f);const after=(await phone.call('/directory?kind=topics&limit=100')).topics;assert.equal(after.length,2);const denied=f.portal.topics.find(t=>t.ownerId==='two');assert.equal(await phone.status('/conversations/'+denied.key),403);assert.deepEqual(after.map(t=>t.key).sort(),phone.topics.map(t=>t.key).sort());for(const topic of after)await phone.read(topic);assert.equal(f.store.metrics().journalRows,7);assert.equal(f.store.metrics().liveMessages,5);assert.equal(f.store.db.prepare('SELECT count(*) n FROM mobile_executions').get().n,1);
});
test('Reuse audit snapshot pairing fails closed on unknown fields, source mismatch, bad type and unready scope',async t=>{
 const f=await fixture(t);await f.adopt();await f.pump();const n=f.store.db.prepare('SELECT count(*) n FROM mobile_pairings').get().n;
 for(const options of [{scopeMode:'selected',snapshot:true},{scopeMode:'source',sourceId:'sourceA',snapshot:'yes'},{scopeMode:'source',sourceId:'sourceA',snapshot:true,topics:['anything']},{scopeMode:'source',sourceId:'missing',snapshot:true}])assert.throws(()=>f.portal.createPairing(options));
 assert.throws(()=>f.portal.createPairing({scopeMode:'source',sourceId:'sourceA',snapshot:true},{topics:[],source:{sourceId:'wrong'}}),e=>e.code==='SOURCE_SCOPE_MISMATCH');
 f.store.db.prepare("UPDATE source_catalog_entities SET ready=0 WHERE topic_id='old'").run();assert.throws(()=>f.portal.createPairing({scopeMode:'source',sourceId:'sourceA',snapshot:true}),e=>e.code==='PAIRING_SCOPE_NOT_READY');assert.equal(f.store.db.prepare('SELECT count(*) n FROM mobile_pairings').get().n,n);
});
test('Reuse audit existing cookie and recovery identity survive exact-topic permission freezing without replacing the session',async t=>{
 const f=await fixture(t);await f.adopt();await f.pump();const phone=await f.phone(),before=await phone.call('/session');
 const session=f.store.db.prepare('SELECT id FROM mobile_sessions').get();f.store.db.prepare('UPDATE mobile_executions SET session_id=? WHERE id=?').run(session.id,f.oldJob.id);
 const ownBefore=await phone.call('/conversations/original/events?after=0&limit=100');
 // Isolated state-transition primitive only; production exposes no such write API.
 f.store.db.prepare('UPDATE mobile_sessions SET scopes=? WHERE id=?').run(JSON.stringify(phone.topics.map(t=>t.key)),session.id);
 const after=await phone.call('/session'),ownAfter=await phone.call('/conversations/original/events?after=0&limit=100');
 assert.equal(after.recovery.sessionMarker,before.recovery.sessionMarker);assert.equal(after.recovery.entryId,before.recovery.entryId);assert.deepEqual(ownAfter.executions,ownBefore.executions);assert.equal(after.directory.scopeMode,'selected');assert.equal(after.topics.length,2);
});
