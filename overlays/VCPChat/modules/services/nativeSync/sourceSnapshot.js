'use strict';
const {canonicalMessage,sha256,stable,fail}=require('./protocol');
const {nativeReference,projectDesktopReferences,withFields}=require('./metadata');
// Match the existing native-commit frame transport when enrolling old native
// History. This is a pure projection; original local frame bytes stay in History.
// An already attested envelope is never normalized into a different revision.
function canonicalSourceMessage(raw,topicId){
 if(raw?._nativeSyncMetadata)return canonicalMessage(raw,topicId);
 const value=structuredClone(projectDesktopReferences(raw));
 for(const attachment of value.attachments||[]){
  const data=attachment._fileManagerData||attachment,frames=data.imageFrames||attachment.imageFrames;
  if(!Array.isArray(frames)||!frames.length)continue;
  if(frames.length>10)throw fail('ATTACHMENT_FRAME_LIMIT');
  const hashes=frames.map(frame=>{const bytes=Buffer.from(frame,'base64');if(bytes.length>20*1024*1024)throw fail('ATTACHMENT_FILE_TOO_LARGE');return sha256(bytes);});
  attachment.frameHashes=hashes;if(attachment._fileManagerData)attachment._fileManagerData.frameHashes=hashes;
 }
 return canonicalMessage(value,topicId);
}
function canonicalSourceSnapshot(raw,topicId){
 if(raw?._nativeSyncMetadata)return canonicalSourceMessage(raw,topicId);
 const value={...raw};delete value.continuity;
 return canonicalSourceMessage(value,topicId);
}
// Published references never replace native live handles or historical text.
// Only a matching original local reference can materialize that native data.
function materializeSourceMessage(local,incoming,topicId){
 const message=canonicalSourceMessage(incoming,topicId);
 const own=canonicalSourceMessage(local,topicId),left={...own},right={...message};
 delete left._nativeSyncMetadata;delete right._nativeSyncMetadata;
 if(stable(left)===stable(right))return {...local,...(message._nativeSyncMetadata?{_nativeSyncMetadata:message._nativeSyncMetadata}:{})};
 const base={...local,...message};if(!message.attachments)delete base.attachments;
 let result=message._nativeSyncMetadata?withFields(base,message._nativeSyncMetadata):base;
 const available=(local?.attachments||[]).filter(old=>!nativeReference(old));
 if(result.attachments)result.attachments=result.attachments.map(a=>{
  const index=available.findIndex(old=>(old.id||old._fileManagerData?.id||'attachment_'+(old.hash||old._fileManagerData?.hash))===a.id&&(old.hash||old._fileManagerData?.hash)===a.hash);
  const previous=index<0?null:available.splice(index,1)[0];
  if(!previous)return a;
  const merged={...previous,...a},data={...(previous._fileManagerData||previous),id:a.id,name:a.name,type:a.type,size:a.size,hash:a.hash};
  for(const key of ['extractedText','imageFrames','frameHashes','blobHash']){delete merged[key];delete data[key];if(Object.hasOwn(a,key)){merged[key]=a[key];data[key]=a[key];}}
  const oldFrames=previous._fileManagerData?.imageFrames||previous.imageFrames;
  if(a.frameHashes?.length&&oldFrames?.length===a.frameHashes.length&&oldFrames.every((f,i)=>sha256(Buffer.from(f,'base64'))===a.frameHashes[i]))data.imageFrames=oldFrames;
  if(previous._fileManagerData)merged._fileManagerData=data;
  return merged;
 });
 const refs=message.desktopReferences||[];
 if(!refs.length)return result;
 const projected=projectDesktopReferences(local),native=new Map();
 for(const [index,a]of (local?.attachments||[]).entries())if(nativeReference(a)){
  const ref=projected.desktopReferences?.find(r=>r.index===index);if(ref)native.set(ref.id,{raw:a,ref});
 }
 const ordinary=[...(result.attachments||[])],combined=[];let offset=0;
 for(let index=0;index<ordinary.length+refs.length;index++){
  const ref=refs.find(r=>r.index===index);
  if(!ref){combined.push(ordinary[offset++]);continue;}
  const original=native.get(ref.id);
  if(!original)throw fail('DESKTOP_REFERENCE_LOCAL_DATA_REQUIRED');
  const {index:a,...left}=original.ref,{index:b,...right}=ref;
  if(stable(left)!==stable(right))throw fail('DESKTOP_REFERENCE_LOCAL_CONFLICT');
  combined.push(original.raw);
 }
 result.attachments=combined;delete result.desktopReferences;
 return result;
}
module.exports={canonicalSourceMessage,canonicalSourceSnapshot,materializeSourceMessage};
