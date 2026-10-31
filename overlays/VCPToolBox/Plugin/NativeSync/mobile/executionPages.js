'use strict';
const fail=(code,status=400)=>Object.assign(Error(code),{code,status});
const attention="(j.state NOT IN ('completed','failed','cancelled') OR (j.review_resolved=0 AND j.error_code LIKE '%REVIEW_REQUIRED') OR EXISTS(SELECT 1 FROM mobile_native_tasks t WHERE t.execution_id=j.id AND (t.state NOT IN ('completed','failed','cancelled','stopped') OR (t.review_required=1 AND t.review_resolved=0))))";
function executionPage(engine,topicKey,sessionId,query={}){
 if(Object.keys(query).some(k=>!['mode','limit','cursor','version'].includes(k))||!['recent','attention'].includes(query.mode||'recent')||(query.version!==undefined&&String(query.version)!=='2')||(query.cursor!==undefined&&(typeof query.cursor!=='string'||query.cursor.length>4096)))throw fail('INVALID_EXECUTION_PAGE');
 const mode=query.mode||'recent',limit=Number(query.limit??64);if(!Number.isSafeInteger(limit)||limit<1||limit>128)throw fail('INVALID_EXECUTION_PAGE');
 let watermark=engine.db.prepare('SELECT coalesce(max(rowid),0) n FROM mobile_executions WHERE topic_key=?').get(topicKey).n,before=watermark+1;
 if(query.cursor){let c;try{c=JSON.parse(Buffer.from(query.cursor,'base64url').toString('utf8'));}catch{throw fail('INVALID_EXECUTION_CURSOR');}
  if(c?.version!==2||c.topicKey!==topicKey||c.mode!==mode||![c.watermark,c.before].every(Number.isSafeInteger)||c.watermark<0||c.before<1||c.before>c.watermark+1||c.watermark>watermark)throw fail('INVALID_EXECUTION_CURSOR');watermark=c.watermark;before=c.before;
 }
 const condition=mode==='attention'?' AND '+attention:'';
 const rows=engine.db.prepare('SELECT j.rowid ordinal,j.* FROM mobile_executions j WHERE j.topic_key=? AND j.rowid<=? AND j.rowid<?'+condition+' ORDER BY j.rowid DESC LIMIT ?').all(topicKey,watermark,before,limit+1);
 const hasMore=rows.length>limit,page=rows.slice(0,limit),next=hasMore?Buffer.from(JSON.stringify({version:2,topicKey,mode,watermark,before:page.at(-1).ordinal})).toString('base64url'):null;
 const total=engine.db.prepare('SELECT count(*) n FROM mobile_executions j WHERE j.topic_key=? AND j.rowid<=?'+condition).get(topicKey,watermark).n;
 return {version:2,topicKey,mode,watermark,observedAt:Date.now(),executions:page.map(r=>engine.public(r,sessionId)),total,hasMore,next};
}
module.exports={executionPage};
