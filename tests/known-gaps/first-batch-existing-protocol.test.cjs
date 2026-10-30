'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const HOSTS=process.env.NATIVESYNC_TEST_HOSTS;if(!HOSTS)throw Error('NATIVESYNC_TEST_HOSTS_REQUIRED');const CHAT=path.join(HOSTS,'VCPChat'),BOX=path.join(HOSTS,'VCPToolBox');
const {fixture,message}=require(CHAT+'/tests/fixtures/fullSourceHarness.cjs');
const {HistoryMutationQueue}=require(CHAT+'/modules/services/historyMutationQueue');
const {NativeSyncAdapter}=require(CHAT+'/modules/services/nativeSync/adapter');
const {SourceSync}=require(CHAT+'/modules/services/nativeSync/sourceSync');
const {createSyncRequest}=require(CHAT+'/modules/services/nativeSync/runtime');
const {SourceCatalog}=require(BOX+'/Plugin/NativeSync/sync/sourceCatalog');
const {ConversationExecution}=require(BOX+'/Plugin/NativeSync/mobile/execution');
const {wireTopic}=require(CHAT+'/modules/services/nativeSync/protocol');
const OBS=[];process.on('exit',()=>require('fs').writeFileSync(path.join(require('node:os').tmpdir(),'nativesync-gap-observations.json'),JSON.stringify({productionWrites:0,providerCalls:0,observations:OBS},null,2)));
const selected={itemType:'agent',itemId:'one',topicId:'selected'},older={itemType:'agent',itemId:'one',topicId:'old-topic'},foreign={itemType:'agent',itemId:'two',topicId:'not-approved'};
const limitedScope={mode:'limited',topics:[wireTopic(selected),wireTopic(older)]};
function limit(f){f.connection.sourceId='limitedA';f.connection.sourceScope=structuredClone(limitedScope);f.store.sourceCatalog=new SourceCatalog(f.store,{NativeSyncFullSources:JSON.stringify([{sourceId:'limitedA',deviceId:'deviceA',scope:limitedScope}]),NativeMobileTopics:JSON.stringify([{key:'original-selected',...wireTopic(selected)}])});return f;}
async function seed(t,limited=false){
 const f=await fixture(t);f.store.sourceCatalog=new SourceCatalog(f.store,{NativeSyncFullSources:JSON.stringify([{sourceId:'sourceA',deviceId:'deviceA'}]),NativeMobileTopics:JSON.stringify([{key:'original-selected',...wireTopic(selected)}])});
 await f.owner('one',{topics:[{id:'selected',name:'existing selected'},{id:'old-topic',name:'first proposed batch'}]});await f.owner('two',{topics:[{id:'not-approved',name:'excluded synthetic topic'}]});
 await f.history(selected,[]);await f.history(older,[message('old-1'),{...message('old-2'),role:'assistant'}]);await f.history(foreign,[message('excluded-1')]);
 const topic={key:'original-selected',...wireTopic(selected),agentAlias:'alias-one'};
 const engine=new ConversationExecution({store:f.store,topics:[topic],agentManager:{isAgent:x=>x==='alias-one'},configRequired:true,maxConcurrency:1});f.cleanups.push(()=>engine.close());
 await engine.configs.publish({topics:[{...wireTopic(selected),expectedVersion:0,config:{name:'Synthetic Nova',systemPrompt:'[[VCPToolUse=Forbidden]]\nSynthetic.',model:'synthetic-model',maxOutputTokens:1024}}]});
 let prior=null;for(let i=0;i<3;i++)prior=f.store.apply({...wireTopic(selected),msgId:'existing-desktop',deviceId:'deviceA',opId:'original-op-'+i,action:'upsert',baseHash:prior?.hash??null,message:message('existing-desktop','revision-'+i)});
 const job=engine.accept('synthetic-session',{topicKey:topic.key,requestId:'accepted-before-source',text:'synthetic accepted phone message'});const replyId='reply_'+job.id;f.store.apply({...wireTopic(selected),msgId:replyId,deviceId:'server:native-execution',opId:'reply:'+job.id,action:'upsert',baseHash:null,message:{...message(replyId,'synthetic completed reply'),role:'assistant'}});f.store.db.prepare("update mobile_executions set state='completed',attempts=1,reply_message_id=? where id=?").run(replyId,job.id);
 f.oldJob=f.store.db.prepare('select id,request_id,state,attempts,config_snapshot from mobile_executions').get();f.oldConfig=f.store.db.prepare('select version,hash from owner_execution_configs').get();f.oldJournal=f.store.pull(0,500).events.map(e=>({seq:e.seq,msgId:e.msgId,hash:e.hash}));
 f.queue=new HistoryMutationQueue({userDataDir:path.join(f.app,'UserData'),logger:{warn(){}}});f.selectedConnection={url:f.connection.url,token:'synthetic-only',deviceId:'deviceA',topics:[selected]};
 f.adapter=await NativeSyncAdapter.open({queue:f.queue,statePath:path.join(f.app,'.native-sync/state.json'),...f.selectedConnection,request:createSyncRequest(f.selectedConnection)});await f.adapter.synchronize();assert.equal(f.adapter.state.cursor,5);assert.equal(f.store.metrics().liveMessages,3);f.savedState=structuredClone(f.adapter.state);return limited?limit(f):f;
}
async function adopt(f,discover=true){
 const adopted=await SourceSync.verify(f.connection,f.adapter.state,f.send);const topics=f.adapter.state.topics;await f.adapter.close();await f.queue.dispose();f.queue=new HistoryMutationQueue({userDataDir:path.join(f.app,'UserData'),logger:{warn(){}}});f.connection.topics=topics;
 f.adapter=await NativeSyncAdapter.open({queue:f.queue,statePath:path.join(f.app,'.native-sync/state.json'),...f.connection,topics,source:adopted,sourceAdoptionVerified:true,request:f.send});f.sync=await new SourceSync({adapter:f.adapter,connection:f.connection,appDataRoot:f.app,readAgentConfig:f.readAgentConfig,readGroupConfig:f.readGroupConfig,send:f.send}).open();if(discover)await f.sync.discover();return f;
}
test('selected cannot append a topic by editing connection; original cursor/state bytes survive',async t=>{const f=await seed(t);await f.adapter.close();await f.queue.dispose();f.queue=new HistoryMutationQueue({userDataDir:path.join(f.app,'UserData'),logger:{warn(){}}});const file=path.join(f.app,'.native-sync/state.json'),before=await fs.readFile(file);await assert.rejects(()=>NativeSyncAdapter.open({queue:f.queue,statePath:file,...f.selectedConnection,topics:[selected,older],request:createSyncRequest(f.selectedConnection)}),e=>e.code==='OWNER_BINDING_CHANGED');assert.deepEqual(await fs.readFile(file),before);OBS.push({case:'selected-add',result:'OWNER_BINDING_CHANGED',stateBytesPreserved:true});});
test('unversioned or incomplete grant allowlist is rejected, not treated as full-root',async t=>{const f=await fixture(t);assert.throws(()=>new SourceCatalog(f.store,{NativeSyncFullSources:JSON.stringify([{sourceId:'limited-source',deviceId:'deviceA',topics:[wireTopic(older)]}])}),e=>e.code==='INVALID_SOURCE_CATALOG');OBS.push({case:'bounded-grant',result:'INVALID_SOURCE_CATALOG',newBindingsCreated:false});});
test('REQUIRED BATCH SAFETY: explicit limited source must not enroll excluded topic',async t=>{const f=await seed(t,true);await adopt(f);const unapproved=f.adapter.topics.filter(x=>x.itemId==='two');OBS.push({case:'bounded-discovery',expectedAdditionalOldTopics:1,observedTopics:f.adapter.topics,excludedEnrolled:unapproved.length,plans:Object.keys(f.sync.state.plans).length,sourceRevision:f.sync.state.revision});assert.equal(unapproved.length,0,'single-old-topic authorization is exceeded by existing full-root discover');});
test('existing full-root adoption preserves device/space/cursor, completed job/v1 and old facts; repeat pump is idempotent',async t=>{const f=await seed(t),space=f.store.sourceCatalog.spaceId;await adopt(f);assert.equal(f.adapter.state.cursor,5);assert.equal(f.adapter.deviceId,'deviceA');assert.equal(f.adapter.state.source.binding.spaceId,space);await f.pump();const before=f.store.metrics();await f.pump();assert.deepEqual(f.store.metrics(),before);assert.equal(f.adapter.topics.filter(d=>d.itemId==='two').length,1,'legacy full-root retains explicit whole-root semantics');assert.deepEqual(f.store.db.prepare('select id,request_id,state,attempts,config_snapshot from mobile_executions').get(),f.oldJob);assert.deepEqual(f.store.db.prepare('select version,hash from owner_execution_configs').get(),f.oldConfig);assert.deepEqual(f.store.pull(0,500).events.slice(0,5).map(e=>({seq:e.seq,msgId:e.msgId,hash:e.hash})),f.oldJournal);assert.ok(f.adapter.state.cursor>=5);assert.equal(f.store.sourceCatalog.keyFor('sourceA',wireTopic(selected)),'original-selected');OBS.push({case:'full-root-adoption',deviceUnchanged:true,spaceUnchanged:true,oldCursor:5,newCursor:f.adapter.state.cursor,oldCompletedJobAndV1Preserved:true,oldJournalPrefixPreserved:true,newTopics:f.store.sourceCatalog.entities('sourceA','topics').length,liveMessages:before.liveMessages,idempotent:true});});
test('after source adoption restoring selected config is rejected instead of erasing new binding',async t=>{const f=await seed(t);await adopt(f);await f.pump();await f.adapter.close();await f.queue.dispose();f.queue=new HistoryMutationQueue({userDataDir:path.join(f.app,'UserData'),logger:{warn(){}}});const file=path.join(f.app,'.native-sync/state.json'),before=await fs.readFile(file);await assert.rejects(()=>NativeSyncAdapter.open({queue:f.queue,statePath:file,...f.selectedConnection,request:createSyncRequest(f.selectedConnection)}),e=>e.code==='SOURCE_BINDING_CHANGED');assert.deepEqual(await fs.readFile(file),before);OBS.push({case:'unsafe-selected-rollback',result:'SOURCE_BINDING_CHANGED',stateBytesPreserved:true});});
test('wrong-space adoption is rejected without modifying selected state',async t=>{const f=await seed(t),file=f.adapter.statePath,before=await fs.readFile(file);await assert.rejects(()=>SourceSync.verify({...f.connection,spaceId:'wrong-space'},f.adapter.state,f.send),e=>e.code==='SOURCE_BINDING_CHANGED');assert.deepEqual(await fs.readFile(file),before);});
test('turning source connection off keeps full-root recovery fence; does not silently restore selected local writes',async t=>{const f=await seed(t);await adopt(f);await f.pump();await f.adapter.close();await f.queue.dispose();const local={itemType:'agent',itemId:'local-only',topicId:'unpublished'};await f.owner('local-only',{topics:[{id:'unpublished',name:'not part of admitted batch'}]});await f.history(local,[]);f.queue=new HistoryMutationQueue({userDataDir:path.join(f.app,'UserData'),logger:{warn(){}}});const attachment=await require(CHAT+'/modules/services/nativeSync/localAttachment').attachLocalRecovery({queue:f.queue,statePath:path.join(f.app,'.native-sync/state.json')});attachment.setError('SYNC_CONNECTION_REQUIRED');await assert.rejects(()=>f.queue.mutate(local,()=>[message('local-write')]),e=>e.code==='SYNC_CONNECTION_REQUIRED');OBS.push({case:'source-off-rollback',fullRootFence:attachment.fence.fullSource,unpublishedLocalWriteBlocked:true,stateNotCleared:true});});

