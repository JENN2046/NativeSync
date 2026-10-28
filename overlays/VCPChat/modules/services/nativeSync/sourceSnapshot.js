'use strict';
const {canonicalMessage,sha256,fail}=require('./protocol');
// Match the existing native-commit frame transport when enrolling old native
// History. This is a pure projection; original local frame bytes stay in History.
// An already attested envelope is never normalized into a different revision.
function canonicalSourceMessage(raw,topicId){
 if(raw?._nativeSyncMetadata)return canonicalMessage(raw,topicId);
 const value=structuredClone(raw);
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
module.exports={canonicalSourceMessage,canonicalSourceSnapshot};
