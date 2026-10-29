
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises');
const {fixture,message,selected,older,limited,SourceCatalog,SourceSync,createSyncRequest,CHAT,wireTopic,stable}=require('./fixtures/boundedSourceHarness.cjs');
const {scopeHash}=require(CHAT+'/modules/services/nativeSync/sourceScope');
const b0={itemType:'agent',itemId:'two',topicId:'b0'},b1={itemType:'agent',itemId:'two',topicId:'b1'},oldScope=limited([selected,older]),newScope=limited([selected,older,b0,b1]);
const body=(opId='expand-1')=>({opId,expectedScopeHash:scopeHash(oldScope),newScope});
function approve(f,target=newScope){const catalog=new SourceCatalog(f.store,{NativeSyncFullSources:JSON.stringify([{sourceId:'sourceA',deviceId:'deviceA',scope:oldScope,approvedScope:target}]),NativeMobileTopics:JSON.stringify(f.portal.staticTopics)});f.store.sourceCatalog=catalog;f.portal.sourceCatalog=catalog;return catalog;}
function digest(f){const tables=f.store.db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();return stable(tables.map(t=>[t.name,f.store.db.prepare('SELECT * FROM "'+t.name+'"').all().map(r=>stable(r)).sort()]));}
async function widenedFiles(f){await f.owner('two',{topics:[{id:'b0',name:'b0'},{id:'b1',name:'b1'}]});await f.history(b0,[message('b0')]);await f.history(b1,[message('b1')]);}
async function activate(f,pairing){const h={'X-Forwarded-Proto':'https',Origin:'https://synthetic-mobile.invalid','Content-Type':'application/json'};const r=await fetch(f.connection.url+'/mobile/api/pair',{method:'POST',headers:h,body:JSON.stringify({code:pairing.pairingCode})});assert.equal(r.status,200);const cookie=r.headers.get('set-cookie').split(';')[0];return async(route,body)=>{const x=await fetch(f.connection.url+'/mobile/api'+route,{method:body?'POST':'GET',headers:{...h,Cookie:cookie},body:body?JSON.stringify(body):undefined});return {status:x.status,body:await x.json()};};}
test('controlled same-source expansion preserves old cookie, unused pairing, cursor/ops/jobs/v1 and admits exact new pairing scope',async t=>{
 const f=await fixture(t);await f.adopt();await f.pump();const phone=await f.phone(),unused=f.portal.createPairing({scopeMode:'source',sourceId:'sourceA'});const ownerSession=f.store.db.prepare('SELECT id FROM mobile_sessions').get().id;f.store.db.prepare('UPDATE mobile_executions SET session_id=? WHERE id=?').run(ownerSession,f.oldJob.id);const fullOldJob=f.store.db.prepare('SELECT * FROM mobile_executions WHERE id=?').get(f.oldJob.id),session=await phone.call('/session'),executions=await phone.call('/conversations/original/events?after=0');
 approve(f);await widenedFiles(f);await f.close();f.connection.sourceScope=newScope;f.connection.scopeTransition={opId:'expand-1',expectedScopeHash:scopeHash(oldScope)};await f.open();assert.equal(f.adapter.state.cursor,7);await f.pump();assert.equal(f.store.metrics().journalRows,9);assert.equal(f.store.metrics().liveMessages,7);f.assertOldFacts();
 assert.deepEqual(f.store.db.prepare('SELECT * FROM mobile_executions WHERE id=?').get(f.oldJob.id),fullOldJob);const oldPhone=(await phone.call('/directory?kind=topics&limit=100')).topics;assert.equal(oldPhone.length,2);assert.deepEqual((await phone.call('/session')).recovery,session.recovery);assert.deepEqual((await phone.call('/conversations/original/events?after=0')).executions,executions.executions);
 const oldUnused=await activate(f,unused);assert.equal((await oldUnused('/directory?kind=topics&limit=100')).body.topics.length,2);
 const fresh=await f.phone();assert.equal(fresh.topics.length,4);assert.ok(fresh.topics.every(t=>!t.executable));const denied=fresh.topics.find(t=>t.ownerId==='two');assert.equal(await phone.status('/conversations/'+denied.key),403);
 const before=f.store.metrics(),planIds=Object.values(f.sync.state.plans).map(p=>p.id);await f.close();await f.open();await f.pump();assert.deepEqual(f.store.metrics(),before);assert.deepEqual(Object.values(f.sync.state.plans).map(p=>p.id),planIds);
 approve(f);assert.equal(scopeHash(f.store.sourceCatalog.grants.get('sourceA').scope),scopeHash(newScope));
});
test('ordinary grant value or caller-requested set is not authority: separate static approvedScope is mandatory',async t=>{
 const f=await fixture(t);await f.adopt();await f.pump();const before=digest(f);await assert.rejects(()=>f.send('/api/v1/sync/source/scope-transition',{body:body()}),e=>e.code==='SCOPE_NOT_APPROVED');assert.equal(digest(f),before);
 assert.throws(()=>new SourceCatalog(f.store,{NativeSyncFullSources:JSON.stringify([{sourceId:'sourceA',deviceId:'deviceA',scope:newScope}])}),e=>e.code==='SOURCE_SCOPE_CHANGED');assert.equal(digest(f),before);
});
test('stale digest, unapproved set and wrong binding leave every database table unchanged',async t=>{
 const f=await fixture(t);await f.adopt();await f.pump();approve(f);const before=digest(f);
 for(const value of [{...body(),expectedScopeHash:'0'.repeat(64)},{...body(),newScope:limited([selected,older,b0])}]){await assert.rejects(()=>f.send('/api/v1/sync/source/scope-transition',{body:value}));assert.equal(digest(f),before);}
 for(const change of [{deviceId:'wrong'},{spaceId:'wrong'},{sourceId:'wrong'}]){await assert.rejects(()=>createSyncRequest({...f.connection,...change})('/api/v1/sync/source/scope-transition',{body:body()}));assert.equal(digest(f),before);}
});
for(const boundary of ['authority-frozen','pin-updated'])test('transaction fault at '+boundary+' rolls back pin, sessions, unused pairings and all receipts',async t=>{
 const f=await fixture(t);await f.adopt();await f.pump();await f.phone();f.portal.createPairing({scopeMode:'source',sourceId:'sourceA'});const catalog=approve(f),before=digest(f);catalog.transitionFault=stage=>{if(stage===boundary)throw Object.assign(Error('injected transition failure'),{code:'INJECTED_SCOPE_FAILURE'});};
 await assert.rejects(()=>f.send('/api/v1/sync/source/scope-transition',{body:body()}),e=>e.code==='INJECTED_SCOPE_FAILURE');assert.equal(digest(f),before);assert.equal(scopeHash(catalog.grants.get('sourceA').scope),scopeHash(oldScope));
});
test('concurrent/repeated transition applies once; reused op with different payload and stale new op are refused',async t=>{
 const f=await fixture(t);await f.adopt();await f.pump();approve(f);const replies=await Promise.all([f.send('/api/v1/sync/source/scope-transition',{body:body()}),f.send('/api/v1/sync/source/scope-transition',{body:body()})]);assert.equal(replies.filter(r=>r.replayed).length,1);assert.equal(replies[0].requestHash,replies[1].requestHash);const before=digest(f);
 await assert.rejects(()=>f.send('/api/v1/sync/source/scope-transition',{body:{...body(),newScope:limited([selected,older,b0])}}),e=>e.code==='IDEMPOTENCY_KEY_REUSED');await assert.rejects(()=>f.send('/api/v1/sync/source/scope-transition',{body:body('stale-other-op')}),e=>e.code==='SOURCE_SCOPE_CHANGED');assert.equal(digest(f),before);
});
test('lost server acceptance response leaves local state intact; restart retry adopts receipt without duplicate Journal or scope apply',async t=>{
 const f=await fixture(t);await f.adopt();await f.pump();approve(f);await widenedFiles(f);await f.close();const before=await fs.readFile(f.app+'/.native-sync/state.json');f.connection.sourceScope=newScope;f.connection.scopeTransition={opId:'expand-1',expectedScopeHash:scopeHash(oldScope)};const send=f.send;let drop=true;f.send=async(route,opts)=>{const r=await send(route,opts);if(drop&&route.endsWith('/scope-transition')){drop=false;throw Object.assign(Error('lost ack'),{code:'NETWORK_UNAVAILABLE'});}return r;};
 await assert.rejects(()=>f.open(),e=>e.code==='NETWORK_UNAVAILABLE');assert.deepEqual(await fs.readFile(f.app+'/.native-sync/state.json'),before);await f.queue.dispose();approve(f);await f.open();await f.pump();assert.equal(f.store.metrics().journalRows,9);assert.equal(f.adapter.state.source.scopeTransition.replayed,true);f.assertOldFacts();
});
test('pending local work prevents transition before any server request; original Outbox survives',async t=>{
 const f=await fixture(t);await f.adopt();await f.pump();approve(f);await f.queue.mutate(selected,rows=>[...rows,message('pending')]);const before=digest(f),count=f.sent.length;
 await assert.rejects(()=>SourceSync.verify({...f.connection,sourceScope:newScope,scopeTransition:{...body(),newScope:undefined}},f.adapter.state,f.send),e=>e.code==='SOURCE_SCOPE_NOT_SETTLED');assert.equal(f.sent.length,count);assert.equal(digest(f),before);assert.equal(f.adapter.state.outbox.length,1);
});
test('catalog ownership conflict cannot leave partial grant/session updates',async t=>{
 const f=await fixture(t);await f.adopt();await f.pump();approve(f);f.store.db.prepare('INSERT INTO source_catalog_entities(source_id,owner_type,owner_id,topic_id,metadata,ready,revision) VALUES(?,?,?,?,?,?,?)').run('other-source','agent','two','',JSON.stringify({ownerType:'agent',ownerId:'two',name:'other'}),1,1);const before=digest(f);await assert.rejects(()=>f.send('/api/v1/sync/source/scope-transition',{body:body()}),e=>e.code==='SOURCE_IDENTITY_COLLISION');assert.equal(digest(f),before);
});

