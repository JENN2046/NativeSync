'use strict';
const {envelopeFor}=require('./metadata');
// Publish only identities already owned by the native accepted execution.
// This is ordering metadata, not a new execution or task authority.
function annotateOperation(op,{requestId,executionId,parents=[],known=false}){
 const ids=[...new Set(parents.filter(id=>id&&id!==op.msgId))];
 op.message.continuity={version:1,known:known&&ids.length<=1000,...(requestId?{requestId}:{}),...(executionId?{executionId}:{}),dependsOnMessageIds:ids.length<=1000?ids:[]};
 op.metadata=envelopeFor(op.message,1);return op;
}
module.exports={annotateOperation};
