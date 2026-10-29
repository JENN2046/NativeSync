'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {durableJson}=require('./durableJson');
const {sourceDirectory,sourceEntityKey,assertHistoryPath}=require('./sourceDirectory');
const {wireTopic,descriptor,messageKey,messageHash,canonicalMessage,sha256,stable,fail,identity}=require('./protocol');
const {fieldsFrom,emptyHash,envelopeFor,assertCompatibleBackfill}=require('./metadata');
const {normalizeScope,scopeHash,permits,expansion}=require('./sourceScope');
const ROOT='/api/v1/sync/source',PAGE=100,CATALOG_BYTES=96000,CATALOG_ITEMS=64;
const bindingFor=c=>({...(normalizeScope(c.sourceScope)?{scope:normalizeScope(c.sourceScope)}:{}),sourceId:c.sourceId,spaceId:c.spaceId,deviceId:c.deviceId,rootHash:sha256(process.platform==='win32'?path.resolve(c.sourceRoot).toLowerCase():path.resolve(c.sourceRoot))});
const freshSource=c=>({binding:bindingFor(c),revision:0,published:{},plans:{},deletions:{},pendingCatalog:null});
const baseFor=(message,seq=0)=>({hash:messageHash(message),deleted:false,seq,metadataVersion:message._nativeSyncMetadata?.version||0,metadataHash:message._nativeSyncMetadata?.hash||sha256(stable(fieldsFrom(message))),...(message._nativeSyncMetadata?.fields.continuity?{continuity:message._nativeSyncMetadata.fields.continuity,continuityVerified:true}:{})});

