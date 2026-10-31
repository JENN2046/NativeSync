// Offline diagnostic: open the existing database read-only. Never initialize a
// CentralStore here: its constructor installs schema/guards and changes WAL.
'use strict';
const {DatabaseSync}=require('node:sqlite');
const {projectStoredMessage,readStoredReceipt}=require('../overlays/VCPToolBox/Plugin/NativeSync/sync/centralStore');
function checkStorage(file){
 const db=new DatabaseSync(file,{readOnly:true}),result={mode:'read-only',scope:'messages, journal, applied_ops; SQLite quick_check and record/reference validation',checked:{messages:0,journal:0,applied_ops:0},issues:0,samples:[],sampleLimit:20};
 const issue=(table,rowid,kind)=>{result.issues++;if(result.samples.length<result.sampleLimit)result.samples.push({table,rowid,kind});};
 try{
  db.exec('PRAGMA query_only=ON; BEGIN');
  const quick=db.prepare('PRAGMA quick_check').all();if(quick.length!==1||quick[0].quick_check!=='ok')issue('database',null,'SQLITE_QUICK_CHECK_FAILED');
  const columns=Object.fromEntries(['messages','journal','applied_ops'].map(table=>[table,new Set(db.prepare('PRAGMA table_info('+table+')').all().map(c=>c.name))]));
  if(['messages','journal'].some(t=>!columns[t].has('metadata_version')||!columns[t].has('metadata_hash'))||!columns.applied_ops.has('result_json')){
   issue('database',null,'STORAGE_SCHEMA_UNSUPPORTED');return {...result,ok:false};
  }
  const accepted=db.prepare('SELECT * FROM journal WHERE seq=?');
  const latest=db.prepare('SELECT MAX(seq) seq FROM journal WHERE owner_type=? AND owner_id=? AND topic_id=? AND msg_id=?');
  const current=db.prepare('SELECT last_seq FROM messages WHERE owner_type=? AND owner_id=? AND topic_id=? AND msg_id=?');
  for(const table of ['journal','messages','applied_ops']){
   const first=db.prepare('SELECT rowid AS audit_rowid,* FROM '+table+' ORDER BY rowid LIMIT 128');
   const page=db.prepare('SELECT rowid AS audit_rowid,* FROM '+table+' WHERE rowid>? ORDER BY rowid LIMIT 128');let after=null;
   for(;;){const rows=after===null?first.all():page.all(after);if(!rows.length)break;
    for(const row of rows){after=row.audit_rowid;result.checked[table]++;
     try{
      if(table==='applied_ops'){
       const receipt=readStoredReceipt(row.result_json),event=accepted.get(receipt.seq);
       if(!event||event.hash!==receipt.hash||(event.action==='delete')!==receipt.deleted||
          (receipt.metadataVersion||0)!==event.metadata_version||(receipt.metadataHash||null)!==event.metadata_hash||
          !/^[a-f0-9]{64}$/.test(row.request_hash)||!row.device_id||!row.op_id)throw Error('RECEIPT_REFERENCE_INVALID');
      }else{
       projectStoredMessage(row);
       if(table==='journal'&&latest.get(row.owner_type,row.owner_id,row.topic_id,row.msg_id).seq===row.seq&&
          current.get(row.owner_type,row.owner_id,row.topic_id,row.msg_id)?.last_seq!==row.seq)throw Error('JOURNAL_PROJECTION_INVALID');
       if(table==='messages'){
        const event=accepted.get(row.last_seq),seq=latest.get(row.owner_type,row.owner_id,row.topic_id,row.msg_id).seq;
        if(!event||seq!==row.last_seq||['owner_type','owner_id','topic_id','msg_id','hash','metadata_version','metadata_hash'].some(k=>event[k]!==row[k])||(event.action==='delete')!==Boolean(row.deleted))throw Error('MESSAGE_REFERENCE_INVALID');
       }
      }
     }catch(error){issue(table,row.audit_rowid,['RECEIPT_REFERENCE_INVALID','MESSAGE_REFERENCE_INVALID','JOURNAL_PROJECTION_INVALID'].includes(error.message)?error.message:'SYNC_STORAGE_CORRUPT');}
    }
   }
  }
  return {...result,ok:result.issues===0};
 }finally{if(db.isTransaction)db.exec('ROLLBACK');db.close();}
}
if(require.main===module){
 if(process.argv.length!==4||process.argv[2]!=='--db'){process.stderr.write('Usage: node tools/check_sync_storage.cjs --db /absolute/path/central.sqlite\n');process.exitCode=2;}
 else try{const result=checkStorage(process.argv[3]);process.stdout.write(JSON.stringify(result,null,2)+'\n');process.exitCode=result.ok?0:1;}
 catch{process.stderr.write('SYNC_STORAGE_CHECK_FAILED: database unavailable or unsupported; no repair attempted\n');process.exitCode=2;}
}
module.exports={checkStorage};