test('expanded scope permits versioned new-topic phone submission/result; old cookies are denied and Desktop restores same job messages',async t=>{
 const http=require('node:http'),f=await fixture(t,{executionBindings:[{key:'configured-b0',...wireTopic(b0),agentAlias:'synthetic-two'}]});await f.adopt();await f.pump();const oldPhone=await f.phone();approve(f);await widenedFiles(f);await f.close();f.connection.sourceScope=newScope;f.connection.scopeTransition={opId:'expand-send',expectedScopeHash:scopeHash(oldScope)};await f.open();await f.pump();
 const target=f.portal.topics.find(t=>t.ownerId==='two'&&t.topicId==='b0');assert.equal(target.agentAlias,'synthetic-two','dynamic source reuses explicit native host mapping');
 await f.portal.engine.configs.publish({topics:[{...wireTopic(b0),expectedVersion:0,config:{name:'Synthetic B',systemPrompt:'[[VCPToolUse=Forbidden]]\nSynthetic scoped B',model:'synthetic-only',maxOutputTokens:128}}]});
 let calls=0;const model=http.createServer(async(req,res)=>{for await(const chunk of req){}calls++;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{role:'assistant',content:'SCOPED_REPLY'}}]}));});await new Promise(r=>model.listen(0,'127.0.0.1',r));f.cleanups.push(()=>new Promise(r=>model.close(r)));f.portal.engine.setEndpoint({url:'http://127.0.0.1:'+model.address().port+'/v1/chat/completions',key:'synthetic-only'});
 assert.equal(await oldPhone.status('/conversations/'+target.key),403);
 const phone=await activate(f,f.portal.createPairing({scopeMode:'source',sourceId:'sourceA'})),submission={requestId:'new-scope-once',text:'synthetic new scope request'},accepted=await phone('/conversations/'+target.key+'/messages',submission);assert.equal(accepted.status,202);
 const {waitFor}=require('./fixtures/boundedSourceHarness.cjs');await waitFor(()=>f.portal.engine.get(accepted.body.id).state==='completed','scoped phone reply');const replay=await phone('/conversations/'+target.key+'/messages',submission);assert.equal(replay.body.id,accepted.body.id);assert.equal(replay.body.replayed,true);assert.equal(calls,1);
 await f.adapter.synchronize();const history=(await f.queue.readSnapshot(b0)).history;assert.ok(history.some(m=>m.id===accepted.body.userMessageId));assert.ok(history.some(m=>m.content==='SCOPED_REPLY'));assert.equal(new Set(history.map(m=>m.id)).size,history.length);
 assert.deepEqual(f.store.db.prepare('SELECT id,request_id,state,attempts,config_snapshot FROM mobile_executions WHERE id=?').get(f.oldJob.id),f.oldJob);assert.deepEqual(f.store.db.prepare("SELECT version,hash FROM owner_execution_configs WHERE topic_key='original'").get(),f.oldConfig);
});