test('limited discover filters before foreign config/history reads; no foreign plan/snapshot/publication/write',async t=>{
 const f=await seed(t,true),read=f.readAgentConfig;let foreignConfigs=0,foreignHistory=0;
 f.readAgentConfig=async id=>{if(id==='two'){foreignConfigs++;throw Error('EXCLUDED_CONFIG_READ');}return read(id);};
 const original=HistoryMutationQueue.prototype.read;
 HistoryMutationQueue.prototype.read=async function(d,...rest){if(d.itemId==='two')foreignHistory++;return original.call(this,d,...rest);};
 t.after(()=>{HistoryMutationQueue.prototype.read=original;});
 await adopt(f);assert.equal(f.adapter.state.cursor,5);assert.equal(f.store.metrics().journalRows,5);
 const plans=Object.values(f.sync.state.plans);assert.equal(plans.length,2);assert.ok(plans.every(p=>p.descriptor.itemId==='one'));
 await f.pump();assert.equal(foreignConfigs,0);assert.equal(foreignHistory,0);
 assert.equal(f.sync.directory.topics.length,2);assert.equal(f.sync.directory.agents.length,1);
 assert.equal(f.store.sourceCatalog.entities('limitedA','topics').length,2);
 assert.equal(f.store.db.prepare("select count(*) n from journal where owner_id='two'").get().n,0);
 const before=f.store.metrics();await f.pump();assert.deepEqual(f.store.metrics(),before);
 assert.deepEqual(f.store.db.prepare('select id,request_id,state,attempts,config_snapshot from mobile_executions').get(),f.oldJob);
 assert.deepEqual(f.store.db.prepare('select version,hash from owner_execution_configs').get(),f.oldConfig);
 assert.deepEqual(f.store.pull(0,500).events.slice(0,5).map(e=>({seq:e.seq,msgId:e.msgId,hash:e.hash})),f.oldJournal);
 OBS.push({case:'limited-root-filter',foreignHistory,foreignConfigs,foreignPlans:0,foreignSnapshot:0,foreignPublish:0,foreignWrites:0,oldCursor:5,oldJournalPrefixPreserved:true,completedJobAndV1Preserved:true});
});
test('limited server independently rejects foreign parent/topic publish, baseline and journal push',async t=>{
 const f=await seed(t,true);await adopt(f);await f.pump();const before=f.store.metrics(),revision=f.store.sourceCatalog.revision('limitedA');
 for(const body of [
  {opId:'bad-agent',baseRevision:revision,agents:[{ownerType:'agent',ownerId:'two',name:'excluded'}],topics:[],removed:[]},
  {opId:'bad-topic',baseRevision:revision,agents:[],topics:[{...wireTopic(foreign),name:'excluded'}],removed:[]},
  {opId:'bad-sibling',baseRevision:revision,agents:[],topics:[{ownerType:'agent',ownerId:'one',topicId:'not-approved-sibling',name:'excluded'}],removed:[]},
  {opId:'bad-owner-delete',baseRevision:revision,agents:[],topics:[],removed:[{ownerType:'agent',ownerId:'one',kind:'owner'}]},
 ])await assert.rejects(()=>f.send('/api/v1/sync/source/catalog',{body}),e=>e.status===403);
 await assert.rejects(()=>f.send('/api/v1/sync/source/baselines',{body:{planId:'bad-baseline',...wireTopic(foreign)}}),e=>e.status===403);
 const op={...wireTopic(foreign),deviceId:'deviceA',opId:'bad-journal',msgId:'bad',baseHash:null,action:'upsert',message:message('bad')};
 await assert.rejects(()=>f.send('/api/v1/sync/source/push',{body:op}),e=>e.code==='SOURCE_TOPIC_NOT_APPROVED');
 assert.equal(f.store.sourceCatalog.revision('limitedA'),revision);assert.deepEqual(f.store.metrics(),before);
 const selectedSend=createSyncRequest({...f.selectedConnection,topics:[foreign]});
 await assert.rejects(()=>selectedSend('/api/v1/sync/push',{body:op}),e=>e.code==='SOURCE_BINDING_REQUIRED');
 const headers={Authorization:'Bearer synthetic-only','X-NativeSync-Source':'limitedA','X-NativeSync-Device':'deviceA','X-NativeSync-Space':f.connection.spaceId};
 const response=await fetch(f.connection.url+'/api/v1/sync/source/status',{headers});assert.equal(response.status,403);assert.equal((await response.json()).error.code,'SOURCE_SCOPE_MISMATCH');
 assert.deepEqual(f.store.metrics(),before);
});
test('limited grant scope is persisted; missing, widened, narrowed and cross-device scope cannot reopen it',async t=>{
 const f=await seed(t,true),base={sourceId:'limitedA',deviceId:'deviceA',scope:limitedScope};
 for(const grant of [{...base,scope:undefined},{...base,scope:{mode:'limited',topics:[wireTopic(selected)]}},{...base,scope:{mode:'limited',topics:[...limitedScope.topics,wireTopic(foreign)]}},{...base,deviceId:'another-device'}])
  assert.throws(()=>new SourceCatalog(f.store,{NativeSyncFullSources:JSON.stringify([grant])}),e=>['SOURCE_SCOPE_CHANGED','SOURCE_BINDING_CHANGED'].includes(e.code));
 const {normalizeScope}=require(CHAT+'/modules/services/nativeSync/sourceScope');
 for(const value of [null,{}, {mode:'limited'}, {mode:'limited',topics:[]},{mode:'limited',topics:[{ownerType:'agent',ownerId:'one'}]},{mode:'limited',topics:[...limitedScope.topics,wireTopic(selected)]}])assert.throws(()=>normalizeScope(value),e=>e.code==='INVALID_SOURCE_SCOPE');
 await assert.rejects(()=>SourceSync.verify({...f.connection,sourceScope:undefined},f.adapter.state,createSyncRequest({...f.connection,sourceScope:undefined})),e=>e.code==='SOURCE_SCOPE_MISMATCH');
 await assert.rejects(()=>SourceSync.verify({...f.connection,deviceId:'wrong'},f.adapter.state,createSyncRequest({...f.connection,deviceId:'wrong'})),e=>e.code==='SOURCE_NOT_APPROVED');
});
test('scope drift after adoption fails before discovery and preserves durable state',async t=>{
 const f=await seed(t,true);await adopt(f);const before=await fs.readFile(f.adapter.statePath);
 f.connection.sourceScope.topics.push(wireTopic(foreign));
 await assert.rejects(()=>f.sync.discover(),e=>e.code==='SOURCE_BINDING_CHANGED');
 assert.deepEqual(await fs.readFile(f.adapter.statePath),before);
});
test('limited pause stops new imports; outside native writes remain local, unfinished approved writes remain fenced',async t=>{
 const f=await seed(t,true);await adopt(f,false);const state=structuredClone(f.adapter.state);f.connection.sourcePaused=true;
 await f.sync.tick();assert.deepEqual(f.adapter.state,state);assert.equal(f.store.metrics().journalRows,5);
 await f.queue.mutate(foreign,rows=>[...rows,message('outside-local')]);assert.equal(f.adapter.state.outbox.length,0);
 // No plan has been captured; pausing must not create one through native writes.
 assert.equal(Object.keys(f.sync.state.plans).length,0);
 await assert.rejects(()=>f.queue.mutate(older,rows=>[...rows,message('paused-approved')]),e=>e.code==='SOURCE_IMPORT_PAUSED');
 f.connection.sourcePaused=false;await f.sync.discover();await f.pump();assert.equal(f.store.db.prepare("select count(*) n from journal where owner_id='two'").get().n,0);
});
test('limited restart resumes same plans and identities; connection-off fence allows outside but protects approved topics',async t=>{
 const f=await seed(t,true);await adopt(f);await f.pump();const before=f.store.metrics(),source=structuredClone(f.adapter.state.source),cursor=f.adapter.state.cursor;
 await f.adapter.close();await f.queue.dispose();await f.open();await f.pump();assert.equal(f.adapter.state.cursor,cursor);assert.deepEqual(f.store.metrics(),before);
 assert.equal(f.adapter.state.source.binding.sourceId,source.binding.sourceId);assert.deepEqual(Object.values(f.sync.state.plans).map(p=>p.id),Object.values(source.plans).map(p=>p.id));
 await f.adapter.close();await f.queue.dispose();f.queue=new HistoryMutationQueue({userDataDir:path.join(f.app,'UserData'),logger:{warn(){}}});
 const local=await require(CHAT+'/modules/services/nativeSync/localAttachment').attachLocalRecovery({queue:f.queue,statePath:f.adapter.statePath});local.setError('SYNC_CONNECTION_REQUIRED');
 assert.equal(local.fence.fullSource,false);await f.queue.mutate(foreign,rows=>[...rows,message('local-after-close')]);
 await assert.rejects(()=>f.queue.mutate(older,rows=>[...rows,message('approved-after-close')]),e=>e.code==='SYNC_CONNECTION_REQUIRED');
 assert.deepEqual(f.store.metrics(),before);
});

