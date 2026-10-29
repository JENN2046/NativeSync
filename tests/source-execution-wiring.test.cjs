
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {fixture,selected,older,limited,wireTopic,SourceCatalog,CHAT,BOX}=require('./fixtures/boundedSourceHarness.cjs');
test('native explicit execution bindings above the old trial limit reuse authorized source, while unapproved large lists fail closed',async t=>{
 const bindings=Array.from({length:9},(_,i)=>({key:'binding_'+i,ownerType:'agent',ownerId:'agent'+i,topicId:'topic'+i,agentAlias:'synthetic-one'})),f=await fixture(t,{scope:{mode:'full'},executionBindings:bindings});assert.equal(f.portal.staticTopics.length,10);
 const {MobilePortal}=require(BOX+'/Plugin/NativeSync/mobile/portal');assert.throws(()=>new MobilePortal({store:{db:f.store.db,sourceCatalog:{grants:new Map([['sourceA',{scope:limited([selected,older])}]])}},config:{NativeMobileOrigin:'https://synthetic.invalid',NativeMobileTopics:JSON.stringify(f.portal.staticTopics)},agentManager:f.portal.agentManager}),e=>e.code==='EXPLICIT_MOBILE_TOPICS_REQUIRED');
});
test('adding native alias wiring cannot rename a published topic key or capture another topic key',async t=>{
 const f=await fixture(t);await f.adopt();await f.pump();const config={NativeSyncFullSources:JSON.stringify([{sourceId:'sourceA',deviceId:'deviceA',scope:limited([selected,older])}])};
 assert.throws(()=>new SourceCatalog(f.store,{...config,NativeMobileTopics:JSON.stringify([{key:'changed-key',...wireTopic(older),agentAlias:'synthetic-one'}])}),e=>e.code==='SOURCE_TOPIC_KEY_CHANGED');
 assert.throws(()=>new SourceCatalog(f.store,{...config,NativeMobileTopics:JSON.stringify([{key:'original',ownerType:'agent',ownerId:'another',topicId:'another'}])}),e=>e.code==='SOURCE_IDENTITY_COLLISION');assert.equal(f.store.sourceCatalog.keyFor('sourceA',wireTopic(selected)),'original');f.assertOldFacts();
});
test('full-source connection supports explicit execution selections beyond eight, bounded at128 and no implicit full transition',async t=>{
 const f=await fixture(t),file=path.join(f.app,'.native-sync/connection.json'),{readConnection}=require(CHAT+'/modules/services/nativeSync/connection');
 const cfg={version:1,enabled:true,scopeMode:'source',fullSelectionApproved:true,sourceId:'sourceA',deviceId:'deviceA',spaceId:f.connection.spaceId,sourceRoot:f.app,sourceScope:{mode:'full'},sourcePaused:false,scopeTransition:{opId:'full-root',expectedScopeHash:'a'.repeat(64)},topics:[],executionTopics:Array.from({length:9},(_,i)=>({itemType:'agent',itemId:'agent'+i,topicId:'topic'+i})),serverUrl:'https://synthetic.invalid',credentialSource:'existing-vcp-settings'};
 const read=async c=>{await fs.writeFile(file,JSON.stringify(c));return readConnection({appDataRoot:f.app,readSettings:async()=>({vcpServerUrl:'https://synthetic.invalid',vcpApiKey:'synthetic-only'})});};
 const c=await read(cfg);assert.equal(c.executionTopics.length,9);assert.deepEqual(c.sourceScope,{mode:'full'});assert.equal(c.scopeTransition.opId,'full-root');await assert.rejects(()=>read({...cfg,sourceScope:undefined}));await assert.rejects(()=>read({...cfg,executionTopics:Array(129).fill(selected)}),e=>e.code==='INVALID_EXECUTION_SELECTION');
});
test('private execution snapshots batch by actual UTF8 bytes, preserve all selected rows and strip credentials',async()=>{
 const {publishExecutionConfigs}=require(CHAT+'/modules/services/nativeSync/executionConfigs'),topics=Array.from({length:12},(_,i)=>({itemType:'agent',itemId:'a'+i,topicId:'t'+i})),sent=[];
 const result=await publishExecutionConfigs({topics,readAgentConfig:async id=>({id,name:id,systemPrompt:'中文'.repeat(3000),model:'synthetic-only',topics:[{id:topics.find(t=>t.itemId===id).topicId}],apiKey:'SYNTHETIC_DO_NOT_TRANSPORT'}),send:async(route,options)=>{if(!options)return {topics:topics.map(t=>({...wireTopic(t),configVersion:1}))};sent.push(options.body);return {topics:options.body.topics.map(t=>({...t,version:2}))};}});
 assert.ok(sent.length>1);assert.equal(result.topics.length,12);assert.equal(sent.flatMap(b=>b.topics).length,12);assert.ok(sent.every(b=>Buffer.byteLength(JSON.stringify(b))<=96000));assert.ok(!JSON.stringify(sent).includes('SYNTHETIC_DO_NOT_TRANSPORT'));assert.ok(sent.every(b=>b.topics.every(t=>t.expectedVersion===1)));
});
