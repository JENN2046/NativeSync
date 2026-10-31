// Experiment only: never imported by deployed execution code.
'use strict';
const guarded=['state','kind','cancel_requested','request_dispatched','tool_started','pending_operation'];
const allowed=new Set(['state','error_code','updated_at','user_seq','reply_message_id','pending_operation']);
const fail=code=>Object.assign(new Error(code),{code});
function groupPlans(plans){
 const groups=new Map(),seen=new Set();
 for(const plan of plans){
  if(!plan||typeof plan.id!=='string'||seen.has(plan.id)||!plan.expected||guarded.some(k=>!Object.hasOwn(plan.expected,k)))throw fail('INVALID_EXECUTION_DECISION');
  seen.add(plan.id);const keys=Object.keys(plan.patch||{}).sort();
  if(!keys.length||keys.some(k=>!allowed.has(k)))throw fail('INVALID_EXECUTION_DECISION');
  const expected=guarded.map(k=>plan.expected[k]),values=keys.map(k=>plan.patch[k]),key=JSON.stringify([expected,keys,values]);
  if(!groups.has(key))groups.set(key,{expected,keys,values,ids:[]});groups.get(key).ids.push(plan.id);
 }
 return [...groups.values()];
}
function applyGroups(db,groups){
 let statements=0;
 for(const group of groups)for(let offset=0;offset<group.ids.length;offset+=1000){
  const ids=group.ids.slice(offset,offset+1000),sql='UPDATE mobile_executions SET '+group.keys.map(k=>k+'=?').join(',')+' WHERE id IN ('+ids.map(()=>'?').join(',')+') AND '+guarded.map(k=>k+' IS ?').join(' AND ');
  const result=db.prepare(sql).run(...group.values,...ids,...group.expected);statements++;
  if(result.changes!==ids.length)throw fail('EXECUTION_OBSERVATION_STALE');
 }
 return {groups:groups.length,statements};
}
function applyPlans(db,plans){
 const groups=groupPlans(plans);db.exec('BEGIN IMMEDIATE');
 try{const stats=applyGroups(db,groups);db.exec('COMMIT');return stats;}
 catch(e){db.exec('ROLLBACK');throw e;}
}
module.exports={guarded,groupPlans,applyGroups,applyPlans};