test('limited baseline page/completion rejects a forged out-of-scope stored record',async t=>{
 const f=await seed(t,true);await adopt(f);await f.pump();
 const id=require('node:crypto').randomUUID();f.store.db.prepare('INSERT INTO source_baselines(id,source_id,device_id,plan_id,owner_type,owner_id,topic_id,watermark,total_rows) VALUES(?,?,?,?,?,?,?,?,?)').run(id,'limitedA','deviceA','forged-plan','agent','two','not-approved',5,0);
 await assert.rejects(()=>f.send('/api/v1/sync/source/baselines/'+id),e=>e.status===403);
 await assert.rejects(()=>f.send('/api/v1/sync/source/baselines/'+id+'/complete',{body:{}}),e=>e.status===403);
 assert.equal(f.store.db.prepare('SELECT completed FROM source_baselines WHERE id=?').get(id).completed,0);
 const foreignRow=f.store.apply({...wireTopic(foreign),deviceId:'test-setup',msgId:'proof-only',opId:'proof-setup',baseHash:null,action:'upsert',message:message('proof-only')});
 await assert.rejects(()=>f.send('/api/v1/sync/source/verify-state',{body:{cursor:foreignRow.seq,records:[{...wireTopic(foreign),msgId:'proof-only',seq:foreignRow.seq,hash:foreignRow.hash}]}}),e=>e.code==='SOURCE_TOPIC_NOT_APPROVED');
});
test('paused source survives reopen; unfinished outbox keeps original IDs and resumes once',async t=>{
 const f=await seed(t,true);await adopt(f);await f.queue.mutate(older,rows=>rows.map(m=>m.id==='old-1'?{...m,content:'edited-before-exit',updatedAt:10}:m));
 const ops=structuredClone(f.adapter.state.outbox),binding=structuredClone(f.sync.state.binding),plans=Object.values(f.sync.state.plans).map(p=>p.id);assert.equal(ops.length,1);
 f.connection.sourcePaused=true;await f.adapter.close();await f.queue.dispose();await f.open();
 assert.deepEqual(f.adapter.state.outbox,ops);assert.deepEqual(f.sync.state.binding,binding);assert.deepEqual(Object.values(f.sync.state.plans).map(p=>p.id),plans);
 await f.sync.tick();await f.adapter.synchronize();assert.deepEqual(f.adapter.state.outbox,ops);assert.equal(f.store.metrics().journalRows,5);
 await f.queue.mutate(foreign,rows=>[...rows,message('paused-local-after-exit')]);assert.deepEqual(f.adapter.state.outbox,ops);
 f.connection.sourcePaused=false;await f.pump();const before=f.store.metrics();await f.pump();assert.deepEqual(f.store.metrics(),before);
 assert.equal(f.store.db.prepare('SELECT count(*) n FROM applied_ops WHERE device_id=? AND op_id=?').get('deviceA',ops[0].opId).n,1);
 assert.deepEqual(f.store.db.prepare('select id,request_id,state,attempts,config_snapshot from mobile_executions').get(),f.oldJob);assert.deepEqual(f.store.db.prepare('select version,hash from owner_execution_configs').get(),f.oldConfig);
});
test('limited connection parser keeps scope and pause; malformed scope and selected/source ambiguity fail',async t=>{
 const f=await seed(t),file=path.join(f.app,'.native-sync/connection.json'),{readConnection}=require(CHAT+'/modules/services/nativeSync/connection');
 const base={version:1,enabled:true,scopeMode:'source',fullSelectionApproved:true,sourceId:'limitedA',spaceId:f.connection.spaceId,sourceRoot:f.app,deviceId:'deviceA',topics:[],serverUrl:'https://synthetic.invalid',credentialSource:'existing-vcp-settings',sourceScope:limitedScope,sourcePaused:true};
 const read=async config=>{await fs.writeFile(file,JSON.stringify(config));return readConnection({appDataRoot:f.app,readSettings:async()=>({vcpServerUrl:'https://synthetic.invalid',vcpApiKey:'synthetic-only'})});};
 const parsed=await read(base);assert.equal(parsed.sourcePaused,true);assert.equal(parsed.sourceScope.topics.length,2);
 for(const config of [{...base,sourceScope:{mode:'limited'}},{...base,sourceScope:undefined},{...base,sourcePaused:'yes'},{...base,scopeMode:'selected',topics:[selected]}])await assert.rejects(()=>read(config));
});
test('limited scope cannot admit a colliding owner path or broad owner deletion',async t=>{
 const f=await seed(t,true);await adopt(f);const before=await fs.readFile(f.adapter.statePath);
 await assert.rejects(()=>f.queue.mutate({...selected,itemType:'group'},()=>[message('alias-write')]),e=>e.code==='OWNER_PATH_CONFLICT');
 await assert.rejects(()=>f.sync.beginDelete({ownerType:'agent',ownerId:'one'}),e=>e.code==='LIMITED_SOURCE_OWNER_DELETE_REQUIRES_TOPIC');
 assert.deepEqual(await fs.readFile(f.adapter.statePath),before);
});

test('failed narrowed-scope startup retains the original recovery fence, including unattached approved topics',async t=>{
 const f=await seed(t,true);await adopt(f,false);const source=structuredClone(f.adapter.state.source),file=f.adapter.statePath,before=await fs.readFile(file);await f.adapter.close();await f.queue.dispose();
 f.queue=new HistoryMutationQueue({userDataDir:path.join(f.app,'UserData'),logger:{warn(){}}});
 const local=await require(CHAT+'/modules/services/nativeSync/localAttachment').attachLocalRecovery({queue:f.queue,statePath:file});
 const changed=structuredClone(source);changed.binding.scope.topics=[wireTopic(selected)];
 await assert.rejects(()=>NativeSyncAdapter.open({queue:f.queue,statePath:file,...f.connection,topics:[selected],source:changed,request:f.send}),e=>e.code==='SOURCE_BINDING_CHANGED');
 assert.equal(f.queue.syncPolicy,local.fence);await assert.rejects(()=>f.queue.mutate(older,rows=>[...rows,message('must-stay-protected')]));
 await f.queue.mutate(foreign,rows=>[...rows,message('still-local')]);assert.deepEqual(await fs.readFile(file),before);
});
