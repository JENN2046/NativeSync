// GENERATED from packages/sync-contracts/src/contracts.mjs; source SHA256 b1ca0dd3d176e9db97c259e5a6a8f3a2562355733c9ce0a4a7c29d302a3f4c34
// Do not hand edit: node tools/build_contracts.mjs --write
'use strict';
// Shared deterministic contracts. Host canonicalization, cryptography and UTF8
// byte sizing are supplied explicitly; no filesystem, clock or browser storage.
function createProtocol({canonicalizeMessage,BoundedWarnings,messageContentHash,stableStringify,sha256},metadata){
function identity(value) {
    if (!value || !['agent', 'group'].includes(value.ownerType)) throw new Error('INVALID_IDENTITY');
    for (const field of ['ownerId', 'topicId']) {
        const v = value[field];
        if (typeof v !== 'string' || !v || /[<>:"/\\|?*\x00-\x1f]/.test(v) || v === '.' || v === '..' || /[. ]$/.test(v) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(v)) throw new Error('INVALID_IDENTITY');
    }
    if (typeof value.msgId !== 'string' || !value.msgId) throw new Error('INVALID_IDENTITY');
    return { ownerType: value.ownerType, ownerId: value.ownerId, topicId: value.topicId, msgId: value.msgId };
}
function contentMessage(value, topicId = '_') {
    const warnings = new BoundedWarnings();
    const message = canonicalizeMessage(value, topicId, warnings);
    if (warnings.count) throw new Error('INVALID_ATTACHMENT');
    return message;
}
function canonicalMessage(value, topicId = '_') { return metadata().preserveMetadata(value,contentMessage(value,topicId)); }
const messageKey = value => { const v = identity(value); return JSON.stringify([v.ownerType, v.ownerId, v.topicId, v.msgId]); };
const messageHash = message => messageContentHash(contentMessage(message, message.topicId || '_'));
const tombstoneHash = id => sha256(`deleted:${messageKey(id)}`);
const descriptor = id => ({ itemId: id.ownerId, itemType: id.ownerType, topicId: id.topicId });
const wireTopic = d => ({ ownerId: d.itemId, ownerType: d.itemType || 'agent', topicId: d.topicId });
const fail = code => Object.assign(new Error(code), { code });
return { identity, canonicalMessage, sha256, stable: stableStringify, messageKey, messageHash, tombstoneHash, descriptor, wireTopic, fail };
}

function createMetadata({stable,sha256,byteLength}){
const fail=code=>Object.assign(new Error(code),{code,status:409});
const controls=Object.freeze(['contextCompaction','isThinking','tool_calls','tool_call_id','continuity']);
const emptyHash=()=>sha256(stable({}));
function boundedJson(value,depth=0){
    if(depth>8)throw fail('INVALID_CONTROL_METADATA');
    if(value===null||typeof value==='boolean'||(typeof value==='number'&&Number.isFinite(value)))return value;
    if(typeof value==='string'&&value.length<=128000)return value;
    if(Array.isArray(value)&&value.length<=1000)return value.map(v=>boundedJson(v,depth+1));
    if(value&&typeof value==='object'&&Object.keys(value).length<=100&&!Object.keys(value).some(k=>['__proto__','prototype','constructor'].includes(k)))return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,boundedJson(v,depth+1)]));
    throw fail('INVALID_CONTROL_METADATA');
}
function fieldsFrom(message){
    const fields={};
    if(message.contextCompaction!==undefined){
        const c=message.contextCompaction;
        if(!c||c.kind!=='vchat-context-checkpoint'||c.version!==1||message.role!=='user'||typeof c.checkpoint!=='string'||!c.checkpoint.trim()||c.checkpoint.length>128000||typeof message.content!=='string'||!message.content.includes(c.checkpoint))throw fail('INVALID_CHECKPOINT_METADATA');
        fields.contextCompaction={kind:c.kind,version:1,checkpoint:c.checkpoint};
        for(const key of ['diaries','fidelity','continuity','warnings','sourceCount'])if(c[key]!==undefined)fields.contextCompaction[key]=boundedJson(c[key]);
        if(c.diaries!==undefined&&(!Array.isArray(c.diaries)||c.diaries.some(d=>!d||typeof d.content!=='string')))throw fail('INVALID_CHECKPOINT_METADATA');
        if(c.warnings!==undefined&&(!Array.isArray(c.warnings)||c.warnings.some(v=>typeof v!=='string')))throw fail('INVALID_CHECKPOINT_METADATA');
        if(c.sourceCount!==undefined&&(!Number.isSafeInteger(c.sourceCount)||c.sourceCount<0))throw fail('INVALID_CHECKPOINT_METADATA');
    }
    if(message.isThinking!==undefined){if(typeof message.isThinking!=='boolean')throw fail('INVALID_CONTROL_METADATA');fields.isThinking=message.isThinking;}
    if(message.tool_calls!==undefined){
        if(message.role!=='assistant'||!Array.isArray(message.tool_calls)||message.tool_calls.length>32||message.tool_calls.some(c=>!c||c.type!=='function'||typeof c.id!=='string'||!c.function||typeof c.function.name!=='string'||typeof c.function.arguments!=='string'))throw fail('INVALID_CONTROL_METADATA');
        fields.tool_calls=message.tool_calls.map(c=>({id:c.id,type:'function',function:{name:c.function.name,arguments:c.function.arguments}}));
    }
    if(message.tool_call_id!==undefined){if(message.role!=='tool'||typeof message.tool_call_id!=='string')throw fail('INVALID_CONTROL_METADATA');fields.tool_call_id=message.tool_call_id;}
    if(message.continuity!==undefined){
        const c=message.continuity;
        if(!c||c.version!==1||typeof c.known!=='boolean'||Object.keys(c).some(k=>!['version','known','requestId','executionId','dependsOnMessageIds'].includes(k))||!Array.isArray(c.dependsOnMessageIds)||c.dependsOnMessageIds.length>1000||c.dependsOnMessageIds.some(id=>typeof id!=='string'||!id||id.length>512||id===message.id)||new Set(c.dependsOnMessageIds).size!==c.dependsOnMessageIds.length)throw fail('INVALID_MESSAGE_CAUSALITY');
        for(const k of ['requestId','executionId'])if(c[k]!==undefined&&(typeof c[k]!=='string'||!c[k]||c[k].length>512))throw fail('INVALID_MESSAGE_CAUSALITY');
        fields.continuity={version:1,known:c.known,...(c.requestId?{requestId:c.requestId}:{}),...(c.executionId?{executionId:c.executionId}:{}),dependsOnMessageIds:[...c.dependsOnMessageIds]};
    }
    const attachments=[];
    for(const a of message.attachments||[]){
        const source=a._fileManagerData||a,entry={id:a.id||source.id||'attachment_'+(a.hash||source.hash),contentHash:a.hash||source.hash};
        for(const key of ['extractedText','imageFrames','blobHash','frameHashes'])if(source[key]!==undefined)entry[key]=source[key];
        if(entry.frameHashes!==undefined){if(!Array.isArray(entry.frameHashes)||entry.frameHashes.length>10||entry.frameHashes.some(h=>!/^[a-f0-9]{64}$/.test(h)))throw fail('INVALID_ATTACHMENT_METADATA');delete entry.imageFrames;}
        if(typeof entry.id!=='string'||!entry.id||(entry.extractedText!==undefined&&typeof entry.extractedText!=='string')||(entry.blobHash!==undefined&&!/^[a-f0-9]{64}$/.test(entry.blobHash))||(entry.imageFrames!==undefined&&(!Array.isArray(entry.imageFrames)||entry.imageFrames.some(f=>typeof f!=='string'))))throw fail('INVALID_ATTACHMENT_METADATA');
        attachments.push(entry);
    }
    if(new Set(attachments.map(a=>a.id)).size!==attachments.length)throw fail('INVALID_ATTACHMENT_METADATA');
    if(attachments.length)fields.attachmentData=attachments.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
    if(byteLength(stable(fields))>768000)throw fail('CONTROL_METADATA_TOO_LARGE');
    return fields;
}
function withFields(message,envelope){
    const result={...message};for(const key of controls)delete result[key];
    const fields=envelope.fields;
    for(const key of controls)if(Object.hasOwn(fields,key))result[key]=fields[key];
    if(result.attachments)result.attachments=result.attachments.map(a=>{
        const copy={...a};for(const k of ['extractedText','imageFrames','blobHash','frameHashes'])delete copy[k];
        const data=fields.attachmentData?.find(item=>item.id===a.id||item.contentHash===a.hash);
        copy.id=data?.id||a.id||'attachment_'+a.hash;
        if(data)for(const k of ['extractedText','imageFrames','blobHash','frameHashes'])if(Object.hasOwn(data,k))copy[k]=data[k];
        return copy;
    });
    result._nativeSyncMetadata=envelope;return result;
}
function envelopeFor(message,version){const fields=fieldsFrom(message);return {version,hash:sha256(stable(fields)),fields};}
function validateEnvelope(message,envelope){
    if(!envelope||Object.keys(envelope).some(k=>!['version','hash','fields'].includes(k))||!Number.isSafeInteger(envelope.version)||envelope.version<1||!envelope.fields||Object.keys(envelope.fields).some(k=>![...controls,'attachmentData'].includes(k)))throw fail('INVALID_CONTROL_METADATA');
    const normalized=fieldsFrom(withFields(message,envelope));
    // R1-B envelopes predate attachment identity binding. Preserve their digest
    // on read; a new publisher may advance them to the richer R1-C projection.
    for(const item of normalized.attachmentData||[]){const original=envelope.fields.attachmentData?.find(a=>a.id===item.id);if(original&&!Object.hasOwn(original,'contentHash'))delete item.contentHash;}
    if(stable(normalized)!==stable(envelope.fields)||sha256(stable(normalized))!==envelope.hash)throw fail('INVALID_METADATA_DIGEST');
    return {version:envelope.version,hash:envelope.hash,fields:normalized};
}
function preserveMetadata(source,target){
    if(target.attachments)target.attachments=target.attachments.map((a,index)=>{
        const raw=source.attachments[index],data=raw?._fileManagerData||raw;
        return {...a,id:raw?.id||data?.id||'attachment_'+a.hash,...(data?.blobHash!==undefined?{blobHash:data.blobHash}:{}),...(data?.frameHashes!==undefined?{frameHashes:data.frameHashes}:{})};
    });
    for(const key of controls)if(Object.hasOwn(source,key))target[key]=source[key];
    if(source._nativeSyncMetadata)return withFields(target,validateEnvelope(target,source._nativeSyncMetadata));
    const cleaned=withFields(target,{fields:fieldsFrom(target)});delete cleaned._nativeSyncMetadata;return cleaned;
}
return {fieldsFrom,withFields,envelopeFor,validateEnvelope,preserveMetadata,emptyHash,controlFields:controls};
}

