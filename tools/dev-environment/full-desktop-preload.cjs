'use strict';
// Verification only: automate the OS file chooser; native IPC/storage/send stay real.
if (process.versions.electron && process.type === 'browser') {
 const fs=require('node:fs'),path=require('node:path'),root=path.resolve(__dirname,'..');
 if(JSON.parse(fs.readFileSync(root+'/ISOLATED.json')).kind!=='nativesync-full-local-runtime')throw Error('ISOLATION_REQUIRED');
 // NODE_OPTIONS preloads run before Electron has installed its built-in module.
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