test('real server-side process exit inside the SQLite transition rolls back every table on restart',async t=>{
 const {spawn}=require('node:child_process'),path=require('node:path');const f=await fixture(t);await f.adopt();await f.pump();await f.phone();f.portal.createPairing({scopeMode:'source',sourceId:'sourceA'});approve(f);const before=digest(f),specFile=path.join(f.root,'transition-crash.json'),receipt=path.join(f.root,'transition-crash-receipt.json');
 await fs.writeFile(specFile,JSON.stringify({file:path.join(f.root,'central.sqlite'),config:{NativeSyncFullSources:JSON.stringify([{sourceId:'sourceA',deviceId:'deviceA',scope:oldScope,approvedScope:newScope}])},binding:{sourceId:'sourceA',deviceId:'deviceA',spaceId:f.connection.spaceId,scopeHash:scopeHash(oldScope)},body:body(),receipt}));
 const child=spawn(process.execPath,[path.join(__dirname,'fixtures/scopeTransitionCrash.cjs'),specFile],{env:{PATH:process.env.PATH,HOME:f.root,VCP_R21_BOX_SOURCE:process.env.VCP_R21_BOX_SOURCE},stdio:['ignore','pipe','pipe']});let stderr='';child.stderr.on('data',d=>stderr+=d);const code=await new Promise(r=>child.on('exit',r));assert.equal(code,77,stderr);const proof=JSON.parse(await fs.readFile(receipt,'utf8'));assert.equal(proof.pid,child.pid);assert.notEqual(proof.pid,process.pid);assert.equal(digest(f),before);const result=await f.send('/api/v1/sync/source/scope-transition',{body:body()});assert.equal(result.replayed,false);t.diagnostic(JSON.stringify({childPid:child.pid,exitCode:77,stage:proof.stage,allTablesUnchangedAfterCrash:true}));
});