function createSourceScope({identity,stable,sha256}){
const fail=code=>Object.assign(Error(code),{code,status:403});
// Absence alone means the legacy full-root contract. A malformed explicit
// limited contract must never downgrade to that legacy authority.
function normalizeScope(value){
 if(value===undefined)return null;
 if(!value||Array.isArray(value)||typeof value!=='object')throw fail('INVALID_SOURCE_SCOPE');
 if(value.mode==='full'&&Object.keys(value).length===1)return null;
 if(value.mode!=='limited'||Object.keys(value).some(k=>!['mode','topics'].includes(k))||!Array.isArray(value.topics)||!value.topics.length||value.topics.length>128)throw fail('INVALID_SOURCE_SCOPE');
 const keys=new Set(),topics=value.topics.map(t=>{
  if(!t||Object.keys(t).length!==3||Object.keys(t).some(k=>!['ownerType','ownerId','topicId'].includes(k)))throw fail('INVALID_SOURCE_SCOPE');
  try{identity({...t,msgId:'_scope'});}catch{throw fail('INVALID_SOURCE_SCOPE');}
  const row={ownerType:t.ownerType,ownerId:t.ownerId,topicId:t.topicId},key=stable(row);
  if(keys.has(key))throw fail('INVALID_SOURCE_SCOPE');keys.add(key);return row;
 }).sort((a,b)=>stable(a)<stable(b)?-1:stable(a)>stable(b)?1:0);
 return {mode:'limited',topics};
}
const scopeHash=value=>{const s=normalizeScope(value);return s?sha256(stable(s)):null;};
function permits(scope,d,owner=false){
 const s=scope===null?null:normalizeScope(scope);if(!s)return true;
 return s.topics.some(t=>t.ownerType===(d.ownerType||d.itemType||'agent')&&t.ownerId===(d.ownerId||d.itemId)&&(owner||t.topicId===d.topicId));
}
function expansion(previous,next){
 const a=normalizeScope(previous),b=normalizeScope(next);
 if(a&&!b&&next?.mode==='full'&&Object.keys(next).length===1)return null;
 if(!a||!b||b.topics.length<=a.topics.length||a.topics.some(t=>!b.topics.some(n=>stable(n)===stable(t))))throw fail('INVALID_SCOPE_EXPANSION');
 if(new Set(b.topics.map(t=>JSON.stringify([t.ownerId,t.topicId]).toLowerCase())).size!==b.topics.length)throw fail('OWNER_PATH_CONFLICT');
 return b;
}
return {normalizeScope,scopeHash,permits,expansion};
}

// Validation belongs to each existing caller. This function seals only its
// already validated fixed-key submission shape; attachment order is meaningful.
function submissionText({topicKey,kind,payload}){
 const canonical=kind==='message'?{attachments:payload.attachments||[],requestId:payload.requestId,text:payload.text}:{agentId:payload.agentId,requestId:payload.requestId};
 return JSON.stringify({kind,payload:canonical,topicKey});
}

module.exports={createProtocol,createMetadata,createSourceScope,submissionText};
