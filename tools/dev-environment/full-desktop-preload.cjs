'use strict';
// Verification only: automate the OS file chooser; native IPC/storage/send stay real.
if (process.versions.electron && process.type === 'browser') {
 const fs=require('node:fs'),path=require('node:path'),root=path.resolve(__dirname,'..');
 if(JSON.parse(fs.readFileSync(root+'/ISOLATED.json')).kind!=='nativesync-full-local-runtime')throw Error('ISOLATION_REQUIRED');
 // NODE_OPTIONS preloads run before Electron has installed its built-in module.
 if(fs.existsSync(root+'/SOURCE_PROFILE.json')){
  const source=require(root+'/VCPChat/modules/services/nativeSync/sourceSync'),Base=source.SourceSync;
  source.SourceSync=class extends Base{
   constructor(options){super({...options,fault:async(stage,data)=>{
    await options.fault?.(stage,data);
    if(stage==='message-accepted'&&JSON.parse(fs.readFileSync(root+'/control.json')).sourceDropPushOnce){
     const file=root+'/evidence/source-lost-push.json';if(!fs.existsSync(file)){const fd=fs.openSync(file,'w',0o600);fs.writeSync(fd,JSON.stringify({pid:process.pid,...data}));fs.fsyncSync(fd);fs.closeSync(fd);}
     throw Object.assign(Error('ISOLATED_SOURCE_ACK_DROPPED'),{code:'NETWORK_UNAVAILABLE'});
    }
   }});}
   async tick(){try{return await super.tick();}finally{const d=this.diagnostics(),signature=JSON.stringify([d.bodySnapshotsResident,d.bodySnapshotPeak,d.pendingImports,d.completedImports]);if(signature!==this.lastResourceSignature){this.lastResourceSignature=signature;fs.appendFileSync(root+'/evidence/source-resources.jsonl',JSON.stringify({pid:process.pid,at:Date.now(),resident:d.bodySnapshotsResident,peak:d.bodySnapshotPeak,pending:d.pendingImports,complete:d.completedImports})+'\n');}}}
  };
 }
 setImmediate(()=>{
 const {dialog}=require('electron'),original=dialog.showOpenDialog;
 dialog.showOpenDialog=async function(...args){
  const files=JSON.parse(fs.readFileSync(root+'/control.json')).pickerFiles;
  if(!files)return original.apply(this,args);
  for(const f of files)if(!fs.realpathSync(f).startsWith(root+'/fixtures/'))throw Error('FIXTURE_FILE_REQUIRED');
  fs.appendFileSync(root+'/evidence/picker.jsonl',JSON.stringify({pid:process.pid,names:files.map(f=>path.basename(f))})+'\n');
  return {canceled:false,filePaths:files};
 };
 });
}