test('physical agent/group path alias is rejected before any approval/pin transaction',async t=>{
 const f=await fixture(t);await f.adopt();await f.pump();const before=digest(f),alias=limited([selected,older,{itemType:'group',itemId:'one',topicId:'selected'}]);for(const target of [alias,limited([selected,older,{itemType:'agent',itemId:'ONE',topicId:'SELECTED'}])]){assert.throws(()=>approve(f,target),e=>e.code==='OWNER_PATH_CONFLICT');assert.equal(digest(f),before);}
});
test('client cannot adopt a transition response with wrong target or acknowledgement identity',async t=>{
 const f=await fixture(t);await f.adopt();await f.pump();approve(f);const before=await fs.readFile(f.adapter.statePath),next={...f.connection,sourceScope:newScope,scopeTransition:{opId:'bad-ack',expectedScopeHash:scopeHash(oldScope)}};
 const send=f.send;await assert.rejects(()=>SourceSync.verify(next,f.adapter.state,async(route,opts)=>({...await send(route,opts),deviceId:'wrong'})),e=>e.code==='SOURCE_TRANSITION_ACK_MISMATCH');assert.deepEqual(await fs.readFile(f.adapter.statePath),before);assert.equal(f.store.metrics().journalRows,7);
});

test('scope conversion after an explicit published topic deletion keeps the tombstone and does not resurrect old phone visibility',async t=>{
 const path=require('node:path'),f=await fixture(t);await f.adopt();await f.pump();const phone=await f.phone(),ticket=await f.sync.beginDelete(wireTopic(older));await ticket.beforeConfigUpdate();await f.owner('one',{topics:[{id:'selected',name:'selected'}]});await ticket.changed();await ticket.destructive();await fs.rm(path.dirname(f.queue.getHistoryPath(older.itemId,older.topicId)),{recursive:true});await ticket.commit();await f.sync.discover();await f.sync.tick();approve(f);await widenedFiles(f);await f.close();f.connection.sourceScope=newScope;f.connection.scopeTransition={opId:'expand-after-delete',expectedScopeHash:scopeHash(oldScope)};await f.open();await f.pump();const visible=(await phone.call('/directory?kind=topics&limit=100')).topics;assert.equal(visible.length,1);assert.equal(visible[0].topicId,'selected');assert.equal(f.store.sourceCatalog.entity('sourceA','agent','one','old').deleted,1);f.assertOldFacts();
});

