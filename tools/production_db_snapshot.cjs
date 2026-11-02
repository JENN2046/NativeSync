'use strict';
// Deployment tool only. Never initialize a product module or restore a database.
const {DatabaseSync,backup}=require('node:sqlite');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const [file,packageRoot,destination]=process.argv.slice(2);
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
function inspect(db){
 const tables=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(r=>r.name));
 const busy={};
 for(const [table,condition] of [
  ['mobile_executions',"state NOT IN ('completed','failed','cancelled') OR (review_resolved=0 AND error_code LIKE '%REVIEW_REQUIRED')"],
  ['mobile_native_tasks',"state NOT IN ('completed','failed','cancelled','stopped') OR (review_required=1 AND review_resolved=0)"],
  ['mobile_native_invocations',"state='started'"]
 ])if(tables.has(table))busy[table]=db.prepare('SELECT count(*) n FROM '+table+' WHERE '+condition).get().n;
 if(Object.values(busy).some(n=>n!==0))throw Error('NATIVE_WORK_NOT_SETTLED');
 const facts={};
 for(const table of [...tables].sort()){
  const quoted='"'+table.replaceAll('"','""')+'"',hash=crypto.createHash('sha256');let count=0;
  for(const row of db.prepare('SELECT * FROM '+quoted+' ORDER BY rowid').iterate()){hash.update(JSON.stringify(row)+'\n');count++;}
  facts[table]={rows:count,sha256:hash.digest('hex')};
 }
 return {facts,busy,headSeq:db.prepare('SELECT coalesce(max(seq),0) n FROM journal').get().n};
}
(async()=>{
 if(!path.isAbsolute(file)||!fs.statSync(file).isFile())throw Error('EXISTING_DATABASE_REQUIRED');
 const checker=require(path.join(packageRoot,'diagnostics/check_sync_storage.cjs'));
 const integrity=checker.checkStorage(file,path.join(packageRoot,'payload/VCPToolBox'));
 if(!integrity.ok)throw Error('STORAGE_CHECK_FAILED');
 const db=new DatabaseSync(file,{readOnly:true,timeout:1000});
 try{
  db.exec('PRAGMA query_only=ON; BEGIN');const state=inspect(db);
  if(destination){
   if(!path.isAbsolute(destination)||fs.existsSync(destination))throw Error('NEW_BACKUP_REQUIRED');
   await backup(db,destination);fs.chmodSync(destination,0o600);
   const snapshot=new DatabaseSync(destination,{readOnly:true,timeout:1000});
   try{if(snapshot.prepare('PRAGMA quick_check').get().quick_check!=='ok'||sha(JSON.stringify(inspect(snapshot)))!==sha(JSON.stringify(state)))throw Error('BACKUP_FACTS_MISMATCH');}
   finally{snapshot.close();}
  }
  console.log(JSON.stringify({readOnly:true,integrity,...state,...(destination?{snapshotSha256:sha(fs.readFileSync(destination))}:{} )}));
 }finally{if(db.isTransaction)db.exec('ROLLBACK');db.close();}
})().catch(()=>{process.stderr.write('DEPLOYMENT_DATABASE_CHECK_FAILED: inspect settled work and read-only storage diagnostics; no restore attempted\n');process.exitCode=1;});
