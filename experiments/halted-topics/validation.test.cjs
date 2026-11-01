'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),{spawnSync}=require('node:child_process');
const {Server,Client,CAPABILITY,keyOf,hash}=require('./prototype.cjs');
const product=process.env.HALTED_EXPERIMENT_PRODUCT,output=process.env.HALTED_EXPERIMENT_ROOT;
if(!product||!output)throw Error('EXPERIMENT_PATHS_REQUIRED');
const A=JSON.stringify(['agent','synthetic-a','topic']),B=JSON.stringify(['group','synthetic-b','topic']),C=JSON.stringify(['agent','foreign','topic']),allowed=[A,B];
let number=0;const observations=[];
const code=name=>e=>e.code===name;
function fixture(t){
 const root=path.join(output,'case-'+String(++number).padStart(2,'0'));fs.mkdirSync(root,{recursive:true});
 const f={root,serverFile:root+'/server.sqlite',clientFile:root+'/client.sqlite',product,allowed};f.server=new Server(f.serverFile,product);f.client=new Client(f.clientFile,allowed);
 t.after(()=>{f.client?.close();f.server.close();});
 let lastA,lastB;
 function up(topic,id,text,prior){const [ownerType,ownerId,topicId]=JSON.parse(topic);return {ownerType,ownerId,topicId,msgId:id,deviceId:'synthetic-source',opId:'op-'+(f.server.head()+1),action:'upsert',baseHash:prior?.hash??null,message:{id,role:'user',content:text,timestamp:f.server.head()+1}};}
 f.op=up;lastA=f.server.push(up(A,'message-a','v1'));lastB=f.server.push(up(B,'message-b','healthy-1'));
 lastA=f.server.push(up(A,'message-a','v2',lastA));lastB=f.server.push(up(B,'message-b','healthy-2',lastB));
 const [ownerType,ownerId,topicId]=JSON.parse(A);lastA=f.server.push({ownerType,ownerId,topicId,msgId:'message-a',deviceId:'synthetic-source',opId:'delete-a',action:'delete',baseHash:lastA.hash});
 lastB=f.server.push(up(B,'message-b','healthy-3',lastB));
 f.lastA=lastA;f.lastB=lastB;f.backup=f.server.backup(A);f.server.trustCurrentBackup(f.backup);f.backupFile=root+'/trusted-backup.json';fs.writeFileSync(f.backupFile,JSON.stringify(f.backup));
 f.poison=(seq=1)=>{const row=f.server.db.prepare('SELECT message_json FROM journal WHERE seq=?').get(seq);const m=JSON.parse(row.message_json);m.content='SYNTHETIC_CORRUPTION';f.server.db.prepare('UPDATE journal SET message_json=? WHERE seq=?').run(JSON.stringify(m),seq);};
 f.global=(limit=128)=>{const frame=f.server.pull(f.client.cursor(),limit,allowed);f.client.global(frame);return frame;};
 f.recover=(limit=1)=>{let guard=0;while(f.client.map(A)?.state!=='complete'){assert(++guard<30);const m=f.client.map(A);f.client.recovered(f.server.catchup(A,m.generation,m.cursor,f.client.cursor(),limit,allowed));}};
 return f;
}
function record(name,data){observations.push({name,...data});fs.writeFileSync(path.join(output,'observations.json'),JSON.stringify(observations,null,2)+'\n');}
function worker(f,action,crashAt,extra={}){
 const file=f.root+'/worker-'+action+'-'+crashAt+'.json';fs.writeFileSync(file,JSON.stringify({serverFile:f.serverFile,clientFile:f.clientFile,product,allowed,action,crashAt,topic:A,generation:1,backupFile:f.backupFile,...extra}));
 const p=spawnSync(process.execPath,[path.join(__dirname,'worker.cjs'),file],{encoding:'utf8',timeout:10000});assert.equal(p.status,86,p.stderr);return p;
}
function current(client,topic=A){return client.snapshot().messages.find(m=>m.topic===topic);}

