// GENERATED from packages/execution-decisions/src/lifecycle.mjs; source SHA256 a7465f37eb97f377d4317ae027c7b4711fe9f4db1aa563b1904df05086bef889
'use strict';
// Deterministic decisions over a durable row observation. This module neither
// accepts work nor invokes effects. The SQLite adapter must revalidate expected.
const fail=code=>Object.assign(new Error(code),{code});
const guarded=['state','kind','cancel_requested','request_dispatched','tool_started','pending_operation'];
function decision(row,patch){
 if(typeof row?.id!=='string'||!row.id)throw fail('INVALID_EXECUTION_OBSERVATION');
 return {id:row.id,expected:Object.fromEntries(guarded.map(k=>[k,row[k]??null])),patch};
}
function step(row,input){
 if(!Number.isSafeInteger(input?.observedAt)||input.observedAt<0)throw fail('INVALID_EXECUTION_OBSERVATION');
 if(input.type==='restart'){
  if(['group_message','group_invitation'].includes(row.kind)||!['running','cancelling','waiting_approval'].includes(row.state))return null;
  const cancelled=row.cancel_requested===1&&row.request_dispatched===0&&row.tool_started===0;
  return decision(row,{state:cancelled?'cancelled':'review_required',error_code:cancelled?'EXECUTION_CANCELLED_BEFORE_DISPATCH':'EXECUTION_INTERRUPTED_REVIEW_REQUIRED',updated_at:input.observedAt});
 }
 if(input.type==='journal-applied'){
  if(!['preparing','publishing'].includes(row.state)||!Number.isSafeInteger(input.receipt?.seq)||input.receipt.seq<1||typeof input.operation?.msgId!=='string')throw fail('INVALID_INTENT_RECEIPT');
  return row.state==='preparing'
   ?decision(row,{state:'queued',user_seq:input.receipt.seq,pending_operation:null,updated_at:input.observedAt})
   :decision(row,{state:row.terminal_state||'completed',reply_message_id:input.operation.msgId,pending_operation:null,updated_at:input.observedAt});
 }
 throw fail('UNSUPPORTED_EXECUTION_OBSERVATION');
}

module.exports={step};
