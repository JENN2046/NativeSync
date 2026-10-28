'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),{fileURLToPath}=require('node:url'),{createHash}=require('node:crypto');
const {wireTopic,fail}=require('./protocol');
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const MAX_FILE=20*1024*1024,CHUNK=65536;
class DesktopAttachments{
 constructor({queue,appDataRoot,connection,send,download,storeAttachment}){
  this.queue=queue;this.root=path.resolve(appDataRoot,'UserData','attachments');this.connection=connection;this.send=send;this.download=download;this.storeAttachment=storeAttachment;this.uploaded=new Map();this.skipped=0;
 }
 async localFile(attachment){
  const raw=attachment._fileManagerData||attachment,source=raw.internalPath||attachment.internalPath||attachment.src;
  if(typeof source!=='string')throw fail('ATTACHMENT_BLOB_MISSING');
  let candidate=source;if(source.startsWith('file://')){try{candidate=fileURLToPath(source);}catch{candidate=decodeURIComponent(source.slice(7));}}
  const file=path.resolve(candidate),relative=path.relative(this.root,file);
  if(!relative||relative.startsWith('..')||path.isAbsolute(relative))throw fail('ATTACHMENT_SOURCE_OUTSIDE_ROOT');
  let current=path.parse(this.root).root;
  for(const part of file.slice(current.length).split(path.sep).filter(Boolean)){current=path.join(current,part);const s=await fs.lstat(current);if(s.isSymbolicLink()||(s.isFile()&&s.nlink!==1))throw fail('ATTACHMENT_SOURCE_ALIAS');}
  const stat=await fs.stat(file);if(!stat.isFile()||stat.size>MAX_FILE)throw fail('ATTACHMENT_FILE_TOO_LARGE');return {file,stat};
 }
 async mapping(){const r=await this.send('/api/plugins/NativeSync/mobile/execution-configs');return r.topics;}
 find(rows,d){const id=wireTopic(d),t=rows.find(t=>t.ownerType===id.ownerType&&t.ownerId===id.ownerId&&t.topicId===id.topicId);if(!t)throw fail('TOPIC_NOT_ALLOWED');return t;}
 async uploadBytes(t,message,attachment,bytes,name,value,type,frameIndex){
  const requestId='desktop_'+digest(JSON.stringify([t.key,message.id,attachment.id,value,frameIndex??null]));
  const route='/api/plugins/NativeSync/attachments/'+encodeURIComponent(t.key);
  const started=await this.send(route+'/uploads',{body:{requestId,name,size:bytes.length,expectedHash:value,messageId:message.id,attachmentId:attachment.id,...(type&&type!=='application/octet-stream'?{type}:{}),...(frameIndex!==undefined?{frameIndex}:{})}});
  if(started.state!=='ready')for(let offset=started.offset;offset<bytes.length;offset+=CHUNK)await this.send(route+'/uploads/'+started.uploadId+'/chunks',{body:{offset,data:bytes.subarray(offset,offset+CHUNK).toString('base64')}});
  const done=await this.send(route+'/uploads/'+started.uploadId+'/finish',{body:{}});if(done.hash!==value)throw fail('ATTACHMENT_HASH_MISMATCH');
 }
 async uploadLocal(){
  const rows=await this.mapping();this.skipped=0;
  for(const d of this.connection.topics){const t=this.find(rows,d),snapshot=await this.queue.readSnapshot(d);
   for(const message of snapshot.history)for(const attachment of message.attachments||[]){
    try{
     const source=attachment._fileManagerData||attachment,value=attachment.blobHash||source.blobHash||attachment.hash||source.hash;
     if(!/^[a-f0-9]{64}$/.test(value||''))throw fail('ATTACHMENT_SOURCE_HASH_REQUIRED');
     const {file,stat}=await this.localFile(attachment),cache=JSON.stringify([t.key,message.id,attachment.id,value,file,stat.size,stat.mtimeMs]);
     const fresh=!this.uploaded.has(cache);
     if(fresh){const bytes=await fs.readFile(file);if(digest(bytes)!==value)throw fail('ATTACHMENT_SOURCE_HASH_MISMATCH');const name=path.win32.basename(path.basename(attachment.name||source.name||'attachment.txt'));await this.uploadBytes(t,message,attachment,bytes,name,value,source.type);this.uploaded.set(cache,true);}
     const frames=source.imageFrames||attachment.imageFrames;
     if(Array.isArray(frames)&&frames.length&&(fresh||!source.frameHashes?.length)){
      if(frames.length>10)throw fail('ATTACHMENT_FRAME_LIMIT');const hashes=[];
      for(let index=0;index<frames.length;index++){const frame=Buffer.from(frames[index],'base64');if(frame.length>MAX_FILE)throw fail('ATTACHMENT_FILE_TOO_LARGE');const value=digest(frame),type=frame[0]===137?'image/png':frame[0]===255?'image/jpeg':'image/webp',ext=type.split('/')[1].replace('jpeg','jpg');await this.uploadBytes(t,message,attachment,frame,'frame_'+index+'.'+ext,value,type,index);hashes.push(value);}
      if(JSON.stringify(source.frameHashes)!==JSON.stringify(hashes))await this.queue.mutate(d,history=>history.map(m=>m.id!==message.id?m:{...m,attachments:(m.attachments||[]).map(a=>{const data=a._fileManagerData||a;if(a.id!==attachment.id||(a.hash||data.hash)!==value||JSON.stringify(data.imageFrames||a.imageFrames)!==JSON.stringify(frames))return a;return {...a,frameHashes:hashes,...(a._fileManagerData?{_fileManagerData:{...a._fileManagerData,frameHashes:hashes}}:{})};})}));
     }
     if(this.uploaded.size>10000)this.uploaded.delete(this.uploaded.keys().next().value);
    }catch(e){if(['ENOENT','ATTACHMENT_BLOB_MISSING','ATTACHMENT_SOURCE_OUTSIDE_ROOT','ATTACHMENT_SOURCE_HASH_REQUIRED'].includes(e.code)){this.skipped++;continue;}throw e;}
   }
  }
 }
 async restoreRemote(){
  if(typeof this.storeAttachment!=='function')throw fail('NATIVE_ATTACHMENT_STORE_REQUIRED');
  const rows=await this.mapping();
  for(const d of this.connection.topics){const t=this.find(rows,d),snapshot=await this.queue.readSnapshot(d);
   for(const message of snapshot.history)for(const attachment of message.attachments||[]){
    const expected=attachment.blobHash||attachment.hash;if(!/^[a-f0-9]{64}$/.test(expected||''))continue;
    let local=false;try{const existing=await this.localFile(attachment);local=digest(await fs.readFile(existing.file))===expected;}catch(e){if(!['ENOENT','ATTACHMENT_BLOB_MISSING','ATTACHMENT_SOURCE_OUTSIDE_ROOT'].includes(e.code))throw e;}
    const data=attachment._fileManagerData||attachment,frameHashes=attachment.frameHashes||data.frameHashes;
    if(local&&(!frameHashes?.length||(data.imageFrames?.length===frameHashes.length&&data.imageFrames.every((f,i)=>digest(Buffer.from(f,'base64'))===frameHashes[i]))))continue;
    const route='/api/plugins/NativeSync/attachments/'+encodeURIComponent(t.key)+'/messages/'+encodeURIComponent(message.id)+'/'+encodeURIComponent(attachment.id);
    let restored=data;
    if(!local){let bytes;try{bytes=await this.download(route);}catch(e){if(e.code==='ATTACHMENT_BLOB_MISSING'){this.skipped++;continue;}throw e;}if(bytes.length>MAX_FILE||digest(bytes)!==expected)throw fail('ATTACHMENT_HASH_MISMATCH');restored=await this.storeAttachment(bytes,attachment.name,d.itemId,d.topicId,attachment.type);if(restored.hash!==expected)throw fail('ATTACHMENT_HASH_MISMATCH');}
    let frames=attachment.imageFrames??null;if(frameHashes?.length){frames=[];for(let index=0;index<frameHashes.length;index++){const bytes=await this.download(route+'/frames/'+index);if(digest(bytes)!==frameHashes[index])throw fail('ATTACHMENT_HASH_MISMATCH');frames.push(bytes.toString('base64'));}}
    // Only the native Queue may change local history. Keep synced content
    // metadata authoritative while adding device-local native file handles.
    await this.queue.mutate(d,history=>history.map(m=>m.id!==message.id?m:{...m,attachments:(m.attachments||[]).map(a=>a.id!==attachment.id||(a.blobHash||a.hash)!==expected?a:{...a,src:restored.internalPath,internalPath:restored.internalPath,_fileManagerData:{...restored,id:a.id,extractedText:a.extractedText??null,imageFrames:frames,...(a.blobHash?{blobHash:a.blobHash}:{}),...(frameHashes?{frameHashes}:{})}})}),{intent:{source:'native-attachment-materialization',localOnly:true,known:false}});
   }
  }
 }
}
module.exports={DesktopAttachments};