test('known corruption holds the whole topic, advances healthy data, persists explicit incompleteness and blocks new writes',t=>{
 const f=fixture(t);f.poison();const frame=f.global();assert.equal(frame.events.length,3);assert(frame.events.every(e=>keyOf(e)===B));assert.equal(f.client.cursor(),6);assert.equal(current(f.client),undefined);assert.equal(JSON.parse(current(f.client,B).message_json).content,'healthy-3');assert.equal(f.client.status().complete,false);assert.deepEqual(f.client.status().haltedTopics,[A]);
 assert.throws(()=>f.server.push(f.op(A,'new-message','do not dispatch')),code('TOPIC_HALTED'));assert.throws(()=>f.server.catchup(A,1,0,6,1,allowed),code('TOPIC_STILL_HALTED'));
 assert.throws(()=>f.server.store.apply(f.op(A,'unguarded-path','still blocked by transaction')),/EXPERIMENT_TOPIC_HALTED/);assert.equal(f.server.head(),6);
 f.client.close();f.client=new Client(f.clientFile,allowed);assert.equal(f.client.map(A).cursor,0);assert.equal(f.client.status().complete,false);
 record('whole-topic-visibility',{globalCursor:6,heldTopicCursor:0,healthyAdvanced:true,complete:false,writesRejected:true});
});

test('repair restores original bytes and original seq; ordered catch-up preserves edits, deletion and concurrent handoff',t=>{
 const f=fixture(t);f.poison();f.global();const head=f.server.head(),receipts=f.server.db.prepare('SELECT * FROM applied_ops ORDER BY rowid').all();f.server.repair(A,1,f.backup);assert.equal(f.server.head(),head);assert.deepEqual(f.server.backup(A),f.backup);assert.deepEqual(f.server.db.prepare('SELECT * FROM applied_ops ORDER BY rowid').all(),receipts);
 f.global();const first=f.server.catchup(A,1,0,6,1,allowed);f.client.recovered(first);assert.equal(JSON.parse(current(f.client).message_json).content,'v1');
 const stale=f.server.catchup(A,1,f.client.map(A).cursor,6,1,allowed),newOp=f.op(A,'message-a','v3',f.lastA),accepted=f.server.push(newOp);assert.equal(accepted.seq,7);f.global();assert.equal(f.client.cursor(),7);assert.throws(()=>f.client.recovered(stale),code('CATCHUP_CURSOR_RACE'));f.recover();assert.equal(JSON.parse(current(f.client).message_json).content,'v3');assert.equal(f.client.status().complete,true);assert.equal(f.server.push(newOp).seq,7);assert.equal(f.server.head(),7);
 record('repair-order-and-handoff',{originalSeqsPreserved:true,oldReceiptBytesPreserved:true,catchupCrossedV1V2DeleteV3:true,globalCursor:7,requestReplaySameSeq:true});
});

test('late discovery behind an advanced cursor never resurrects a deleted message; completed generation receipts survive reopen',t=>{
 const f=fixture(t);f.global();assert.equal(current(f.client).deleted,1);f.poison();f.server.pull(0,128,allowed);f.global();assert.equal(f.client.map(A).cursor,0);f.server.repair(A,1,f.backup);f.global();
 while(f.client.map(A).state!=='complete'){const m=f.client.map(A);f.client.recovered(f.server.catchup(A,1,m.cursor,f.client.cursor(),1,allowed));assert.equal(current(f.client).deleted,1);assert.equal(current(f.client).seq,5);}
 f.client.close();f.client=new Client(f.clientFile,allowed);f.global();assert.equal(f.client.map(A).state,'complete');assert.equal(f.client.status().complete,true);
 f.poison();f.server.pull(0,128,allowed);f.global();assert.equal(f.client.map(A).generation,2);assert.equal(f.client.map(A).state,'halted');assert.equal(f.client.map(A).cursor,0);assert.throws(()=>f.server.catchup(A,1,0,6,128,allowed),code('HALT_GENERATION_CHANGED'));f.server.repair(A,2,f.backup);f.global();f.recover();assert.equal(current(f.client).deleted,1);
 record('late-discovery-aba',{newGeneration:2,noTransientRollback:true,deleteRetained:true,completedReceiptRetainedAcrossRestart:true});
});

