'use strict';
const fs=require('node:fs/promises'),path=require('node:path');
const {durableJson}=require('./durableJson');
const {stable,sha256,fail}=require('./protocol');
const {validateEnvelope}=require('./metadata');
const {assertHistoryPath}=require('./sourceDirectory');
const brief=e=>({seq:e.seq,ownerType:e.ownerType,ownerId:e.ownerId,topicId:e.topicId,msgId:e.msgId,action:e.action,hash:e.hash});
const same=(a,b)=>stable(brief(a))===stable(brief(b));
// Immutable receive payloads. State owns the references and acknowledgement;
// these pages never decide History or Journal facts. Only one payload page is cached.
class InboxPages {
 constructor(statePath){this.root=statePath+'.inbox';this.parent=path.dirname(path.dirname(statePath));this.cache=null;this.garbage=new Set();}
 async checked(file){await assertHistoryPath(this.parent,file);}
 file(id){if(!/^[a-f0-9]{64}$/.test(id||''))throw fail('INVALID_INBOX_REFERENCE');return path.join(this.root,id+'.json');}
 async read(id){
  const file=this.file(id);await this.checked(file);
  const stat=await fs.stat(file),stamp=stat.size+':'+stat.mtimeMs+':'+stat.ctimeMs;
  if(this.cache?.id===id&&this.cache.stamp===stamp)return this.cache.events;
  const value=JSON.parse(await fs.readFile(file,'utf8'));
  if(value.version!==1||!Array.isArray(value.events)||value.events.length>100||sha256(stable(value.events))!==id)throw fail('INBOX_PAGE_CORRUPT');
  this.cache={id,stamp,events:value.events};return value.events;
 }
 async save(events){
  const refs=[];let batch=[],bytes=0;
  const flush=async()=>{
   if(!batch.length)return;const id=sha256(stable(batch)),file=this.file(id);await this.checked(file);
   try{await fs.access(file);await this.read(id);}catch(e){if(e.code!=='ENOENT')throw e;await durableJson(file,{version:1,events:batch});}
   for(const [slot,event]of batch.entries()){
    const causality=event.message?._nativeSyncMetadata?validateEnvelope(event.message,event.message._nativeSyncMetadata).fields.continuity:undefined;
    refs.push({...brief(event),payloadRef:{page:id,slot},...(causality?{causality}:{})});
   }
   batch=[];bytes=0;
  };
  for(const event of events){const size=Buffer.byteLength(JSON.stringify(event));if(batch.length&&(batch.length>=100||bytes+size>1024*1024))await flush();batch.push(event);bytes+=size;}await flush();return refs;
 }
 async hydrate(ref){
  if(!ref.payloadRef)return ref;
  const {page,slot}=ref.payloadRef;if(!Number.isSafeInteger(slot)||slot<0)throw fail('INVALID_INBOX_REFERENCE');
  const event=(await this.read(page))[slot];if(!event||!same(event,ref))throw fail('INBOX_REFERENCE_MISMATCH');
  const continuity=event.message?._nativeSyncMetadata?validateEnvelope(event.message,event.message._nativeSyncMetadata).fields.continuity:undefined;
  if(stable(continuity||null)!==stable(ref.causality||null))throw fail('INBOX_REFERENCE_MISMATCH');return event;
 }
 async prepare(state){
  const rows=state.inbox.filter(r=>!r.event.payloadRef),refs=await this.save(rows.map(r=>r.event));
  rows.forEach((r,i)=>{r.event=refs[i];});
  for(const row of state.inbox)if(row.projectionRecovery){if(!same(row.event,row.projectionRecovery.event))throw fail('RECOVERY_EVENT_MISMATCH');row.projectionRecovery.event=row.event;}
  if(state.pending){const ref=state.inbox.find(r=>same(r.event,state.pending.event))?.event;state.pending.event=ref||(state.pending.event.payloadRef?state.pending.event:(await this.save([state.pending.event]))[0]);}
 }
 references(state){return new Set([...state.inbox.map(r=>r.event.payloadRef?.page),state.pending?.event?.payloadRef?.page].filter(Boolean));}
 async validate(state){for(const row of state.inbox){if(!row.event.payloadRef)throw fail('INVALID_INBOX_REFERENCE');await this.hydrate(row.event);if(row.projectionRecovery&&!same(row.event,row.projectionRecovery.event))throw fail('RECOVERY_EVENT_MISMATCH');}if(state.pending)await this.hydrate(state.pending.event);}
 async collect(state,previous){
  const keep=this.references(state);
  if(previous){for(const id of this.references(previous))if(!keep.has(id))this.garbage.add(id);}
  else {await this.checked(path.join(this.root,'_directory_check'));try{for(const name of await fs.readdir(this.root))if(/^[a-f0-9]{64}\.json$/.test(name)&&!keep.has(name.slice(0,-5)))this.garbage.add(name.slice(0,-5));}catch(e){if(e.code!=='ENOENT')throw e;}}
  let budget=10;for(const id of this.garbage){if(!budget--)break;if(!keep.has(id)){const file=this.file(id);await this.checked(file);await fs.rm(file,{force:true});if(this.cache?.id===id)this.cache=null;}this.garbage.delete(id);}
 }
}
module.exports={InboxPages};