// This is a coordinator of the existing Queue, Adapter and Journal. It owns no
// second message ledger. Snapshot payloads are bounded durable page files; only
// identities, digests and progress are added to the existing Adapter state.
class SourceSync{
 static async verify(connection,state,send){
  const b=bindingFor(connection);
  if(state?.source){
   if(stable(state.source.binding)===stable(b))return state.source;
   const prior=state.source.binding,{scope:oldScope,...oldIdentity}=prior,{scope:newScope,...newIdentity}=b,t=connection.scopeTransition;
   if(stable(oldIdentity)!==stable(newIdentity)||!t||t.expectedScopeHash!==scopeHash(oldScope))throw fail('SOURCE_BINDING_CHANGED');
   const rootStat=await fs.lstat(connection.sourceRoot);if(!rootStat.isDirectory()||rootStat.isSymbolicLink())throw fail('SOURCE_PATH_ALIAS');
   await assertHistoryPath(connection.sourceRoot,path.join(connection.sourceRoot,'UserData','_','topics','_','history.json'));
   expansion(oldScope,connection.sourceScope);
   for(const d of normalizeScope(connection.sourceScope)?.topics||[]){await assertHistoryPath(connection.sourceRoot,path.join(connection.sourceRoot,'UserData',d.ownerId,'topics',d.topicId,'history.json'));await assertHistoryPath(connection.sourceRoot,path.join(connection.sourceRoot,d.ownerType==='group'?'AgentGroups':'Agents',d.ownerId,'config.json'));}
   if(state.outbox.length||state.inbox.length||state.pending||Object.keys(state.localCommits).length||Object.keys(state.drift).length||state.source.pendingCatalog||oldScope.topics.some(d=>!Object.values(state.source.plans).some(p=>p.stage==='complete'&&!p.error&&stable(wireTopic(p.descriptor))===stable(d))&&!Object.values(state.source.deletions).some(r=>r.stage==='published'&&r.targets.some(t=>stable(t)===stable(d))))||Object.values(state.source.deletions).some(r=>!['published','aborted'].includes(r.stage)))throw fail('SOURCE_SCOPE_NOT_SETTLED');
   const localStateHash=sha256(stable(state)),r=await send(ROOT+'/scope-transition',{body:{...t,newScope:connection.sourceScope}});
   if(r.approved!==true||r.opId!==t.opId||r.sourceId!==b.sourceId||r.deviceId!==b.deviceId||r.spaceId!==b.spaceId||r.fromScopeHash!==t.expectedScopeHash||r.toScopeHash!==scopeHash(newScope)||stable(r.scope)!==stable(normalizeScope(connection.sourceScope))||r.revision!==state.source.revision)throw fail('SOURCE_TRANSITION_ACK_MISMATCH');
   return {...structuredClone(state.source),binding:b,scopeTransition:{...r,localStateHash}};
  }
  const info=await send(ROOT+'/info?'+new URLSearchParams({sourceId:b.sourceId,deviceId:b.deviceId}));
  if(scopeHash(info.scope)!==scopeHash(connection.sourceScope))throw fail('SOURCE_SCOPE_MISMATCH');
  if(info.spaceId!==b.spaceId||info.sourceId!==b.sourceId||info.deviceId!==b.deviceId)throw fail('SOURCE_BINDING_CHANGED');
  if(state?.source){if(stable(state.source.binding)!==stable(b))throw fail('SOURCE_BINDING_CHANGED');return state.source;}
  if(state){
   if(state.deviceId!==b.deviceId)throw fail('SOURCE_BINDING_CHANGED');
   const records=Object.entries(state.acked).map(([key,r])=>{const [ownerType,ownerId,topicId,msgId]=JSON.parse(key);return {ownerType,ownerId,topicId,msgId,seq:r.seq,hash:r.hash,metadataHash:r.metadataHash};});
   for(let i=0;i<Math.max(1,records.length);i+=128){const r=await send(ROOT+'/verify-state',{body:{cursor:state.cursor,records:records.slice(i,i+128)}});if(r.verified!==true)throw fail('SOURCE_HISTORY_DOMAIN_MISMATCH');}
  }
  // A nonzero server directory without local source receipts needs recovery,
  // not a new device/directory operation silently rebased to its latest version.
  if(info.revision!==0)throw fail('SOURCE_LOCAL_RECEIPTS_REQUIRED');
  return freshSource(connection);
 }
 constructor({adapter,connection,appDataRoot,readAgentConfig,readGroupConfig,send,fault=async()=>{}}){
  Object.assign(this,{adapter,connection,appDataRoot,readAgentConfig,readGroupConfig,send,fault});
  this.root=path.join(path.dirname(adapter.statePath),'backfill');this.snapshots=new Map();this.lastScan=0;this.dirty=true;this.offset=0;this.errors=[];
 }
 get state(){return this.adapter.state.source;}
 assertBinding(){if(stable(this.state.binding)!==stable(bindingFor(this.connection)))throw fail('SOURCE_BINDING_CHANGED');}
 get paused(){this.assertBinding();return Boolean(this.state.binding.scope&&this.connection.sourcePaused);}
 assertScope(d,owner=false){this.assertBinding();if(!permits(this.state.binding.scope,d,owner))throw fail('SOURCE_TOPIC_NOT_APPROVED');}
 topicKey(d){return this.adapter.topicKey(d);}
 plan(d){return this.state.plans[this.topicKey(d)];}
 deleted(d){return Object.values(this.state.deletions).some(r=>r.targets.some(t=>t.ownerType===(d.itemType||'agent')&&t.ownerId===d.itemId&&(!t.topicId||t.topicId===d.topicId))&&r.stage!=='aborted');}
 async open(){
  const a=this.adapter;
  if(stable(this.state.binding)!==stable(bindingFor(this.connection)))throw fail('SOURCE_BINDING_CHANGED');
  for(const [key,p]of Object.entries(this.state.plans)){this.assertScope(p.descriptor);if(p.stage!=='capturing'&&p.stage!=='complete')await this.loadSnapshot(key,p);}
  a.ensureSourceTopic=d=>this.ensureTopic(d);a.ensureSourceSnapshot=d=>this.ensureSnapshot(d);
  a.sourceBase=(d,id)=>this.snapshots.get(this.topicKey(d))?.get(id)?.base;
  a.sourceExpected=d=>[...(this.snapshots.get(this.topicKey(d))||[])].map(([id,row])=>[messageKey({...wireTopic(d),msgId:id}),row.base]);
  a.sourceUnprepared=d=>!this.plan(d)||this.plan(d).stage==='capturing'||this.deleted(d);
  a.sourceOutboundBlocked=d=>this.plan(d)?.stage!=='complete'||this.deleted(d);
  a.sourceInboundBlocked=d=>this.plan(d)?.stage!=='complete'||this.deleted(d);
  a.sourceDeleted=d=>this.deleted(d);a.sourceDiagnostics=()=>this.diagnostics();
  a.directoryChanged=()=>{this.dirty=true;};a.beginDirectoryDeletion=t=>this.beginDelete(t);
  await this.recoverDeletes();
  return this;
 }
 async safePage(file){await assertHistoryPath(path.dirname(this.adapter.statePath),file);return JSON.parse(await fs.readFile(file,'utf8'));}
 async loadSnapshot(key,plan){
  const manifest=await this.safePage(path.join(this.root,plan.id,'manifest.json'));
  if(manifest.id!==plan.id||manifest.topicKey!==key||manifest.count!==plan.count||manifest.pages.length!==plan.pages)throw fail('BACKFILL_MANIFEST_MISMATCH');
  const rows=new Map();
  for(let i=0;i<manifest.pages.length;i++){
   const page=await this.safePage(path.join(this.root,plan.id,'local-'+i+'.json'));
   if(page.id!==plan.id||page.index!==i||page.rows.length>PAGE||sha256(stable(page.rows))!==manifest.pages[i])throw fail('BACKFILL_PAGE_MISMATCH');
   for(const row of page.rows){if(rows.has(row.message.id))throw fail('DUPLICATE_MESSAGE_ID');rows.set(row.message.id,row);}
  }
  if(rows.size!==manifest.count)throw fail('BACKFILL_COUNT_MISMATCH');this.snapshots.set(key,rows);return rows;
 }
 async ensureTopic(d){
  this.assertScope(d);if(this.paused)throw fail('SOURCE_IMPORT_PAUSED');
  const found=await sourceDirectory(this);const tuple=wireTopic(d);
  if(!found.topics.some(t=>sourceEntityKey(t)===sourceEntityKey(tuple)))throw fail('SOURCE_TOPIC_NOT_IN_NATIVE_DIRECTORY');
  await this.adapter.addSourceTopic(d);this.dirty=true;
 }
 // Caller holds this Topic's existing Queue. No network is awaited here.
 async ensureSnapshot(d){
  this.assertScope(d);if(this.paused&&(!this.plan(d)||this.plan(d).stage==='capturing'))throw fail('SOURCE_IMPORT_PAUSED');
  if(this.deleted(d))throw fail('SOURCE_DIRECTORY_DELETED');
  const key=this.topicKey(d);let p=this.plan(d);if(p&&p.stage!=='capturing')return;
  if(!p){
   p={id:randomUUID(),descriptor:{...d,itemType:d.itemType||'agent'},stage:'capturing',localIndex:0,remoteAfter:0};
   await this.adapter.transaction(n=>{n.source.plans[key]=p;});
  }
  // A crash before publishing the manifest has not sent any baseline operation;
  // the same plan ID may safely capture again while writes remain fenced.
  const history=await this.adapter.queue.read(d),ids=new Set(),rows=[];
  for(const raw of history){
   if(typeof raw.id!=='string'||!raw.id||ids.has(raw.id))throw fail('DUPLICATE_MESSAGE_ID');ids.add(raw.id);
   let message=require('./sourceSnapshot').canonicalSourceSnapshot(raw,d.topicId);const fields=fieldsFrom(message),metadataHash=sha256(stable(fields));
   const known=this.adapter.state.acked[messageKey({...wireTopic(d),msgId:message.id})];
   const pending=this.adapter.state.outbox.some(op=>messageKey(op)===messageKey({...wireTopic(d),msgId:message.id}));
   if(!known&&!pending&&metadataHash!==emptyHash()){const metadata=envelopeFor(message,1);message={...message,_nativeSyncMetadata:metadata};}
   rows.push({message,base:baseFor(message),eligible:!known&&!pending});
  }
  const folder=path.join(this.root,p.id);await assertHistoryPath(path.dirname(this.adapter.statePath),path.join(folder,'manifest.json'));
  const hashes=[];
  for(let i=0;i<rows.length;i+=PAGE){const page=rows.slice(i,i+PAGE);hashes.push(sha256(stable(page)));await durableJson(path.join(folder,'local-'+(i/PAGE)+'.json'),{id:p.id,index:i/PAGE,rows:page});}
  const manifest={id:p.id,topicKey:key,revision:this.adapter.queue.revision(history),count:rows.length,pages:hashes};
  await durableJson(path.join(folder,'manifest.json'),manifest);
  await this.adapter.transaction(n=>{Object.assign(n.source.plans[key],{stage:'remote',pages:hashes.length,count:rows.length,snapshotRevision:manifest.revision});delete n.drift[key];});
  this.snapshots.set(key,new Map(rows.map(row=>[row.message.id,row])));
  await this.fault('plan-durable',{id:p.id,topic:wireTopic(d)});
 }
 async discover(){
  this.assertBinding();if(this.paused)return;
  const result=await sourceDirectory(this);this.errors=result.errors;this.lastScan=Date.now();this.dirty=false;
  this.directory=result;
  for(const t of result.topics){const d=descriptor(t);if(this.deleted(d))continue;try{await this.adapter.addSourceTopic(d);
   if(t.sourceState==='available'&&(!this.plan(d)||this.plan(d).stage==='capturing'))await this.adapter.queue.run(d,()=>this.ensureSnapshot(d));}catch(e){if(e.syncStatePersistenceFailure)throw e;this.errors.push({...wireTopic(d),code:e.code||'SOURCE_SNAPSHOT_FAILED'});}
  }
  // Share the growing array with existing attachment/config consumers. It is
  // never used as the binding identity of a full-source execution cache.
  this.connection.topics.splice(0,this.connection.topics.length,...this.adapter.topics.filter(d=>!this.deleted(d)&&this.plan(d)?.stage==='complete'));
 }
 async publish(){
  this.assertBinding();if(this.paused)return;
  if(!this.state.pendingCatalog){
   const body={opId:randomUUID(),baseRevision:this.state.revision,agents:[],topics:[],removed:[]};
   const directory=this.directory||{agents:[],topics:[]};
   const add=(kind,rows)=>{
    body[kind].push(...rows);
    if(body.agents.length+body.topics.length+body.removed.length>CATALOG_ITEMS||Buffer.byteLength(JSON.stringify(body))>CATALOG_BYTES){
     body[kind].splice(body[kind].length-rows.length);return false;
    }return true;
   };
   for(const row of directory.agents){
    if(this.deleted({itemType:row.ownerType,itemId:row.ownerId})||this.state.published[sourceEntityKey(row)]===sha256(stable(row)))continue;
    if(!add('agents',[row]))break;
   }
   for(const row of directory.topics){
    if(this.deleted(descriptor(row)))continue;const parentKey=sourceEntityKey({...row,topicId:''});
    if(!this.state.published[parentKey]&&!body.agents.some(a=>sourceEntityKey(a)===parentKey))continue;
    if(this.state.published[sourceEntityKey(row)]!==sha256(stable(row))&&!add('topics',[row]))break;
   }
   for(const record of Object.values(this.state.deletions))if(record.stage==='committed'){
    if(!add('removed',record.targets.map(t=>({...t,kind:t.topicId?'topic':'owner'}))))break;
   }
   if(!body.agents.length&&!body.topics.length&&!body.removed.length)return;
   await this.adapter.transaction(n=>{n.source.pendingCatalog=body;});
  }
  const body=this.state.pendingCatalog;let r;
  try{r=await this.send(ROOT+'/catalog',{body});}
  catch(error){
   if([400,413].includes(error.status)&&Buffer.byteLength(JSON.stringify(body))>CATALOG_BYTES)await this.archiveUnacceptedCatalog(body,error);
   throw error;
  }
  if(r.revision!==body.baseRevision+1)throw fail('SOURCE_DIRECTORY_ACK_MISMATCH');
  await this.fault('directory-accepted',{opId:body.opId,revision:r.revision});
  await this.adapter.transaction(n=>{
   n.source.revision=r.revision;for(const row of [...body.agents,...body.topics])n.source.published[sourceEntityKey(row)]=sha256(stable(row));
   for(const record of Object.values(n.source.deletions))if(record.stage==='committed'&&record.targets.every(t=>body.removed.some(r=>sourceEntityKey(r)===sourceEntityKey(t))))record.stage='published';
   n.source.pendingCatalog=null;
  });
 }
 async archiveUnacceptedCatalog(body,error){
  const b=this.state.binding,info=await this.send(ROOT+'/info?'+new URLSearchParams({sourceId:b.sourceId,deviceId:b.deviceId}));
  if(info.spaceId!==b.spaceId||info.deviceId!==b.deviceId||info.sourceId!==b.sourceId)throw fail('SOURCE_BINDING_CHANGED');
  // Catalog commits increase revision monotonically. Equality proves this old
  // oversized operation was never accepted; any uncertainty retains it intact.
  if(info.revision!==body.baseRevision||this.state.revision!==body.baseRevision)throw fail('SOURCE_DIRECTORY_CONFIRMATION_REQUIRED');
  const file=path.join('catalog-rejections',sha256(body.opId)+'.json'),absolute=path.join(path.dirname(this.adapter.statePath),file),bodyHash=sha256(stable(body));
  await assertHistoryPath(path.dirname(this.adapter.statePath),absolute);
  await durableJson(absolute,{body,bodyHash,notAcceptedAtRevision:info.revision,spaceId:b.spaceId,error:{code:error.code,status:error.status}});
  await this.adapter.transaction(n=>{
   if(sha256(stable(n.source.pendingCatalog))!==bodyHash)throw fail('SOURCE_DIRECTORY_PENDING_CHANGED');
   n.source.catalogRejections||={};n.source.catalogRejections[body.opId]={file,bodyHash,notAcceptedAtRevision:info.revision};
   n.source.pendingCatalog=null;
  });
 }
 async acknowledge(event){
  const a=this.adapter,d=descriptor(event),key=messageKey(event),snapshot=this.snapshots.get(this.topicKey(d))?.get(event.msgId);
  if(a.state.acked[key]?.seq>=event.seq)return;
  a.validateEvent(event);
  if(snapshot?.eligible){
   if(event.action==='upsert'){
    if(snapshot.base.hash!==event.hash)throw fail('INITIAL_IMPORT_CONTENT_CONFLICT');
    assertCompatibleBackfill(snapshot.message,event.message);
    // An edit made during backfill keeps its original base and operation. Only
    // the matching immutable baseline is acknowledged; never rewrite the edit.
    if(a.state.outbox.some(op=>messageKey(op)===key)){
     if(snapshot.base.metadataHash!==(event.message?._nativeSyncMetadata?.hash||emptyHash()))throw fail('INITIAL_IMPORT_METADATA_CONFLICT');
     await a.transaction(n=>{if(!n.acked[key]||n.acked[key].seq<event.seq)n.acked[key]={...baseFor(event.message,event.seq)};});return;
    }
   }else if(!a.state.acked[key]){
    if(!event.previous||event.previous.hash!==snapshot.base.hash||(event.previous.metadataHash||emptyHash())!==snapshot.base.metadataHash)throw fail('INITIAL_IMPORT_REMOTE_TOMBSTONE');
    if(a.state.outbox.some(op=>messageKey(op)===key))throw fail('UNSYNCED_LOCAL_CONFLICT');
    await a.transaction(n=>{n.acked[key]={...event.previous,deleted:false};});
   }
  }
  await a.applyRemote(event,false,false,true);
 }
 async step(d){
  this.assertScope(d);if(this.paused)return;
  const key=this.topicKey(d);let p=this.plan(d);if(!p||p.stage==='capturing'||p.stage==='complete'||this.deleted(d)||!this.state.published[sourceEntityKey(wireTopic(d))])return;
  if(!this.snapshots.has(key))await this.loadSnapshot(key,p);
  if(!p.remote){const remote=await this.send(ROOT+'/baselines',{body:{planId:p.id,...wireTopic(d)}});if(remote.planId!==p.id||stable(remote.topic)!==stable(wireTopic(d))||!Number.isSafeInteger(remote.watermark))throw fail('BACKFILL_REMOTE_IDENTITY');await this.adapter.transaction(n=>{n.source.plans[key].remote=remote;});p=this.plan(d);}
  if(p.stage==='remote'){
   const pageFile=path.join(this.root,p.id,'remote-page.json');let page;
   try{page=await this.safePage(pageFile);if(page.after!==p.remoteAfter)page=null;}catch(e){if(e.code!=='ENOENT')throw e;}
   if(!page){const result=await this.send(ROOT+'/baselines/'+p.remote.id+'?after='+p.remoteAfter+'&limit='+PAGE);page={after:p.remoteAfter,result};await durableJson(pageFile,page);await this.fault('incoming-page-durable',{id:p.id,after:p.remoteAfter});}
   const r=page.result;
   if(r.id!==p.remote.id||r.watermark!==p.remote.watermark||r.total!==p.remote.total||!Array.isArray(r.events)||r.events.length>PAGE||!Number.isSafeInteger(r.next)||r.next<p.remoteAfter||(r.hasMore&&r.next===p.remoteAfter))throw fail('BACKFILL_PAGE_MISMATCH');
   let last=p.remoteAfter;for(const event of r.events){if(event.position<=last||event.position>r.next||event.seq>r.watermark||!this.adapter.sameTopic(event,d))throw fail('BACKFILL_PAGE_MISMATCH');last=event.position;await this.acknowledge(event);}
   await this.adapter.transaction(n=>{const plan=n.source.plans[key];plan.remoteAfter=r.next;plan.remoteCount=(plan.remoteCount||0)+r.events.length;if(!r.hasMore){if(plan.remoteCount!==r.total)throw fail('BACKFILL_COUNT_MISMATCH');plan.stage='local';}delete plan.error;});
   return;
  }
  if(p.stage==='local'){
   const rows=[...this.snapshots.get(key).values()];
   for(let count=0;count<16&&this.plan(d).localIndex<rows.length;count++){
    p=this.plan(d);const row=rows[p.localIndex],id={...wireTopic(d),msgId:row.message.id},mk=messageKey(id);
    if(row.eligible&&!this.adapter.state.acked[mk]){
     const op={...id,deviceId:this.connection.deviceId,opId:p.id+'_'+p.localIndex,action:'upsert',baseHash:null,message:row.message,...(row.message._nativeSyncMetadata?{metadata:row.message._nativeSyncMetadata}:{})};
     const r=await this.send(ROOT+'/push',{body:op});
     if(r.hash!==row.base.hash||r.deleted!==false||!Number.isSafeInteger(r.seq)||r.seq<1||(r.metadataHash||emptyHash())!==row.base.metadataHash)throw fail('CORRUPT_ACK');
     await this.fault('message-accepted',{opId:op.opId,seq:r.seq});
     await this.adapter.transaction(n=>{n.acked[mk]={...row.base,seq:r.seq,metadataVersion:r.metadataVersion||0,metadataHash:r.metadataHash||emptyHash()};n.source.plans[key].localIndex++;delete n.source.plans[key].error;});
    }else await this.adapter.transaction(n=>{n.source.plans[key].localIndex++;delete n.source.plans[key].error;});
   }
   if(this.plan(d).localIndex===rows.length){await this.send(ROOT+'/baselines/'+p.remote.id+'/complete',{body:{}});await this.adapter.transaction(n=>{n.source.plans[key].stage='complete';delete n.source.plans[key].error;});this.snapshots.delete(key);this.dirty=true;}
  }
 }
 async tick(){
  this.assertBinding();if(this.paused)return;
  await this.recoverDeletes();
  if(this.dirty||Date.now()-this.lastScan>5000)try{await this.discover();}catch(e){if(e.syncStatePersistenceFailure)throw e;this.errors=[{code:e.code||'SOURCE_DIRECTORY_READ_FAILED'}];this.lastScan=Date.now();}
  try{await this.publish();this.directoryPublicationError=null;}
  catch(error){if(error.syncStatePersistenceFailure)throw error;this.directoryPublicationError={code:error.code||'SOURCE_DIRECTORY_PUBLICATION_FAILED',status:error.status||null};}
  const pending=this.adapter.topics.filter(d=>this.plan(d)?.stage!=='complete'&&!this.deleted(d));
  for(let i=0;i<Math.min(4,pending.length);i++){
   const d=pending[(this.offset+i)%pending.length];
   try{await this.step(d);}catch(e){if(e.syncStatePersistenceFailure)throw e;await this.adapter.transaction(n=>{const p=n.source.plans[this.topicKey(d)];if(p)p.error={code:e.code||'BACKFILL_FAILED',status:e.status||null};});}
  }
  this.offset=pending.length?(this.offset+4)%pending.length:0;
  try{await this.releaseCompletedPayloads();this.cleanupError=null;}
  catch(error){if(error.syncStatePersistenceFailure)throw error;this.cleanupError=error.code||'BACKFILL_PAYLOAD_RELEASE_FAILED';}
 }
 async releaseCompletedPayloads(){
  // Confirmed plans no longer need a second copy of History. Retain plan ID,
  // watermark and manifest digests; release only our exact payload filenames.
  // At most ten files per tick; retry after an exit is an idempotent unlink.
  let budget=10;
  for(const [key,p]of Object.entries(this.state.plans)){
   if(p.stage!=='complete'||p.payloadReleased||budget===0)continue;
   if(!/^[a-f0-9-]{36}$/.test(p.id)||!Number.isSafeInteger(p.pages)||p.pages<0)throw fail('BACKFILL_MANIFEST_MISMATCH');
   let next=p.releasePage||0;
   while(budget>0&&next<=p.pages){
    const file=path.join(this.root,p.id,next<p.pages?'local-'+next+'.json':'remote-page.json');await assertHistoryPath(path.dirname(this.adapter.statePath),file);
    try{await fs.unlink(file);}catch(e){if(e.code!=='ENOENT')throw e;}
    next++;budget--;
   }
   await this.adapter.transaction(n=>{n.source.plans[key].releasePage=next;n.source.plans[key].payloadReleased=next>p.pages;});
  }
 }
 diagnostics(){const plans=Object.values(this.state.plans).filter(p=>!this.deleted(p.descriptor));return {mode:'source',scopeMode:this.state.binding.scope?'limited':'full',importsPaused:this.paused,directoryPublicationError:this.directoryPublicationError||null,cleanupError:this.cleanupError||null,directoryErrors:this.errors,agents:this.directory?.agents.length??null,topics:this.directory?.topics.length??null,pendingImports:plans.filter(p=>p.stage!=='complete').length,completedImports:plans.filter(p=>p.stage==='complete').length,conflicts:plans.filter(p=>p.error).map(p=>({topic:wireTopic(p.descriptor),code:p.error.code})),pendingDirectory:Boolean(this.state.pendingCatalog),pendingDeletes:Object.values(this.state.deletions).filter(r=>!['published','aborted'].includes(r.stage)).length};}
 async report(){const d=this.diagnostics();await this.send(ROOT+'/progress',{body:{pendingImports:d.pendingImports,pendingOperations:this.adapter.state.outbox.length,conflicts:d.conflicts.length+this.adapter.state.outbox.filter(o=>o.status).length,directoryErrors:(this.directoryPublicationError?1:0)+this.errors.length+(this.directory?.topics.filter(t=>t.sourceState!=='available').length||0),attachmentsPending:this.adapter.attachmentError?null:(this.adapter.attachmentSkipped??null)}});}
 async beginDelete(target){
  if(!permits(this.state.binding.scope,target,!target.topicId))return null;
  this.assertScope(target,!target.topicId);if(this.state.binding.scope&&!target.topicId)throw fail('LIMITED_SOURCE_OWNER_DELETE_REQUIRES_TOPIC');if(this.paused)throw fail('SOURCE_IMPORT_PAUSED');
  const t={ownerType:target.ownerType,ownerId:target.ownerId,...(target.topicId?{topicId:target.topicId}:{})};identity({...t,topicId:t.topicId||'_',msgId:'_'});
  const matches=d=>d.itemType===t.ownerType&&d.itemId===t.ownerId&&(!t.topicId||d.topicId===t.topicId);
  const existing=Object.values(this.state.deletions).find(r=>r.stage!=='aborted'&&r.targets.some(x=>sourceEntityKey(x)===sourceEntityKey(t)));
  if(existing)return this.deletionTicket(existing.id,true);
  const directory=await sourceDirectory(this);
  const native=t.topicId?directory.topics:directory.agents;
  if(!native.some(x=>sourceEntityKey(x)===sourceEntityKey(t))){
   // A marked unbound side-child is still a native temporary object. The caller
   // has already validated its marker; it has no published source membership.
   if(!t.topicId||!/^sidechat_\d+_[0-9a-f]+$/.test(t.topicId))throw fail('SOURCE_DELETE_TARGET_UNVERIFIED');
  }
  const id=randomUUID();await this.adapter.transaction(n=>{n.source.deletions[id]={id,targets:[t],stage:'prepared',nativePhase:'not-started'};});
  try{
   for(const d of this.adapter.topics.filter(matches))await this.adapter.queue.run(d,async()=>{if(this.adapter.projectionRecoveryFor(d)||this.adapter.state.localCommits[this.topicKey(d)]||(this.adapter.state.pending&&this.adapter.sameTopic(this.adapter.state.pending.event,d)))throw fail('SYNC_RECOVERY_REQUIRED');});
  }catch(e){await this.adapter.transaction(n=>{n.source.deletions[id].stage='aborted';});throw e;}
  return this.deletionTicket(id,false);
 }
 // Only the config-first phase can prove a failed write made no change.
 // Once directory removal or other native side effects start, preserve unknown
 // or partial outcomes for explicit continuation, never infer rollback.
 async deletionPreimage(t){
  const config=path.join(this.appDataRoot,t.ownerType==='group'?'AgentGroups':'Agents',t.ownerId,'config.json');
  const history=this.adapter.queue.getHistoryPath(t.ownerId,t.topicId);
  const digest=async file=>{await assertHistoryPath(this.appDataRoot,file);try{return sha256(await fs.readFile(file));}catch(e){if(e.code==='ENOENT')return null;throw e;}};
  return {configHash:await digest(config),historyHash:await digest(history)};
 }
 deletionTicket(id,continuation){return {
  canResumeMissingTopic:continuation&&this.state.deletions[id]?.stage==='prepared',
  beforeConfigUpdate:async()=>{
   const r=this.state.deletions[id];if(r?.stage!=='prepared'||r.nativePhase!=='not-started')return;
   const before=await this.deletionPreimage(r.targets[0]);
   await this.adapter.transaction(n=>{Object.assign(n.source.deletions[id],{nativePhase:'config-updating',before});});
  },
  changed:async()=>{await this.adapter.transaction(n=>{const r=n.source.deletions[id];if(r?.stage==='prepared')r.nativePhase='changed';});},
  destructive:async()=>{await this.adapter.transaction(n=>{const r=n.source.deletions[id];if(r?.stage==='prepared'&&r.nativePhase!=='changed')r.nativePhase='destructive-started';});},
  failed:error=>this.failDelete(id,error),
  commit:async()=>{await this.confirmDelete(id);this.dirty=true;},
 };}
 async failDelete(id,error){
  const r=this.state.deletions[id];if(!r||r.stage!=='prepared')return;
  let unchanged=r.nativePhase==='not-started';
  if(r.nativePhase==='config-updating'&&r.before)try{unchanged=stable(await this.deletionPreimage(r.targets[0]))===stable(r.before);}catch{unchanged=false;}
  if(unchanged){await this.adapter.transaction(n=>{Object.assign(n.source.deletions[id],{stage:'aborted',outcome:'unchanged',error:{code:error?.code||'NATIVE_DELETE_FAILED'}});});this.dirty=true;return;}
  await this.adapter.transaction(n=>{Object.assign(n.source.deletions[id],{outcome:r.nativePhase==='changed'?'partial':'unknown',error:{code:error?.code||'NATIVE_DELETE_FAILED'}});});
  // A failure in ancillary work may follow an authoritative native deletion.
  // Only the existing two-authority check may confirm that case.
  try{await this.confirmDelete(id);}catch(e){if(e.syncStatePersistenceFailure)throw e;}
 }
 async confirmDelete(id){
  const r=this.state.deletions[id];if(!r||r.stage!=='prepared')return;
  for(const t of r.targets){
   const directory=path.join(this.appDataRoot,'UserData',t.ownerId,...(t.topicId?['topics',t.topicId]:[]));await assertHistoryPath(this.appDataRoot,path.join(directory,'_'));
   try{await fs.lstat(directory);return;}catch(e){if(e.code!=='ENOENT')throw e;}
   if(!t.topicId){try{await fs.lstat(path.join(this.appDataRoot,t.ownerType==='group'?'AgentGroups':'Agents',t.ownerId));return;}catch(e){if(e.code!=='ENOENT')throw e;}}
   else if(!/^sidechat_\d+_[0-9a-f]+$/.test(t.topicId)){const cfg=await (t.ownerType==='group'?this.readGroupConfig:this.readAgentConfig)(t.ownerId);if(!Array.isArray(cfg?.topics)||cfg.topics.some(x=>x.id===t.topicId))return;}
  }
  await this.adapter.transaction(n=>{n.source.deletions[id].stage='committed';});
 }
 async recoverDeletes(){for(const [id,r]of Object.entries(this.state.deletions))if(r.stage==='prepared')try{await this.confirmDelete(id);}catch(e){if(e.syncStatePersistenceFailure)throw e;await this.adapter.transaction(n=>{n.source.deletions[id].error={code:e.code||'DELETE_VERIFICATION_UNAVAILABLE'};});}}
}
module.exports={SourceSync,bindingFor,freshSource};