test('negative controls: a bare cursor map can forget a repaired gap, and unguarded old-row replay rolls a newer projection back',t=>{
 const f=fixture(t);f.poison();const frame=f.server.pull(0,128,allowed);const naive={globalCursor:frame.nextSeq,haltedTopicCursors:{[A]:0},messages:frame.events};
 f.server.repair(A,1,f.backup);
 // Naive server drops the halt after repair; naive client replaces its map.
 const next={...f.server.pull(6,128,allowed),haltedTopics:[]};naive.haltedTopicCursors=Object.fromEntries(next.haltedTopics.map(x=>[x.topic,0]));assert.equal(Object.keys(naive.haltedTopicCursors).length,0);assert(!naive.messages.some(e=>keyOf(e)===A));
 let naiveMessage='v2';naiveMessage=JSON.parse(f.backup.journal[0].message_json).content;assert.equal(naiveMessage,'v1');
 record('minimal-scheme-counterexamples',{lostGapAfterServerClearsFlag:true,unguardedReplayV2ToV1:true,onlyTwoBareNumbersInsufficient:true});
});

test('client global cursor, halted map and materialization commit atomically under actual child exits',t=>{
 for(const point of ['client-before-commit','client-after-commit']){
  const f=fixture(t);f.poison();const frame=f.server.pull(0,128,allowed),file=f.root+'/frame.json';fs.writeFileSync(file,JSON.stringify(frame));f.client.close();f.client=null;worker(f,'global',point,{frameFile:file});f.client=new Client(f.clientFile,allowed);
  if(point==='client-before-commit'){assert.equal(f.client.cursor(),0);assert.equal(f.client.holds().length,0);assert.equal(f.client.snapshot().messages.length,0);f.client.global(frame);}else{assert.equal(f.client.cursor(),6);assert.equal(f.client.map(A).cursor,0);assert(current(f.client,B));}
  assert.equal(f.client.status().complete,false);
 }
 record('client-atomic-restart',{beforeCommit:'old cursor and no partial map/materialization',afterCommit:'global and halt map durable together',physicalPowerLossTested:false});
});

test('catch-up message and topic watermark commit atomically under actual child exits',t=>{
 for(const point of ['client-before-commit','client-after-commit']){
  const f=fixture(t);f.poison();f.global();f.server.repair(A,1,f.backup);f.global();const frame=f.server.catchup(A,1,0,6,1,allowed),file=f.root+'/catchup.json';fs.writeFileSync(file,JSON.stringify(frame));f.client.close();f.client=null;worker(f,'catchup',point,{frameFile:file});f.client=new Client(f.clientFile,allowed);
  if(point==='client-before-commit'){assert.equal(f.client.map(A).cursor,0);assert.equal(current(f.client),undefined);}else{assert.equal(f.client.map(A).cursor,1);assert.equal(current(f.client).seq,1);}
  f.recover();assert.equal(current(f.client).deleted,1);assert.equal(f.client.status().complete,true);
 }
 record('catchup-atomic-restart',{noCursorAheadOfMaterializedMessage:true,catchupReplayDeduplicated:true});
});

test('server halt registration and in-place repair/release are each durable transactions across real process exits',t=>{
 for(const point of ['halt-before-commit','halt-after-commit']){
  const f=fixture(t);f.poison();worker(f,'pull',point,{cursor:0,limit:128});assert.equal(f.server.halts(allowed).length,point==='halt-before-commit'?0:1);const frame=f.global();assert.equal(frame.haltedTopics[0].generation,1);
 }
 for(const point of ['repair-before-commit','repair-after-commit']){
  const f=fixture(t);f.poison();f.global();worker(f,'repair',point);
  if(point==='repair-before-commit'){assert.equal(f.server.halts(allowed)[0].status,'halted');assert.throws(()=>f.server.verifyTopic(A),code('SYNC_STORAGE_CORRUPT'));f.server.repair(A,1,f.backup);}else{assert.equal(f.server.halts(allowed)[0].status,'repaired');f.server.verifyTopic(A);}
  assert.equal(f.server.head(),6);f.global();f.recover();assert.equal(current(f.client).deleted,1);
 }
 record('server-transaction-restart',{haltBeforeAfterCommit:true,repairBeforeAfterCommit:true,originalJournalHead:6,releaseCannotPrecedeRepairCommit:true});
});

