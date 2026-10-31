'use strict';
// Separate process per installed version, so module caches cannot fake rollback.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const [hosts,data,stage]=process.argv.slice(2);assert.ok(['seed','candidate','rollback'].includes(stage));fs.mkdirSync(data,{recursive:true});
const {CentralStore}=require(path.join(hosts,'VCPToolBox/Plugin/NativeSync/sync/centralStore')),{ConversationExecution}=require(path.join(hosts,'VCPToolBox/Plugin/NativeSync/mobile/execution'));
const store=new CentralStore(path.join(data,'central.sqlite')),topic={key:'release-probe',ownerType:'agent',ownerId:'synthetic',topicId:'probe',agentAlias:'synthetic',model:'synthetic'},engine=new ConversationExecution({store,topics:[topic],agentManager:{isAgent:()=>true}});
const operation={ownerType:'agent',ownerId:'synthetic',topicId:'probe',msgId:'preserved-message',deviceId:'synthetic-release',opId:'preserved-op',baseHash:null,action:'upsert',message:{id:'preserved-message',role:'user',content:'synthetic preserved content',timestamp:1}};
(async()=>{const original=store.apply(operation);let job;
if(stage==='seed'){
 job=engine.accept('synthetic-session',{topicKey:'release-probe',requestId:'preserved-request',text:'synthetic accepted turn'});store.db.prepare("UPDATE mobile_executions SET state='review_required',attempts=1,tool_started=1,request_dispatched=1,error_code='EXECUTION_INTERRUPTED_REVIEW_REQUIRED' WHERE id=?").run(job.id);
 fs.writeFileSync(path.join(data,'original.json'),JSON.stringify({original,jobId:job.id}));fs.writeFileSync(path.join(data,'desktop-state-v3.json'),JSON.stringify({version:3,format:'native-message-intents-v2',deviceId:'synthetic-device',cursor:original.seq,acceptedIdentity:'preserve-byte-for-byte'}));
}else{
 const prior=JSON.parse(fs.readFileSync(path.join(data,'original.json')));assert.equal(original.seq,prior.original.seq);assert.equal(original.hash,prior.original.hash);assert.equal(original.replayed,true);job=engine.get(prior.jobId);assert.equal(job.request_id,'preserved-request');assert.equal(job.attempts,1);assert.equal(job.state,'review_required');assert.ok(engine.dependencyHeld('release-probe'));assert.equal(engine.inFlight.size,0);
 if(stage==='candidate')store.apply({...operation,msgId:'candidate-message',opId:'candidate-op',message:{...operation.message,id:'candidate-message',content:'written after upgrade'}});
 else{assert.ok(store.pull(0).events.some(e=>e.msgId==='candidate-message'));store.apply({...operation,msgId:'rollback-message',opId:'rollback-op',message:{...operation.message,id:'rollback-message',content:'new write after code rollback'}});}
}
const row=engine.get(job.id),out={stage,originalSeq:original.seq,jobId:job.id,attempts:row.attempts,state:row.state,toolStarted:row.tool_started,modelEndpoint:engine.endpoint,automaticDispatches:engine.inFlight.size,journalRows:store.metrics().journalRows,jsonTriggers:store.db.prepare("SELECT count(*) n FROM sqlite_master WHERE type='trigger' AND name LIKE 'nativesync_json_%'").get().n};await engine.close();store.close();console.log(JSON.stringify(out));})().catch(e=>{console.error(e);process.exitCode=1;});
