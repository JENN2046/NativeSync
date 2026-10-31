// Synthetic local benchmark. Does not replace the deployed adapter.
'use strict';
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),{performance}=require('node:perf_hooks'),{DatabaseSync}=require('node:sqlite'),{execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),{step}=require(root+'/overlays/VCPToolBox/Plugin/NativeSync/mobile/executionDecisions.generated.cjs'),{recoverInterrupted}=require(root+'/overlays/VCPToolBox/Plugin/NativeSync/mobile/executionLifecycle'),{groupPlans,applyGroups}=require(root+'/tests/fixtures/predicateBatchPrototype.cjs');
const original=execFileSync('git',['show','0c5cf07:overlays/VCPToolBox/Plugin/NativeSync/mobile/execution.js'],{cwd:root,encoding:'utf8'}).match(/this\.db\.prepare\("(UPDATE mobile_executions SET state=CASE[^\n]+)"\)\.run\(Date\.now\(\)\);/)[1];
const select="SELECT id,state,kind,cancel_requested,request_dispatched,tool_started,pending_operation FROM mobile_executions WHERE state IN ('running','cancelling','waiting_approval') AND coalesce(kind,'') NOT IN ('group_message','group_invitation')";
const median=a=>[...a].sort((a,b)=>a-b)[Math.floor(a.length/2)];
(async()=>{const dir=await fs.mkdtemp(path.join(os.tmpdir(),'nativesync-predicate-bench-')),rows=[];try{
 for(const count of [4,64,10000])for(const distribution of ['homogeneous','mixed']){
  const samples={bulk:[],perRow:[],batched:[]},phases=[],cpu=[];let groupCount,statements;
  // JIT warm-up is outside measurements; all variants use identical rows.
  for(let i=0;i<20000;i++)step({id:'warm',state:'running',kind:null,cancel_requested:0,request_dispatched:1,tool_started:0,pending_operation:null},{type:'restart',observedAt:12345});
  for(const mode of Object.keys(samples)){
   const db=new DatabaseSync(path.join(dir,mode+'-'+count+'-'+distribution+'.sqlite'));
   db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE mobile_executions(id TEXT PRIMARY KEY,state TEXT,kind TEXT,cancel_requested INTEGER,request_dispatched INTEGER,tool_started INTEGER,pending_operation TEXT,error_code TEXT,updated_at INTEGER,config_snapshot TEXT)');
   const put=db.prepare('INSERT INTO mobile_executions VALUES(?,?,?,?,?,?,NULL,NULL,1,?)');db.exec('BEGIN');
   for(let i=0;i<count;i++)put.run('synthetic-'+i,distribution==='mixed'?['running','cancelling','waiting_approval'][Math.floor(i/12)%3]:'running',null,distribution==='mixed'?Math.floor(i/6)%2:0,distribution==='mixed'?[null,0,1][Math.floor(i/2)%3]:1,distribution==='mixed'?i%2:0,'synthetic snapshot '+'x'.repeat(1024));db.exec('COMMIT');
   for(let sample=0;sample<7;sample++){
    // Reset exact starting facts, outside the timed recovery.
    db.exec("UPDATE mobile_executions SET state=CASE WHEN "+(distribution==='mixed'?"1 THEN CASE (CAST(substr(id,11) AS INTEGER)/12)%3 WHEN 0 THEN 'running' WHEN 1 THEN 'cancelling' ELSE 'waiting_approval' END":"0 THEN 'unused'")+" ELSE 'running' END,error_code=NULL,updated_at=1");
    const start=performance.now();let elapsed;
    if(mode==='bulk')db.prepare(original).run(12345);
    else if(mode==='perRow')recoverInterrupted(db,12345);
    else{
     db.exec('BEGIN IMMEDIATE');try{
      const t0=performance.now(),observed=db.prepare(select).all(),t1=performance.now(),plans=observed.map(r=>step(r,{type:'restart',observedAt:12345})),t2=performance.now(),groups=groupPlans(plans),t3=performance.now(),stats=applyGroups(db,groups),t4=performance.now();db.exec('COMMIT');const t5=performance.now();elapsed=t5-start;
      groupCount=stats.groups;statements=stats.statements;phases.push({read:t1-t0,plan:t2-t1,group:t3-t2,write:t4-t3,commit:t5-t4});
      const p0=performance.now();observed.map(r=>step(r,{type:'restart',observedAt:12345}));cpu.push(performance.now()-p0);
     }catch(e){db.exec('ROLLBACK');throw e;}
    }
    // CPU-only repeat is excluded from the end-to-end total.
    const total=mode==='batched'?elapsed:performance.now()-start;samples[mode].push(total);
    if(db.prepare("SELECT count(*) n FROM mobile_executions WHERE state IN ('running','cancelling','waiting_approval')").get().n)throw Error('INCOMPLETE_RECOVERY');
   }
   db.close();
  }
  rows.push({count,distribution,groupCount,statements,samplesMs:samples,medianMs:Object.fromEntries(Object.entries(samples).map(([k,v])=>[k,median(v)])),batchedPhaseMedianMs:Object.fromEntries(Object.keys(phases[0]).map(k=>[k,median(phases.map(p=>p[k]))])),cpuOnlyMedianMs:median(cpu)});
 }
 console.log(JSON.stringify({node:process.version,samplesPerMode:7,storage:'temporary SQLite WAL/FULL; same minimal schema and 1KiB snapshots as earlier benchmark',method:'three implementations; narrow read, plan, group, write, commit split; bulk/perRow totals include BEGIN as applicable, batched total includes BEGIN; phase breakdown excludes BEGIN; CPU repeat excluded',rows,productionAccess:false},null,2));
}finally{await fs.rm(dir,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
