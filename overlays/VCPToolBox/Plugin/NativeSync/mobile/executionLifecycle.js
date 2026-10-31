'use strict';
const {step}=require('./executionDecisions.generated.cjs');
const allowed=new Set(['state','error_code','updated_at','user_seq','reply_message_id','pending_operation']);
const guarded=['state','kind','cancel_requested','request_dispatched','tool_started','pending_operation'];
const prepared=new WeakMap();
const fail=code=>Object.assign(new Error(code),{code});
// Plans do not grant write authority. The current durable precondition is part
// of the same SQL write; a stale pure observation must not overwrite new facts.
function applyDecision(db,plan){
 if(!plan||typeof plan.id!=='string'||!plan.expected||guarded.some(k=>!Object.hasOwn(plan.expected,k))||!plan.patch)throw fail('INVALID_EXECUTION_DECISION');
 const keys=Object.keys(plan.patch);if(!keys.length||keys.some(k=>!allowed.has(k)))throw fail('INVALID_EXECUTION_DECISION');
 let cache=prepared.get(db);if(!cache){cache=new Map();prepared.set(db,cache);}const key=keys.join(',');
 if(!cache.has(key))cache.set(key,db.prepare('UPDATE mobile_executions SET '+keys.map(k=>k+'=?').join(',')+' WHERE id=? AND '+guarded.map(k=>k+' IS ?').join(' AND ')));
 const result=cache.get(key).run(...keys.map(k=>plan.patch[k]),plan.id,...guarded.map(k=>plan.expected[k]));
 if(result.changes!==1)throw fail('EXECUTION_OBSERVATION_STALE');
}
function recoverInterrupted(db,observedAt){
 db.exec('BEGIN IMMEDIATE');
 try{
  const rows=db.prepare("SELECT id,state,kind,cancel_requested,request_dispatched,tool_started,pending_operation FROM mobile_executions WHERE state IN ('running','cancelling','waiting_approval') AND coalesce(kind,'') NOT IN ('group_message','group_invitation')").all();
  for(const row of rows)applyDecision(db,step(row,{type:'restart',observedAt}));
  db.exec('COMMIT');
 }catch(e){db.exec('ROLLBACK');throw e;}
}
module.exports={applyDecision,recoverInterrupted};