test('new HTTP response loss reuses durable halt generation and catch-up page, while legacy route explicitly fails closed',async t=>{
 const f=fixture(t);f.poison();let dropPull=true,dropCatchup=true;
 const httpServer=http.createServer(async(req,res)=>{
  try{let raw='';for await(const chunk of req)raw+=chunk;const body=raw?JSON.parse(raw):{},url=new URL(req.url,'http://localhost');let result;
   if(url.pathname==='/pull'){result=f.server.pull(body.cursor,128,allowed,req.headers['x-experiment-capability']);if(dropPull){dropPull=false;return res.destroy();}}
   else if(url.pathname==='/catchup'){result=f.server.catchup(body.topic,body.generation,body.cursor,body.through,1,allowed);if(dropCatchup){dropCatchup=false;return res.destroy();}}
   else result=f.server.legacyPull(Number(url.searchParams.get('after')||0),128,allowed);
   res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(result));
  }catch(e){res.writeHead(e.status||500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:{code:e.code||'EXPERIMENT_ERROR'}}));}
 });await new Promise(r=>httpServer.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>httpServer.close(r)));const origin='http://127.0.0.1:'+httpServer.address().port;
 const post=(route,body)=>fetch(origin+route,{method:'POST',headers:{'Content-Type':'application/json','X-Experiment-Capability':CAPABILITY},body:JSON.stringify(body)});
 await assert.rejects(post('/pull',{cursor:0}));assert.equal(f.client.cursor(),0);f.client.global(await(await post('/pull',{cursor:0})).json());assert.equal(f.client.map(A).generation,1);
 const old=await fetch(origin+'/legacy?after=6');assert.equal(old.status,409);assert.equal((await old.json()).error.code,'HALTED_TOPICS_PROTOCOL_REQUIRED');
 f.server.repair(A,1,f.backup);f.global();const request={topic:A,generation:1,cursor:0,through:6};await assert.rejects(post('/catchup',request));assert.equal(f.client.map(A).cursor,0);f.client.recovered(await(await post('/catchup',request)).json());f.recover();assert.equal(f.server.head(),6);
 record('http-response-loss',{serverGenerationStable:true,catchupOriginalSeqReused:true,legacyExplicit409:true});
});

test('actual old pull validator accepts an unknown halt field and gaps: capability routing is necessary',t=>{
 const f=fixture(t);f.poison();const frame=f.server.pull(0,128,allowed),{validatePullPage}=require(path.join(product,'VCPChat/modules/services/nativeSync/adapter'));
 assert.doesNotThrow(()=>validatePullPage(frame,0,128));assert.equal(frame.nextSeq,6);assert(frame.events.every(e=>keyOf(e)!==A));
 assert.throws(()=>f.server.pull(0,128,allowed,'old-v2'),code('HALTED_TOPICS_PROTOCOL_REQUIRED'));
 record('real-old-validator-negative-control',{unknownFieldSilentlyAccepted:true,gappedNextSeqAccepted:true,mustNegotiateNewCapability:true});
});

test('authorization isolates both hold metadata and catch-up, with no disclosure from foreign corruption',t=>{
 const f=fixture(t);f.poison();f.server.pull(0,128,allowed);const scoped=f.server.pull(0,128,[B]);assert.equal(scoped.haltedTopics.length,0);assert.equal(scoped.events.length,3);assert.equal(scoped.nextSeq,6);assert(!JSON.stringify(scoped).includes('synthetic-a'));assert.throws(()=>f.server.catchup(A,1,0,6,128,[B]),code('TOPIC_NOT_ALLOWED'));assert.equal(f.server.legacyPull(0,128,[B]).events.length,3);
 const bad=f.server.db.prepare('SELECT * FROM journal WHERE seq=1').get();f.server.db.prepare('UPDATE journal SET owner_id=? WHERE seq=1').run('../unclassifiable');assert.throws(()=>f.server.pull(0,128,allowed),code('UNCLASSIFIABLE_STORAGE_CORRUPTION'));f.server.db.prepare('UPDATE journal SET owner_id=? WHERE seq=1').run(bad.owner_id);
 record('scope-and-unknown-routing',{foreignHaltMetadataNotExposed:true,crossScopeCatchupDenied:true,unknownOwnershipFailsGlobally:true});
});

