'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),http=require('node:http'),{spawnSync}=require('node:child_process'),{pathToFileURL}=require('node:url');
const {HistoryMutationQueue}=require('../modules/services/historyMutationQueue');
const {NativeSyncAdapter}=require('../modules/services/nativeSync/adapter');
const {durableJson}=require('../modules/services/nativeSync/durableJson');
const {messageHash,messageKey}=require('../modules/services/nativeSync/protocol');
const {startSyncService}=require('./helpers/nativeSyncHttpService.cjs');
const topic={itemId:'batch-agent',itemType:'agent',topicId:'batch-topic'},other={...topic,topicId:'other-topic'};
const msg=(id,role='user',content=id)=>({id,role,content,timestamp:id.charCodeAt(0)});
const intent=(operations,extra={})=>({version:1,source:'native-batch1-test',operations,...extra});
async function fixture(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'native-r21-')),service=await startSyncService({dbPath:path.join(root,'central.sqlite'),token:'synthetic-batch1'}),clients=[];
 async function client(name='A',options={}){
  const directory=path.join(root,name);let queue,adapter,closed=false;
  const value={root:directory,get queue(){return queue;},get adapter(){return adapter;},async open(){queue=new HistoryMutationQueue({userDataDir:path.join(directory,'UserData'),logger:{warn(){}},...(options.commitFault?{commitFault:options.commitFault}:{})});adapter=await NativeSyncAdapter.open({queue,statePath:path.join(directory,'state.json'),deviceId:name,url:service.url,token:'synthetic-batch1',topics:[topic,other],...(options.persist?{persist:options.persist}:{})});closed=false;return value;},async close(){if(!closed){await adapter.close();await queue.dispose();closed=true;}},async reopen(){await value.close();return value.open();},append(message,d=topic,extra={}){return queue.commitMessages(d,intent([{kind:'append',message}],extra));},async edit(id,content,d=topic){const previous=(await queue.read(d)).find(m=>m.id===id);return queue.commitMessages(d,intent([{kind:'edit',id,expected:previous,set:{content},unset:[]}]))}};
  clients.push(value);return value.open();
 }
 t.after(async()=>{for(const c of clients)await c.close();await service.close();await fs.rm(root,{recursive:true,force:true});});
 return {root,service,client};
}
async function renderer(client){
 const {createChatRepository}=await import(pathToFileURL(path.resolve(__dirname,'../modules/chat/chatRepository.js')));
 const {createChatHistoryMutationAuthority}=await import(pathToFileURL(path.resolve(__dirname,'../modules/chat/chatHistoryMutationAuthority.js')));
 const routes=new Map();require('../modules/ipc/nativeHistoryHandlers').initialize({ipcMain:{handle:(name,fn)=>routes.set(name,fn)},historyMutationQueue:client.queue});
 const invoke=(name,...args)=>routes.get(name)({},...args);
 const repository=createChatRepository({getNativeHistorySnapshot:(...args)=>invoke('native-history:snapshot',...args),commitNativeHistoryMessages:(...args)=>invoke('native-history:messages',...args),saveChatHistory:(id,t,h,revision)=>client.queue.replace({itemId:id,itemType:'agent',topicId:t},h,{expectedRevision:revision})});
 return {repository,authority:createChatHistoryMutationAuthority({repository})};
}
test('H01: a derived old array cannot borrow a newer topic revision',async t=>{
 const f=await fixture(t),a=await f.client();await a.append(msg('a'));const {repository,authority}=await renderer(a);
 const original=await repository.getHistory(topic.itemId,'agent',topic.topicId),old=structuredClone(original);
 await a.append(msg('b'));await repository.getHistory(topic.itemId,'agent',topic.topicId);
 await assert.rejects(authority.replace(topic,old),e=>e.code==='HISTORY_REVISION_REQUIRED');
 await assert.rejects(authority.replace({...topic,expectedRevision:repository.revisionOf(original)},old),e=>e.code==='HISTORY_REVISION_CONFLICT');
 assert.deepEqual((await a.queue.read(topic)).map(m=>m.id),['a','b']);
});
test('H02: native message edit preserves an independent addition, but rejects a changed target',async t=>{
 const f=await fixture(t),a=await f.client();await a.append(msg('a'));const {repository,authority}=await renderer(a),before=(await repository.getHistory(topic.itemId,'agent',topic.topicId))[0];
 await a.append(msg('b'));const commit=await authority.edit({...topic,category:'message-edit'},before,{...before,content:'edited'});
 assert.deepEqual(commit.history.map(m=>m.id),['a','b']);
 await assert.rejects(authority.edit(topic,before,{...before,content:'stale'}),e=>e.code==='HISTORY_MESSAGE_CONFLICT');
});
test('a legacy replace response binds only its actual materialized snapshot, never an input with older metadata',async t=>{
 const f=await fixture(t),a=await f.client();await a.append({...msg('checkpoint'),content:'REVISION_BOUND_CHECKPOINT'});await a.adapter.synchronize();const {repository}=await renderer(a);
 const history=await repository.getHistory(topic.itemId,'agent',topic.topicId);history[0].contextCompaction={kind:'vchat-context-checkpoint',version:1,checkpoint:history[0].content};
 const saved=await repository.saveHistory(topic.itemId,'agent',topic.topicId,history);assert.ok(saved.success);assert.notEqual(repository.revisionOf(history),repository.revisionOf(saved.history));
 await repository.getHistory(topic.itemId,'agent',topic.topicId);await assert.rejects(repository.saveHistory(topic.itemId,'agent',topic.topicId,history),e=>e.code==='HISTORY_REVISION_CONFLICT');
});
test('H03: omitted IDs, empty arrays and a missing file never manufacture tombstones',async t=>{
 const f=await fixture(t),a=await f.client();await a.append(msg('a'));await a.append(msg('b'));await a.adapter.synchronize();
 const snapshot=await a.queue.readSnapshot(topic);
 await assert.rejects(a.queue.replace(topic,[snapshot.history[0]],{expectedRevision:snapshot.revision}),e=>e.code==='EXPLICIT_DELETE_REQUIRED');
 await a.adapter.capture(topic,[]);assert.equal(a.adapter.state.outbox.length,0);assert.ok(a.adapter.diagnostics().drift);
 await fs.rename(a.queue.getHistoryPath(topic.itemId,topic.topicId),path.join(a.root,'synthetic-history-backup.json'));await a.adapter.recover();
 assert.equal(a.adapter.state.outbox.filter(op=>op.action==='delete').length,0);assert.equal(f.service.store.metrics().journalRows,2);
});
test('H04/R05/R07: explicit delete retains its operation identity and an ACK replay does not add a tombstone',async t=>{
 const f=await fixture(t),a=await f.client();for(const id of ['a','b','t'])await a.append(msg(id));await a.adapter.synchronize();
 await a.queue.commitMessages(topic,intent([{kind:'delete',ids:['b']}])) ;const op=structuredClone(a.adapter.state.outbox[0]);
 await a.adapter.flush();const rows=f.service.store.metrics().journalRows,result=await a.adapter.request('/api/v1/sync/push',{body:a.adapter.wireOperation(op)});
 assert.equal(result.replayed,true);assert.equal(f.service.store.metrics().journalRows,rows);assert.deepEqual((await a.queue.read(topic)).map(m=>m.id),['a','t']);
 await assert.rejects(a.adapter.request('/api/v1/sync/push',{body:{...a.adapter.wireOperation(op),action:'upsert',message:msg('b')}}),e=>e.status===409&&e.code==='IDEMPOTENCY_KEY_REUSED');
});
test('intent persistence failure fails locally before History changes',async t=>{
 let fail=false;const f=await fixture(t),a=await f.client('A',{persist:async(file,state)=>{if(fail&&Object.keys(state.localCommits).length)throw Object.assign(Error('synthetic disk failure'),{code:'EIO'});await durableJson(file,state);}});
 await a.append(msg('b'));await a.adapter.synchronize();fail=true;
 await assert.rejects(a.queue.commitMessages(topic,intent([{kind:'delete',ids:['b']}])),e=>e.code==='EIO');
 assert.equal((await a.queue.read(topic))[0].id,'b');assert.equal(a.adapter.state.outbox.length,0);
});
for(const phase of ['intent-prepared','history-written'])test('H05/H06: actual subprocess exit at '+phase+' recovers the same delete',async t=>{
 const f=await fixture(t),a=await f.client();await a.append(msg('b'));await a.adapter.synchronize();await a.close();
 const child=spawnSync(process.execPath,[path.join(__dirname,'helpers/nativeSyncBatch1Crash.cjs'),a.root,phase,f.service.url],{env:process.env,encoding:'utf8',timeout:10000});assert.equal(child.status,phase==='intent-prepared'?71:72,child.stderr);
 const state=JSON.parse(await fs.readFile(path.join(a.root,'state.json'))),record=Object.values(state.localCommits)[0],opId=record.operations[0].opId;
 await a.open();
 if(phase==='intent-prepared'){
  assert.equal((await a.queue.read(topic)).length,1);assert.equal(a.adapter.state.outbox.length,0);
  await assert.rejects(a.append(msg('c')),e=>e.code==='LOCAL_COMMIT_NOT_COMMITTED');
  await a.append(msg('z'),other);await a.adapter.retryLocalCommit(topic,record.id);
 }else assert.equal((await a.queue.read(topic)).length,0);
 assert.ok(a.adapter.state.outbox.some(op=>op.opId===opId));await a.adapter.flush();
 const applied=f.service.store.db.prepare('SELECT result_json FROM applied_ops WHERE op_id=?').get(opId);assert.ok(applied);
 const event=f.service.store.db.prepare('SELECT msg_id,action FROM journal WHERE seq=?').get(JSON.parse(applied.result_json).seq);assert.equal(event.msg_id,'b');assert.equal(event.action,'delete');
 assert.equal(f.service.store.db.prepare("SELECT count(*) AS n FROM journal WHERE action='delete'").get().n,1);
 assert.equal(f.service.store.db.prepare('SELECT count(*) AS n FROM messages WHERE deleted=1').get().n,1);assert.equal(a.adapter.state.localCommits[JSON.stringify({ownerId:topic.itemId,ownerType:'agent',topicId:topic.topicId})],undefined);
});
test('H06: live confirmation failure reports saved/pending, recovers before a later write, and preserves the first op',async t=>{
 let fail=false;const f=await fixture(t),a=await f.client('A',{persist:async(file,state)=>{if(fail&&!Object.keys(state.localCommits).length&&Object.values(state.receipts).some(r=>r.source==='delete-live')){fail=false;throw Object.assign(Error('synthetic confirmation gap'),{code:'EIO'});}await durableJson(file,state);}});
 await a.append(msg('b'));await a.adapter.synchronize();fail=true;
 const result=await a.queue.commitMessages(topic,intent([{kind:'delete',ids:['b']}],{source:'delete-live'}));assert.equal(result.localState,'saved');assert.equal(result.sync.state,'degraded');
 const pending=Object.values(a.adapter.state.localCommits)[0],opId=pending.operations[0].opId;await a.append(msg('z'),other);await a.append(msg('c'));
 assert.equal(a.adapter.state.outbox.filter(op=>op.opId===opId).length,1);await a.adapter.synchronize();assert.equal(f.service.store.db.prepare('SELECT count(*) AS n FROM messages WHERE deleted=1').get().n,1);
});
test('H07: an unmatched native revision retains the prepared intent and blocks only its topic',async t=>{
 const f=await fixture(t),a=await f.client();await a.append(msg('b'));await a.adapter.synchronize();await a.close();
 const child=spawnSync(process.execPath,[path.join(__dirname,'helpers/nativeSyncBatch1Crash.cjs'),a.root,'intent-prepared',f.service.url],{env:process.env,encoding:'utf8',timeout:10000});assert.equal(child.status,71);
 await fs.writeFile(path.join(a.root,'UserData',topic.itemId,'topics',topic.topicId,'history.json'),JSON.stringify([msg('unknown')]));await a.open();
 assert.equal(Object.values(a.adapter.state.localCommits)[0].stage,'conflicted');await assert.rejects(a.append(msg('c')),e=>e.code==='LOCAL_COMMIT_HISTORY_CONFLICT');await a.append(msg('z'),other);assert.equal(a.adapter.state.outbox.length,1);
});
test('R01: real HTTP 409 isolates one message and its cross-ID reply, while independent edits and topics continue',async t=>{
 const f=await fixture(t),a=await f.client();await a.append(msg('a'));await a.append(msg('b'));await a.adapter.synchronize();
 const before=(await a.queue.read(topic)).find(m=>m.id==='a');f.service.store.apply({ownerType:'agent',ownerId:topic.itemId,topicId:topic.topicId,msgId:'a',deviceId:'remote',opId:'remote-edit',action:'upsert',baseHash:messageHash(before),message:{...before,_nativeSyncMetadata:undefined,content:'remote'}});
 await a.edit('a','local-1');await a.edit('a','local-2');await a.append({...msg('reply','assistant'),replyToMessageId:'a'});await a.edit('b','independent');await a.append(msg('z'),other);
 const original=a.adapter.state.outbox.slice(0,3).map(op=>a.adapter.wireOperation(op));await a.adapter.synchronize();
 assert.equal(a.adapter.state.outbox.length,3);assert.equal(a.adapter.state.outbox[0].error.code,'MESSAGE_CONFLICT');assert.equal(a.adapter.state.outbox[0].error.status,409);assert.deepEqual(a.adapter.state.outbox.map(op=>a.adapter.wireOperation(op)),original);
 const events=f.service.store.pull(0).events;assert.ok(events.some(e=>e.msgId==='b'&&e.message.content==='independent'));assert.ok(events.some(e=>e.msgId==='z'));assert.equal(events.some(e=>e.msgId==='reply'),false);
});
test('R03/R04: durable receive cursor can pass a held parent, but dependent replies resume in order after ACK reconciliation',async t=>{
 const f=await fixture(t),a=await f.client('A'),b=await f.client('B');const parent=msg('u');await b.append(parent);
 await a.append(parent);await a.append({...msg('reply-1','assistant'),replyToMessageId:'u'});await a.append({...msg('reply-2','assistant'),replyToMessageId:'reply-1'});await a.append(msg('independent'));await a.adapter.flush();
 await b.adapter.pull();assert.equal(b.adapter.state.cursor,4);assert.equal(b.adapter.state.inbox.length,3);assert.ok((await b.queue.read(topic)).some(m=>m.id==='independent'));assert.equal((await b.queue.read(topic)).some(m=>m.id==='reply-2'),false);
 const opId=b.adapter.state.outbox[0].opId;await b.reopen();assert.equal(b.adapter.state.inbox.length,3);assert.equal(b.adapter.state.outbox[0].opId,opId);
 await b.adapter.synchronize();const ids=(await b.queue.read(topic)).map(m=>m.id);assert.ok(ids.indexOf('reply-1')<ids.indexOf('reply-2'));assert.equal(b.adapter.state.inbox.length,0);assert.equal(f.service.store.metrics().journalRows,4);
});
for(const durable of [false,true])test('R04: receive staging failure '+(durable?'after durable rename':'before disk write')+' never loses a fact',async t=>{
 let armed=false;const f=await fixture(t),a=await f.client('A'),b=await f.client('B',{persist:async(file,state)=>{if(armed&&state.inbox.length&&!state.pending){armed=false;if(durable)await durableJson(file,state);throw Object.assign(Error('synthetic receive crash'),{code:'EIO'});}await durableJson(file,state);}});
 await a.append(msg('a'));await a.adapter.flush();armed=true;await assert.rejects(b.adapter.pull(),e=>e.code==='EIO');assert.equal(b.adapter.state.cursor,durable?1:0);assert.equal((await b.queue.read(topic)).length,0);
 await b.reopen();await b.adapter.synchronize();assert.equal((await b.queue.read(topic)).length,1);assert.equal(b.adapter.state.outbox.length,0);assert.equal(f.service.store.metrics().journalRows,1);
});
test('R02: the actual runtime transport retains status and safe error codes without provider body text',async t=>{
 const {createSyncRequest}=require('../modules/services/nativeSync/runtime');
 const server=http.createServer((req,res)=>{const status=Number(req.url.slice(1));res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify({error:{code:status===409?'MESSAGE_CONFLICT':status===401?'UNAUTHORIZED':'PROTOCOL_UPGRADE_REQUIRED',message:'SYNTHETIC_BODY_NOT_FOR_DIAGNOSTICS'}}));});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const request=createSyncRequest({url:'http://127.0.0.1:'+server.address().port,token:'synthetic'},1000);
 for(const status of [409,401,429,503])await assert.rejects(request('/'+status),e=>e.status===status&&e.message===e.code&&!JSON.stringify(e).includes('SYNTHETIC_BODY'));
});
test('H08/H09: real native Terminal preserves an independent message and owned metadata; explicit deletion fences late completion',async t=>{
 const f=await fixture(t),a=await f.client('A'),b=await f.client('B');
 await a.append({...msg('u'),timestamp:1});await a.append({...msg('terminal','assistant'),timestamp:2,rating:'keep-local',replyToMessageId:'u',streamOperationId:'native-request-1'});await a.adapter.flush();
 await b.append({...msg('remote'),timestamp:3});await b.adapter.flush();await a.adapter.pull();
 const routes=new Map();require('../modules/ipc/nativeHistoryHandlers').initialize({ipcMain:{handle:(key,fn)=>routes.set(key,fn)},historyMutationQueue:a.queue});
 const projected={messageId:'terminal',context:{agentId:topic.itemId,topicId:topic.topicId,requestId:'native-request-1'},history:[{...msg('u'),timestamp:1},{...msg('terminal','assistant','completed'),timestamp:2,rating:'stale',finishReason:'stop',streamOperationId:'native-request-1'}]};
 const done=await routes.get('native-history:terminal')({},projected);assert.equal(done.success,true);assert.equal(done.history.find(m=>m.id==='terminal').rating,'keep-local');assert.ok(done.history.some(m=>m.id==='remote'));
 await a.queue.commitMessages(topic,intent([{kind:'delete',ids:['terminal']}]));const late=await routes.get('native-history:terminal')({},projected);assert.equal(late.success,false);assert.equal(late.error,'TERMINAL_MESSAGE_DELETED');assert.equal((await a.queue.read(topic)).some(m=>m.id==='terminal'),false);
});
for(const afterDisk of [false,true])test('R06: ACK persistence failure '+(afterDisk?'after rename':'before write')+' keeps the same operation and one Journal fact',async t=>{
 let armed=false;const f=await fixture(t),a=await f.client('A',{persist:async(file,state)=>{if(armed&&!state.outbox.length&&Object.values(state.receipts).some(r=>r.state==='synced')){armed=false;if(afterDisk)await durableJson(file,state);throw Object.assign(Error('synthetic ACK state failure'),{code:'EIO'});}await durableJson(file,state);}});
 await a.append(msg('a'));const opId=a.adapter.state.outbox[0].opId,commitId=a.adapter.state.outbox[0].commitId;armed=true;await assert.rejects(a.adapter.flush(),e=>e.code==='EIO');
 if(a.adapter.state.outbox.length)assert.equal(a.adapter.state.outbox[0].opId,opId);await a.reopen();await a.adapter.flush();assert.equal(a.adapter.state.receipts[commitId].state,'synced');assert.equal(f.service.store.metrics().journalRows,1);
});
test('approved first import has a durable explicit plan; matched controls materialize without skipping older Journal facts',async t=>{
 const f=await fixture(t),root=path.join(f.root,'import'),queue=new HistoryMutationQueue({userDataDir:path.join(root,'UserData'),logger:{warn(){}}}),original={...msg('checkpoint'),content:'BATCH1_CHECKPOINT'},remote={...original,contextCompaction:{kind:'vchat-context-checkpoint',version:1,checkpoint:original.content}};
 const metadata=require('../modules/services/nativeSync/metadata').envelopeFor(remote,1);
 f.service.store.apply({ownerType:'agent',ownerId:topic.itemId,topicId:topic.topicId,msgId:original.id,deviceId:'cloud',opId:'accepted-checkpoint',action:'upsert',baseHash:null,message:remote,metadata},{metadataPublisher:true});
 const history=[original,msg('local')],file=queue.getHistoryPath(topic.itemId,topic.topicId);await fs.mkdir(path.dirname(file),{recursive:true});const bytes=Buffer.from(JSON.stringify(history));await fs.writeFile(file,bytes);
 const crypto=require('node:crypto'),connection={topics:[topic],approvedHistory:[{...topic,rawFileSha256:crypto.createHash('sha256').update(bytes).digest('hex')}]};const request=require('../modules/services/nativeSync/runtime').createSyncRequest({url:f.service.url,token:'synthetic-batch1'});
 const proof=await require('../modules/services/nativeSync/initialImport').initialImport({queue,appDataRoot:root,connection,request:route=>request(route)});assert.equal(JSON.stringify(proof).includes('BATCH1_CHECKPOINT'),false);
 const options={queue,statePath:path.join(root,'.native-sync/state.json'),deviceId:'import',url:f.service.url,token:'synthetic-batch1',topics:[topic],bootstrap:proof.bootstrap},adapter=await NativeSyncAdapter.open(options);t.after(async()=>{await adapter.close();await queue.dispose();});
 assert.equal(adapter.state.cursor,0);assert.equal((await queue.read(topic))[0].contextCompaction.checkpoint,original.content);await adapter.synchronize();assert.equal(adapter.state.outbox.length,0);assert.equal(f.service.store.metrics().liveMessages,2);assert.equal(adapter.state.initialImport,undefined);
});
test('v1 migration preserves old payloads and backup and quarantines unproven deletes',async t=>{
 const f=await fixture(t),root=path.join(f.root,'upgrade'),queue=new HistoryMutationQueue({userDataDir:path.join(root,'UserData'),logger:{warn(){}}}),file=path.join(root,'state.json');
 const op={ownerType:'agent',ownerId:topic.itemId,topicId:topic.topicId,msgId:'b',deviceId:'upgrade',opId:'legacy-delete',action:'delete',baseHash:'a'.repeat(64),message:null},old={version:1,deviceId:'upgrade',topics:[topic,other],cursor:0,acked:{},outbox:[op],pending:null};await durableJson(file,old);
 const options={queue,statePath:file,deviceId:'upgrade',url:f.service.url,token:'synthetic-batch1',topics:[topic,other]},adapter=await NativeSyncAdapter.open(options);t.after(async()=>{await adapter.close();await queue.dispose();});
 assert.equal(adapter.state.version,3);assert.deepEqual(JSON.parse(await fs.readFile(adapter.state.migration.backup)),old);assert.equal(adapter.state.outbox[0].opId,op.opId);assert.equal(adapter.state.outbox[0].status,'legacy-unverified');await adapter.flush();assert.equal(f.service.store.metrics().journalRows,0);

});
test('known request/execution dependency also fences another Topic; a distinct native execution stays independent',async t=>{
 const f=await fixture(t),a=await f.client();await a.append({...msg('u'),executionId:'original-native-execution'});await a.adapter.flush();
 const current=(await a.queue.read(topic))[0];f.service.store.apply({ownerType:'agent',ownerId:topic.itemId,topicId:topic.topicId,msgId:'u',deviceId:'cloud',opId:'cloud-change',action:'upsert',baseHash:messageHash(current),message:{...current,_nativeSyncMetadata:undefined,content:'changed remotely'}});
 await a.edit('u','pending conflicting input');await a.append({...msg('dependent','assistant'),executionId:'original-native-execution'},other);await a.append({...msg('independent'),executionId:'different-native-execution'},other);
 await a.adapter.flush();assert.equal(a.adapter.state.outbox.length,2);assert.ok(f.service.store.pull(0).events.some(e=>e.msgId==='independent'));assert.equal(f.service.store.pull(0).events.some(e=>e.msgId==='dependent'),false);
});
test('the unchanged audited baseline reader rejects v3 before installing an observer or scanning History',async t=>{
 if(!process.env.VCP_R21_LEGACY_ADAPTER){t.skip('Supply the fixed audited baseline adapter source for downgrade verification');return;}
 const f=await fixture(t),a=await f.client();await a.append(msg('a'));await a.close();
 const queue=new HistoryMutationQueue({userDataDir:path.join(a.root,'UserData'),logger:{warn(){}}});t.after(()=>queue.dispose());
 const Legacy=require(process.env.VCP_R21_LEGACY_ADAPTER).NativeSyncAdapter;
 await assert.rejects(Legacy.open({queue,statePath:path.join(a.root,'state.json'),deviceId:'A',url:f.service.url,token:'synthetic-batch1',topics:[topic,other]}),e=>e.code==='INVALID_SYNC_STATE');assert.equal(queue.syncPolicy.isRecoveryFence,true);
});
test('R14: closing the Bridge keeps the static shared write fence; unrelated native history stays writable',async t=>{
 const f=await fixture(t),a=await f.client();await a.append(msg('a'));await a.adapter.close();
 const boundary=require('../modules/services/syncWriterBoundary').createSyncWriterBoundary(a.queue);assert.throws(()=>boundary.assertWrite({ownerType:'agent',ownerId:topic.itemId,topicId:topic.topicId}),e=>e.code==='SYNC_WRITER_EXCLUDED');
 await assert.rejects(a.append(msg('b')),e=>e.code==='SYNC_BRIDGE_CLOSED');const control={...topic,topicId:'unshared-control'};await a.queue.mutate(control,()=>[msg('control')]);assert.equal((await a.queue.read(control)).length,1);
});
test('R14: unsupported state cannot create an initialization window for the other shared writer',async t=>{
 const f=await fixture(t),a=await f.client();await a.append(msg('a'));await a.close();const file=path.join(a.root,'state.json'),state=JSON.parse(await fs.readFile(file));state.version=4;await durableJson(file,state);
 const queue=new HistoryMutationQueue({userDataDir:path.join(a.root,'UserData'),logger:{warn(){}}});t.after(()=>queue.dispose());
 await assert.rejects(NativeSyncAdapter.open({queue,statePath:file,deviceId:'A',url:f.service.url,token:'synthetic-batch1',topics:[topic,other]}),e=>e.code==='INVALID_SYNC_STATE');
 assert.throws(()=>require('../modules/services/syncWriterBoundary').createSyncWriterBoundary(queue).assertWrite({ownerType:'agent',ownerId:topic.itemId,topicId:topic.topicId}),e=>e.code==='SYNC_WRITER_EXCLUDED');
 await assert.rejects(queue.commitMessages(topic,intent([{kind:'append',message:msg('b')}])),e=>e.code==='INVALID_SYNC_STATE');assert.equal((await queue.read(topic))[0].id,'a');
});