test('pair consumption rereads frozen scopes inside the write transaction after a competing transition commits',async t=>{
 const f=await fixture(t);await f.adopt();await f.pump();const catalog=approve(f),pending=f.portal.createPairing({scopeMode:'source',sourceId:'sourceA'}),db=f.portal.db;let injected=false;
 f.portal.db=new Proxy(db,{get(target,key){if(key==='prepare')return sql=>{const stmt=target.prepare(sql);if(sql==='SELECT * FROM mobile_pairings WHERE hash=?')return {get(...args){const stale=stmt.get(...args);if(!injected){injected=true;catalog.transition({sourceId:'sourceA',deviceId:'deviceA',spaceId:f.connection.spaceId,scopeHash:scopeHash(oldScope)},body('pair-race'));}return stale;}};return stmt;};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
 try{f.portal.pair({body:{code:pending.pairingCode}},{setHeader(){},json(){}});}finally{f.portal.db=db;}
 const sessions=db.prepare('SELECT scopes FROM mobile_sessions').all();assert.equal(sessions.length,1);assert.equal(injected,true);assert.ok(!JSON.parse(sessions[0].scopes).includes('source:sourceA'));assert.equal(JSON.parse(sessions[0].scopes).length,2);
});

test('explicit approved full-root transition preserves original identities and freezes old phone rights while native discovery continues',async t=>{
 const f=await fixture(t);await f.adopt();await f.pump();const oldPhone=await f.phone();approve(f,{mode:'full'});await f.close();f.connection.sourceScope={mode:'full'};f.connection.scopeTransition={opId:'full-root-explicit',expectedScopeHash:scopeHash(oldScope)};await f.open();await f.pump();assert.equal(f.adapter.state.source.binding.scope,undefined);assert.equal(f.adapter.fullSource,true);assert.equal((await oldPhone.call('/directory?kind=topics&limit=100')).topics.length,2);
 await widenedFiles(f);await f.sync.discover();await f.pump();const phone=await f.phone();assert.equal(phone.topics.length,6);assert.equal((await oldPhone.call('/directory?kind=topics&limit=100')).topics.length,2);const before=f.store.metrics();await f.close();await f.open();await f.pump();approve(f,{mode:'full'});assert.deepEqual(f.store.metrics(),before);assert.equal(f.store.sourceCatalog.grants.get('sourceA').scope,undefined);f.assertOldFacts();
});
