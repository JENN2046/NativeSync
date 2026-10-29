// Required-capability counterexample. Expected to fail until an explicit safe
// source-handover contract exists. Do not count refusal as successful expansion.
'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {fixture,selected,older,limited,SourceCatalog,SourceSync,createSyncRequest}=require('../fixtures/boundedSourceHarness.cjs');
test('REQUIRED M3 UPGRADE: existing two-topic binding can safely adopt a wider new source without replacing device/space/cursor or old facts',async t=>{
 const f=await fixture(t);await f.adopt();await f.pump();const scope=limited([selected,older,{itemType:'agent',itemId:'two',topicId:'selected'},{itemType:'agent',itemId:'two',topicId:'old'}]);
 f.store.sourceCatalog=new SourceCatalog(f.store,{NativeSyncFullSources:JSON.stringify([{sourceId:'sourceA',deviceId:'deviceA',scope:limited([selected,older])},{sourceId:'sourceB',deviceId:'deviceA',scope}])});
 const next={...f.connection,sourceId:'sourceB',sourceScope:scope};
 await assert.doesNotReject(()=>SourceSync.verify(next,f.adapter.state,createSyncRequest(next)),'safe additive source adoption is required before existing production scope can be expanded');
});

