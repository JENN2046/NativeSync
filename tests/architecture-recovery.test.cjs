'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {fixture,selected,older,message,wireTopic}=require('./fixtures/boundedSourceHarness.cjs');
test('paged inbox isolates a conflict backlog beyond 1000 events and recovers after reopen',async t=>{
 const f=await fixture(t);await f.adopt();await f.pump();
 await f.queue.mutate(selected,rows=>rows.map(m=>m.id==='existing-desktop'?{...m,content:'synthetic local conflict'}:m));
 const table=f.store.findMessage;let base=table.get('agent','one','selected','existing-desktop').hash;
 for(let i=0;i<1001;i++){
  const r=f.store.apply({...wireTopic(selected),msgId:'existing-desktop',deviceId:'synthetic-peer',opId:'peer-conflict-'+i,action:'upsert',baseHash:base,message:message('existing-desktop','synthetic remote '+i)});base=r.hash;
 }
 const good=f.store.apply({...wireTopic(older),msgId:'healthy-after-overflow',deviceId:'synthetic-peer',opId:'healthy-after-overflow',action:'upsert',baseHash:null,message:message('healthy-after-overflow')});
 let failure;try{await f.adapter.pull({limit:500});}catch(e){failure=e.code;}
 const rows=await f.queue.read(older);
 assert.equal(failure,undefined);assert.equal(f.adapter.state.inbox.length,1001);assert.ok(f.adapter.state.inbox.every(r=>r.event.payloadRef&&!r.event.message));
 assert.equal(rows.some(m=>m.id==='healthy-after-overflow'),true);assert.equal(f.adapter.state.cursor,good.seq);const op=f.adapter.state.outbox[0].opId;await f.close();await f.open();assert.equal(f.adapter.state.inbox.length,1001);assert.equal(f.adapter.state.outbox[0].opId,op);

});
test('quiescing rejects new HTTP submissions without durable writes and preserves accepted replay',async t=>{
 const f=await fixture(t,{executionBindings:[{key:'older-run',...wireTopic(older),agentAlias:'synthetic-one'}]});await f.adopt();await f.pump();
 await f.portal.engine.configs.publish({topics:[{...wireTopic(older),expectedVersion:0,config:{name:'Synthetic',systemPrompt:'[[VCPToolUse=Forbidden]]\nSynthetic only',model:'synthetic-model',maxOutputTokens:32}}]});
 const pairing=f.portal.createPairing({scopeMode:'source',sourceId:'sourceA'}),headers={'X-Forwarded-Proto':'https',Origin:'https://synthetic-mobile.invalid','Content-Type':'application/json'};
 const paired=await fetch(f.connection.url+'/mobile/api/pair',{method:'POST',headers,body:JSON.stringify({code:pairing.pairingCode})});assert.equal(paired.status,200);headers.Cookie=paired.headers.get('set-cookie').split(';')[0];
 const accepted=f.portal.engine.accept('synthetic-replay',{topicKey:'older-run',requestId:'before-drain-synthetic',text:'accepted'});f.portal.beginDrain();const before=f.store.metrics();
 assert.equal(f.portal.engine.accept('synthetic-replay',{topicKey:'older-run',requestId:'before-drain-synthetic',text:'accepted'}).id,accepted.id);
 assert.throws(()=>f.portal.createPairing(),e=>e.code==='HOST_DRAINING');
 const response=await fetch(f.connection.url+'/mobile/api/conversations/older-run/messages',{method:'POST',headers,body:JSON.stringify({requestId:'after-drain-synthetic',text:'Synthetic after drain'})});const body=await response.json();
 assert.equal(response.status,503,JSON.stringify(body));assert.equal(body.error.code,'HOST_DRAINING');assert.deepEqual(f.store.metrics(),before);

});
test('graceful quiescing allows an already dispatched native HTTP request to publish once',async t=>{
 const http=require('node:http'),{waitFor}=require('./fixtures/boundedSourceHarness.cjs');
 const f=await fixture(t,{executionBindings:[{key:'older-run',...wireTopic(older),agentAlias:'synthetic-one'}]});await f.adopt();await f.pump();
 await f.portal.engine.configs.publish({topics:[{...wireTopic(older),expectedVersion:0,config:{name:'Synthetic',systemPrompt:'[[VCPToolUse=Forbidden]]\nSynthetic only',model:'synthetic-model',maxOutputTokens:32}}]});
 let respond,calls=0;const server=http.createServer(async(req,res)=>{for await(const _ of req){}calls++;respond=()=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:'synthetic completed'}}]}));};});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));f.cleanups.push(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));});
 f.portal.engine.setEndpoint({url:'http://127.0.0.1:'+server.address().port+'/v1/chat/completions',key:'synthetic-only'});
 const job=f.portal.engine.accept('synthetic-dispatch',{topicKey:'older-run',requestId:'dispatched-synthetic',text:'synthetic'});await waitFor(()=>respond,'native HTTP reached');
 const active=f.portal.engine.active.get(job.id);f.portal.beginDrain();assert.equal(active.signal.aborted,false);respond();await waitFor(()=>f.portal.engine.get(job.id).state==='completed','native reply saved');assert.equal(calls,1);
});
for(const afterRename of [false,true])test('receive-page persistence failure '+(afterRename?'after':'before')+' state rename preserves replay and recovery',async t=>{
 const f=await fixture(t);await f.adopt();await f.pump();const original=f.adapter.persist,initial=f.adapter.state.cursor;
 f.store.apply({...wireTopic(older),msgId:'durable-event',deviceId:'synthetic-peer',opId:'durable-event',action:'upsert',baseHash:null,message:message('durable-event')});
 let armed=true;f.adapter.persist=async(file,value)=>{if(armed&&value.cursor>initial&&value.inbox.length){armed=false;if(afterRename)await original(file,value);throw Object.assign(Error('synthetic state failure'),{code:'EIO'});}return original(file,value);};
 await assert.rejects(()=>f.adapter.pull(),e=>e.code==='EIO');await f.close();await f.open();await f.adapter.pull();
 assert.equal((await f.queue.read(older)).filter(m=>m.id==='durable-event').length,1);assert.equal(f.adapter.state.inbox.length,0);assert.equal(f.store.metrics().journalRows,8);
});
test('v2 inbox migration preserves events and corrupt external pages fail closed after reopen',async t=>{
 const fs=require('node:fs/promises');const f=await fixture(t);await f.adopt();await f.pump();
 await f.queue.mutate(selected,rows=>rows.map(m=>m.id==='existing-desktop'?{...m,content:'local'}:m));
 const base=f.store.findMessage.get('agent','one','selected','existing-desktop').hash;
 f.store.apply({...wireTopic(selected),msgId:'existing-desktop',deviceId:'synthetic-peer',opId:'migration-event',action:'upsert',baseHash:base,message:message('existing-desktop','remote')});await f.adapter.pull();
 const legacy=structuredClone(f.adapter.state);for(const row of legacy.inbox)row.event=await f.adapter.pages.hydrate(row.event);legacy.version=2;legacy.format='native-message-intents-v1';const file=f.adapter.statePath;
 await f.close();await fs.writeFile(file,JSON.stringify(legacy));await f.open();assert.equal(f.adapter.state.version,3);assert.equal(f.adapter.state.inbox.length,1);const ref=f.adapter.state.inbox[0].event.payloadRef,page=f.adapter.pages.file(ref.page);await f.close();
 await fs.writeFile(page,JSON.stringify({version:1,events:[]}));const before=await fs.readFile(file);await assert.rejects(()=>f.open(),e=>e.code==='INBOX_PAGE_CORRUPT');assert.deepEqual(await fs.readFile(file),before);
});
test('empty sync does not rewrite state; progress is change-driven with a bounded heartbeat',async t=>{
 const f=await fixture(t);await f.adopt();await f.pump();const original=f.adapter.persist;let writes=0;
 f.adapter.persist=async(...args)=>{writes++;return original(...args);};for(let i=0;i<5;i++)await f.adapter.synchronize();assert.equal(writes,0);
 const before=f.sent.length;await f.sync.report();await f.sync.report();assert.equal(f.sent.length,before+1);f.sync.reportedAt-=30001;await f.sync.report();assert.equal(f.sent.length,before+2);
});
test('versioned task pages and Desktop refresh remain bounded beyond 10000 jobs and include old review work',async t=>{
 const {CHAT}=require('./fixtures/boundedSourceHarness.cjs'),{NativeExecutionStatus}=require(CHAT+'/modules/services/nativeSync/executionStatus');
 const f=await fixture(t),seed=f.portal.engine.get(f.oldJob.id);delete seed.ordinal;const keys=Object.keys(seed),put=f.store.db.prepare('INSERT INTO mobile_executions('+keys.join(',')+') VALUES('+keys.map(()=>'?').join(',')+')');
 f.store.db.exec('BEGIN IMMEDIATE');try{for(let i=0;i<10000;i++){const row={...seed,id:'synthetic-status-'+i,request_id:'synthetic-status-request-'+i};put.run(...keys.map(k=>row[k]));}f.store.db.exec('COMMIT');}catch(e){f.store.db.exec('ROLLBACK');throw e;}
 f.store.db.prepare("UPDATE mobile_executions SET state='review_required',review_resolved=0 WHERE id=?").run(f.oldJob.id);
 const first=f.portal.engine.page('original',null,{limit:64}),second=f.portal.engine.page('original',null,{limit:64,cursor:first.next});assert.equal(first.executions.length,64);assert.equal(first.total,10001);assert.ok(second.executions.every(r=>!first.executions.some(a=>a.id===r.id)));assert.throws(()=>f.portal.engine.page('other',null,{cursor:first.next}),e=>e.code==='INVALID_EXECUTION_CURSOR');assert.throws(()=>f.portal.engine.list('original',null),e=>e.code==='EXECUTION_PAGINATION_REQUIRED');
 let writes=0;const service=await NativeExecutionStatus.open({connection:{...f.connection,url:'https://synthetic.invalid',topics:[selected]},file:f.app+'/.native-sync/paged-status.json',persist:async()=>{writes++;},request:async route=>{const q=Object.fromEntries(new URL(route,'https://synthetic.invalid').searchParams);delete q.ownerType;delete q.ownerId;delete q.topicId;return {...f.portal.engine.page('original',null,q),topic:wireTopic(selected),syntheticPrivateExtra:'must-not-forward'};}});
 const result=await service.refresh(selected);assert.equal(result.error,null);assert.equal(result.total,10001);assert.ok(result.executions.some(r=>r.id===f.oldJob.id));assert.ok(result.executions.length<=128);assert.equal(result.attentionTotal,1);await service.refresh(selected);assert.equal(writes,1);const page=await service.page(selected,{mode:'recent',limit:2});assert.equal(page.executions.length,2);assert.equal('syntheticPrivateExtra' in page,false);await service.close();
});
test('plugin quiescing closes sync/config/pairing writes but keeps reads available',async t=>{
 const {fixture:registered}=require('./fixtures/executionPublishHarness.cjs'),f=await registered();t.after(()=>f.close());const phone=await f.phone();f.plugin.beginDrain();
 for(const route of ['/mobile/pairing','/mobile/catalog','/mobile/execution-configs','/sync/push'])await assert.rejects(()=>f.send('/api/plugins/NativeSync'+route,{body:route==='/mobile/execution-configs'?{topics:[]}:{}}),e=>e.code==='HOST_DRAINING');
 const result=await phone('/connection/test',{serverUrl:'https://synthetic.invalid'});assert.equal(result.status,503);assert.equal((await phone('/session')).status,200);assert.equal(f.plugin.drainStatus().quiescing,true);
});
test('PWA execution pages keep bounded views, reject bad pages and do not publish a stale refresh after navigation',async()=>{
 const {pathToFileURL}=require('node:url'),path=require('node:path'),{createExecutionPager}=await import(pathToFileURL(path.resolve(__dirname,'../overlays/VCPToolBox/apps/mobile/src/executionPages.js')));
 const pager=createExecutionPager();let release,wait=false;
 const api=async route=>{const q=new URL(route,'https://synthetic.invalid').searchParams,mode=q.get('mode');if(wait)await new Promise(r=>{const prior=release;release=()=>{prior?.();r();};});const id=q.get('cursor')?'old':'new';return {version:2,topicKey:'topic',mode,executions:[{id,topicKey:'topic'}],total:10001,hasMore:!q.get('cursor'),next:!q.get('cursor')?'page2':null};};
 const first=await pager.refresh(api,'topic');assert.equal(first.rows.length,1);assert.equal(first.total,10001);wait=true;const stale=pager.refresh(api,'topic');await new Promise(r=>setImmediate(r));pager.next('recent');release();assert.equal(await stale,null);wait=false;
 const second=await pager.refresh(api,'topic');assert.equal(second.historyPage,true);assert.ok(second.rows.some(r=>r.id==='old'));assert.ok(second.rows.length<=128);
 await assert.rejects(()=>pager.refresh(async()=>({version:2,topicKey:'wrong',mode:'recent',executions:[],total:0,hasMore:false}),'topic'));
});
test('group quiescing finishes the dispatched step and retains later steps under the same job identity',async t=>{
 const http=require('node:http'),{waitFor,limited,selected,older}=require('./fixtures/boundedSourceHarness.cjs');
 const g={itemType:'group',itemId:'synthetic-group',topicId:'group-topic'},binding={key:'group-run',...wireTopic(g),memberAliases:{one:'synthetic-one',two:'synthetic-one'}};
 const f=await fixture(t,{scope:limited([selected,older,g]),executionBindings:[binding]});await f.owner(g.itemId,{type:'group',topics:[{id:g.topicId}]});await f.history(g,[]);await f.adopt();await f.pump();
 await f.portal.engine.configs.publish({topics:[{...wireTopic(g),expectedVersion:0,config:{group:{name:'Synthetic group',members:['one','two'],mode:'sequential',createdAt:1},agents:['one','two'].map(id=>({id,name:id,systemPrompt:'[[VCPToolUse=Forbidden]]\nSynthetic',model:'synthetic-model'}))}}]});
 let respond,calls=0;const server=http.createServer(async(req,res)=>{for await(const _ of req){}calls++;respond=()=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:'synthetic member reply'}}]}));};});await new Promise(r=>server.listen(0,'127.0.0.1',r));f.cleanups.push(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));});
 f.portal.engine.setEndpoint({url:'http://127.0.0.1:'+server.address().port+'/v1/chat/completions',key:'synthetic-only'});const job=f.portal.engine.accept('synthetic-group-session',{topicKey:'group-run',requestId:'synthetic-group-request',text:'synthetic'});await waitFor(()=>respond,'group first request');f.portal.beginDrain();respond();await waitFor(()=>f.portal.engine.inFlight.size===0,'group step settled');const row=f.portal.engine.get(job.id),steps=f.store.db.prepare('SELECT state,attempts FROM mobile_execution_steps WHERE job_id=? ORDER BY step_index').all(job.id);assert.equal(row.state,'queued');assert.deepEqual(steps.map(s=>s.state),['completed','queued']);assert.equal(steps[1].attempts,0);assert.equal(calls,1);
});
test('shutdown timeout retains uncertain dispatched execution instead of silently retrying it',async t=>{
 const http=require('node:http'),{waitFor}=require('./fixtures/boundedSourceHarness.cjs');const f=await fixture(t,{executionBindings:[{key:'older-run',...wireTopic(older),agentAlias:'synthetic-one'}]});await f.adopt();await f.pump();
 await f.portal.engine.configs.publish({topics:[{...wireTopic(older),expectedVersion:0,config:{name:'Synthetic',systemPrompt:'[[VCPToolUse=Forbidden]]\nSynthetic',model:'synthetic-model'}}]});let reached=false;
 const server=http.createServer(async(req,res)=>{for await(const _ of req){}reached=true;});await new Promise(r=>server.listen(0,'127.0.0.1',r));f.cleanups.push(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));});
 f.portal.engine.setEndpoint({url:'http://127.0.0.1:'+server.address().port+'/v1/chat/completions',key:'synthetic-only'});const job=f.portal.engine.accept('synthetic-timeout',{topicKey:'older-run',requestId:'synthetic-timeout-request',text:'synthetic'});await waitFor(()=>reached,'timeout endpoint reached');await f.portal.engine.close({timeoutMs:15});const row=f.portal.engine.get(job.id);assert.equal(row.state,'review_required');assert.equal(row.attempts,1);assert.equal(f.portal.engine.inFlight.size,0);
});
for(const stage of ['before','after'])test('actual child exit '+stage+' receive checkpoint preserves durable cursor and original event',async t=>{
 const fs=require('node:fs/promises'),path=require('node:path'),{spawnSync}=require('node:child_process');const f=await fixture(t);await f.adopt();await f.pump();const cursor=f.adapter.state.cursor,file=f.adapter.statePath;
 f.store.apply({...wireTopic(older),msgId:'child-receive',deviceId:'synthetic-peer',opId:'child-receive',action:'upsert',baseHash:null,message:message('child-receive')});const input=path.join(f.root,'inbox-crash-input.json');await fs.writeFile(input,JSON.stringify({app:f.app,statePath:file,page:f.store.pull(cursor,100)}));await f.close();
 const child=spawnSync(process.execPath,[path.join(__dirname,'fixtures/inboxCrashChild.cjs'),input,stage],{env:process.env,encoding:'utf8',timeout:10000});assert.equal(child.status,78,child.stderr);const state=JSON.parse(await fs.readFile(file,'utf8'));assert.equal(state.cursor,stage==='after'?cursor+1:cursor);await f.open();await f.adapter.pull();assert.equal((await f.queue.read(older)).filter(m=>m.id==='child-receive').length,1);assert.equal(f.adapter.state.inbox.length,0);assert.equal(f.store.metrics().journalRows,8);
});
test('exact request recovery remains available after session rotation and refuses ambiguous request identity',async t=>{
 const f=await fixture(t,{executionBindings:[{key:'older-run',...wireTopic(older),agentAlias:'synthetic-one'}]});await f.adopt();await f.pump();await f.portal.engine.configs.publish({topics:[{...wireTopic(older),expectedVersion:0,config:{name:'Synthetic',systemPrompt:'Synthetic',model:'synthetic-model'}}]});
 const input={topicKey:'older-run',requestId:'rotated-recovery-request',text:'synthetic'},first=f.portal.engine.accept('original-session',input);const result=f.portal.engine.request('older-run','new-session',input.requestId);assert.equal(result.executions[0].id,first.id);assert.equal(result.executions[0].own,false);assert.equal(result.executions[0].submission,undefined);assert.deepEqual(f.portal.engine.request('original','new-session',input.requestId).executions,[]);
 f.portal.engine.accept('different-session',input);assert.equal(f.portal.engine.request('older-run','new-session',input.requestId).executions.length,2);
});
test('Desktop pagination uses the existing narrow preload query without a new host patch',async()=>{
 const {CHAT}=require('./fixtures/boundedSourceHarness.cjs'),handlers=new Map(),options={mode:'attention',limit:64,cursor:'synthetic-cursor'};
 const service=require(CHAT+'/modules/services/nativeSync/queries').registerNativeSyncQueries({ipcMain:{handle:(name,fn)=>handlers.set(name,fn),removeHandler:name=>handlers.delete(name)},getRuntime:()=>({getExecutionPage:async(d,p)=>{assert.deepEqual(d,selected);assert.deepEqual(p,options);return {version:2,executions:[]};}})});
 const query=require(CHAT+'/preloads/core/registry').loadRegistry().get('getNativeExecutionStatus'),ipc={invoke:async(channel,...args)=>handlers.get(channel)({},...args)},result=await query.entry.build({ipcRenderer:ipc})(selected.itemId,selected.itemType,selected.topicId,options);assert.equal(result.success,true);assert.equal(result.version,2);await service.close();assert.equal(handlers.size,0);
});