test('only pre-fault trusted exact bytes may repair; journal/projection mismatch and malformed pages cannot clear holds',t=>{
 const f=fixture(t);f.poison();f.global();const forged=structuredClone(f.backup);forged.journal[0].message_json=JSON.stringify({...JSON.parse(forged.journal[0].message_json),content:'invented bytes'});forged.digest=hash({topic:A,journal:forged.journal,messages:forged.messages});assert.throws(()=>f.server.repair(A,1,forged),code('UNTRUSTED_REPAIR_SOURCE'));assert.equal(f.server.halts(allowed)[0].status,'halted');
 f.server.repair(A,1,f.backup);f.global();const frame=f.server.catchup(A,1,0,6,1,allowed),before=f.client.snapshot();assert.throws(()=>f.client.recovered({...frame,events:[{...frame.events[0],ownerId:'foreign'}]}),code('INVALID_CATCHUP_PAGE'));assert.deepEqual(f.client.snapshot(),before);
 f.server.db.prepare('UPDATE messages SET last_seq=3 WHERE owner_id=?').run('synthetic-a');assert.throws(()=>f.server.catchup(A,1,0,6,1,allowed),code('TOPIC_PROJECTION_INCONSISTENT'));assert.equal(f.client.map(A).state,'recovering');
 record('repair-and-completeness-proof',{selfDeclaredBackupDigestRejected:true,projectionMismatchCannotCompleteCatchup:true,malformedPageAtomicRejection:true});
});

test('two independent clients retain their own recovery floor and stale global responses cannot move either cursor',t=>{
 const f=fixture(t),other=new Client(f.root+'/second-client.sqlite',allowed);t.after(()=>other.close());f.client.global(f.server.pull(0,2,allowed));assert.equal(f.client.cursor(),2);f.poison(3);const frame=f.server.pull(0,128,allowed);other.global(frame);f.global();assert.equal(other.map(A).cursor,0);assert.equal(f.client.map(A).cursor,2);
 const before=f.client.snapshot();assert.throws(()=>f.client.global(frame),code('GLOBAL_CURSOR_RACE'));assert.deepEqual(f.client.snapshot(),before);f.server.repair(A,1,f.backup);f.global();f.recover();other.global(f.server.pull(other.cursor(),128,allowed));while(other.map(A).state!=='complete'){const m=other.map(A);other.recovered(f.server.catchup(A,1,m.cursor,other.cursor(),1,allowed));}assert.equal(current(f.client).deleted,1);assert.equal(current(other).deleted,1);
 record('independent-device-watermarks',{firstFloor:2,secondFloor:0,staleGlobalResponseRejected:true,bothReachOriginalDelete:true});
});

test('a repair certificate rejects missing historical rows, and unscanned healthy pages are not reported complete',t=>{
 const f=fixture(t);f.global(2);assert.equal(f.client.cursor(),2);assert.equal(f.client.status().observedHead,6);assert.equal(f.client.status().complete,false);f.poison(3);f.global();f.server.repair(A,1,f.backup);f.global();const before=f.client.snapshot();
 // Deleting an older version can leave current messages internally valid.
 // A repair-prefix commitment still catches the lost historical event.
 f.server.db.prepare('DELETE FROM journal WHERE seq=1').run();assert.doesNotThrow(()=>f.server.verifyTopic(A));assert.throws(()=>f.server.catchup(A,1,f.client.map(A).cursor,6,128,allowed),code('REPAIR_CERTIFICATE_CHANGED'));assert.deepEqual(f.client.snapshot(),before);assert.equal(f.client.status().complete,false);
 record('retention-and-coverage',{observedHeadSeparateFromGlobalProgress:true,currentProjectionAloneCannotProveFullHistory:true,missingRepairPrefixRefusesCompletion:true});
});

test('negative control: valid but wrong routing identity is invisible to existing content checks and to haltedTopics',t=>{
 const f=fixture(t);f.server.push(f.op(C,'foreign-message','legitimate foreign message'));
 // Keep valid owner syntax and unchanged body/hash, but assign an A event to
 // an existing authorized foreign topic. Neither syntax nor content hash binds
 // this storage routing tuple to its original accepted owner.
 f.server.db.prepare('UPDATE journal SET owner_id=? WHERE seq=1').run('foreign');
 const actualProductPage=f.server.store.pull(0,128,[C]);const escaped=actualProductPage.events.find(e=>e.msgId==='message-a');assert(escaped);assert.equal(escaped.ownerId,'foreign');assert.equal(escaped.message.content,'v1');
 const proposedPage=f.server.pull(0,128,[C]);assert.equal(proposedPage.haltedTopics.length,0);assert(proposedPage.events.some(e=>e.msgId==='message-a'));
 record('valid-routing-corruption-counterexample',{actualProductContentValidationAccepted:true,wrongAuthorizedTopicReceivesOriginalBody:true,haltedTopicsDidNotDetectWrongOwnership:true,arbitraryRoutingCorruptionSafetyNotEstablished:true,syntheticDatabaseOnly:true});
});
