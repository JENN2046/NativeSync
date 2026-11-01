
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

test('source-authorized portable snapshots execute without per-topic aliases and keep authority frozen',async t=>{
 const f=await fixture(t,{scope:{mode:'full'},executionMode:'all-supported'});await f.adopt();await f.pump();
 const topic=f.portal.topics.find(x=>x.ownerId===older.itemId&&x.topicId===older.topicId);assert(topic&&!topic.agentAlias);
 const config={name:'Source agent',systemPrompt:'[[VCPToolUse=Forbidden]]\nSOURCE_PORTABLE_PROMPT',model:'synthetic-model',maxOutputTokens:64};
 const published=await f.portal.engine.configs.publish({topics:[{...wireTopic(older),expectedVersion:0,config}]});assert.equal(published.topics[0].configVersion,1);
 const snap=f.portal.engine.configs.snapshot(topic);assert.equal(snap.authority.sourceId,'sourceA');assert.equal(snap.authority.topicId,older.topicId);assert.equal(snap.agentAlias,undefined);
 let calls=0,input;const http=require('node:http'),server=http.createServer(async(req,res)=>{let raw='';for await(const b of req)raw+=b;input=JSON.parse(raw);calls++;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{role:'assistant',content:'SOURCE_EXECUTED'}}]}));});await new Promise(r=>server.listen(0,'127.0.0.1',r));f.cleanups.push(()=>new Promise(r=>server.close(r)));
 f.portal.engine.setEndpoint({url:'http://127.0.0.1:'+server.address().port+'/v1/chat/completions',key:'synthetic-only'});
 const accepted=f.portal.engine.accept('source-phone',{topicKey:topic.key,requestId:'source-aliasless-1',text:'continue'});const {waitFor}=require('./fixtures/boundedSourceHarness.cjs');await waitFor(()=>f.portal.engine.get(accepted.id).state==='completed','portable execution');assert.equal(calls,1);assert(input.messages.some(m=>m.role==='system'&&m.content.includes('SOURCE_PORTABLE_PROMPT')));
 assert.equal(f.portal.engine.accept('source-phone',{topicKey:topic.key,requestId:'source-aliasless-1',text:'continue'}).id,accepted.id);assert.equal(calls,1);
 assert.throws(()=>f.portal.engine.configs.verify({...topic,ownerId:'forged-owner'},snap),e=>['SOURCE_TOPIC_NOT_APPROVED','EXECUTION_CONFIG_IDENTITY_MISMATCH'].includes(e.code));
 await assert.rejects(()=>f.portal.engine.configs.publish({topics:[{...wireTopic(older),expectedVersion:1,config:{...config,authority:snap.authority}}]}),e=>e.code==='INVALID_EXECUTION_CONFIG');
});

test('source-authorized group members need native source ownership, not global alias registration',async t=>{
 const f=await fixture(t,{scope:{mode:'full'},executionMode:'all-supported'});const group={itemType:'group',itemId:'group',topicId:'g-topic'};await f.owner('group',{type:'group',topics:[{id:'g-topic',name:'Group'}]});await f.history(group,[]);await f.adopt();await f.pump();
 const topic=f.portal.topics.find(x=>x.ownerId==='group'),member={id:'one',name:'One',systemPrompt:'SOURCE_GROUP_PROMPT',model:'synthetic-model',maxOutputTokens:64};
 const input={group:{name:'Source group',members:['one'],mode:'sequential'},agents:[member]};await f.portal.engine.configs.publish({topics:[{...wireTopic(group),expectedVersion:0,config:input}]});const snapshot=f.portal.engine.configs.snapshot(topic);assert.equal(snapshot.agents[0].authority.memberId,'one');assert.equal(snapshot.agents[0].agentAlias,undefined);
 await assert.rejects(()=>f.portal.engine.configs.publish({topics:[{...wireTopic(group),expectedVersion:1,config:{group:{...input.group,members:['unowned']},agents:[{...member,id:'unowned'}]}}]}),e=>e.code==='GROUP_MEMBER_NOT_AUTHORIZED');
 let calls=0;const http=require('node:http'),server=http.createServer(async(req,res)=>{for await(const b of req){}calls++;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{role:'assistant',content:'GROUP_SOURCE_EXECUTED'}}]}));});await new Promise(r=>server.listen(0,'127.0.0.1',r));f.cleanups.push(()=>new Promise(r=>server.close(r)));f.portal.engine.setEndpoint({url:'http://127.0.0.1:'+server.address().port+'/v1/chat/completions',key:'synthetic-only'});
 const job=f.portal.engine.accept('group-phone',{topicKey:topic.key,requestId:'source-group-1',text:'continue group'});const {waitFor}=require('./fixtures/boundedSourceHarness.cjs');await waitFor(()=>f.portal.engine.get(job.id).state==='completed','source group');assert.equal(calls,1);
});

test('source discovery and reopen do not preload history bodies; background imports retain one topic snapshot',async t=>{
 const f=await fixture(t,{scope:{mode:'full'}});await f.adopt({discover:false});f.reads.length=0;await f.sync.discover();assert.equal(f.reads.filter(r=>r.kind==='history').length,0);assert.equal(f.sync.snapshots.size,0);
 for(let i=0;i<6;i++){await f.sync.tick();assert.ok(f.sync.snapshots.size<=1);}
 assert.ok(Object.values(f.sync.state.plans).some(p=>p.stage!=='complete'));
 await f.close();f.reads.length=0;await f.open({discover:false});assert.equal(f.reads.filter(r=>r.kind==='history').length,0);assert.equal(f.sync.snapshots.size,0);await f.pump();assert.equal(f.sync.snapshots.size,0);assert.equal(f.sync.snapshotBases.size,0);assert.equal(f.sync.bodySnapshotPeak,1);
});
