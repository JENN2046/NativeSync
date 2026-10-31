'use strict';
// Backfill admission is desktop-specific; shared envelope rules are not.
const {stable,sha256}=require('./protocol');
const {controlFields,...shared}=require('./contracts.generated.cjs').createMetadata({stable,sha256,byteLength:value=>Buffer.byteLength(value)});
const {fieldsFrom,validateEnvelope}=shared;
const fail=code=>Object.assign(new Error(code),{code,status:409});
function assertCompatibleAttachmentBackfill(local,remote){
    if(!Array.isArray(remote)||local.length!==remote.length)throw fail('INITIAL_IMPORT_METADATA_CONFLICT');
    const byId=new Map(remote.map(attachment=>[attachment.id,attachment]));
    for(const attachment of local){
        const other=byId.get(attachment.id);
        if(!other||attachment.contentHash!==other.contentHash)throw fail('INITIAL_IMPORT_METADATA_CONFLICT');
        for(const key of ['extractedText','imageFrames','blobHash','frameHashes']){
            if(Object.hasOwn(attachment,key)&&stable(attachment[key])!==stable(other[key]))throw fail('INITIAL_IMPORT_METADATA_CONFLICT');
        }
    }
}
function assertCompatibleBackfill(local,remote){
    const a=fieldsFrom(local),b=fieldsFrom(remote);
    if(local._nativeSyncMetadata)validateEnvelope(local,local._nativeSyncMetadata);
    if(remote._nativeSyncMetadata)validateEnvelope(remote,remote._nativeSyncMetadata);
    for(const [key,value]of Object.entries(a)){
        if(key==='attachmentData')assertCompatibleAttachmentBackfill(value,b[key]);
        else if(stable(value)!==stable(b[key]))throw fail('INITIAL_IMPORT_METADATA_CONFLICT');
    }
    if(local._nativeSyncMetadata&&(!remote._nativeSyncMetadata||local._nativeSyncMetadata.version!==remote._nativeSyncMetadata.version||local._nativeSyncMetadata.hash!==remote._nativeSyncMetadata.hash))throw fail('INITIAL_IMPORT_METADATA_CONFLICT');
}
module.exports={...shared,assertCompatibleBackfill};
