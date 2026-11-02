'use strict';
// Real host HTTP routes, source-limited legacy wire client, and actual Chrome PWA.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const root=path.resolve(process.argv[2]),stage=process.argv[3],cfg=JSON.parse(fs.readFileSync(root+'/private.json')),box=root+'/host';
const {scopeHash}=require(box+'/Plugin/NativeSync/sync/sourceScope'),{messageHash}=require(box+'/Plugin/NativeSync/sync/protocol');
const raw='http://127.0.0.1:'+cfg.backendPort,origin='https://127.0.0.1:'+cfg.proxyPort;
const adminHeaders={Authorization:'Bearer '+cfg.key,'Content-Type':'application/json','X-NativeSync-Protocol':'2','X-NativeSync-Capabilities':'message-intents-v1,attachments-v1'};
let state={};try{state=JSON.parse(fs.readFileSync(root+'/client-state.json'));}catch{}
const writeState=()=>fs.writeFileSync(root+'/client-state.json',JSON.stringify(state,null,2)+'\n',{mode:0o600});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label){const deadline=Date.now()+35000;for(;;){const value=await fn();if(value)return value;if(Date.now()>deadline)throw Error(label);await wait(100);}}
async function call(url,body,headers=adminHeaders,status=200){const response=await fetch(raw+url,{headers,method:body===undefined?'GET':'POST',body:body===undefined?undefined:JSON.stringify(body)});const value=await response.json();assert.equal(response.status,status,JSON.stringify(value));return value;}
const topic={ownerType:'agent',ownerId:'synthetic-owner',topicId:'legacy-a'};
(async()=>{
 const scopeHeaders={...adminHeaders,'X-NativeSync-Source':cfg.source.sourceId,'X-NativeSync-Device':cfg.source.deviceId,'X-NativeSync-Scope':scopeHash(cfg.source.scope)};
 const info=await call('/api/v1/sync/source/info?'+new URLSearchParams({sourceId:cfg.source.sourceId,deviceId:cfg.source.deviceId}),undefined,scopeHeaders);
 assert.deepEqual(info.scope,cfg.source.scope);assert.ok(info.executionMode===undefined||info.executionMode==='selected');
 if(state.spaceId)assert.equal(info.spaceId,state.spaceId);state.spaceId=info.spaceId;
 const sourceHeaders={...scopeHeaders,'X-NativeSync-Space':state.spaceId};
 if(stage==='old'&&!state.seeded){
  await call('/api/v1/sync/source/catalog',{opId:'synthetic-catalog',baseRevision:0,agents:[{ownerType:'agent',ownerId:'synthetic-owner',name:'Synthetic production source'}],topics:cfg.source.scope.topics.map(t=>({...t,name:t.topicId,sourceState:'available',previouslyAttached:t.topicId==='legacy-a'})),removed:[]},sourceHeaders);
  const baseline=await call('/api/v1/sync/source/baselines',{planId:'synthetic-plan-b',...topic,topicId:'legacy-b'},sourceHeaders);
  await call('/api/v1/sync/source/baselines/'+baseline.id+'/complete',{},sourceHeaders);
  state.operation={...topic,msgId:'legacy-message',deviceId:cfg.source.deviceId,opId:'legacy-operation-1',action:'upsert',baseHash:null,message:{id:'legacy-message',role:'user',content:'SYNTHETIC_LEGACY_V1',timestamp:1}};
  state.original=await call('/api/v1/sync/source/push',state.operation,sourceHeaders);
  state.updated=await call('/api/v1/sync/source/push',{...state.operation,opId:'legacy-operation-2',baseHash:state.original.hash,message:{...state.operation.message,content:'SYNTHETIC_LEGACY_V2'}},sourceHeaders);
  await call('/api/plugins/NativeSync/mobile/execution-configs',{topics:[{...topic,expectedVersion:0,config:{name:'Synthetic continuation',systemPrompt:'{{agent:SyntheticLegacy}}',model:'nativesync-prod-stub',temperature:0.2,maxOutputTokens:128}}]});
  const pair=await call('/api/plugins/NativeSync/mobile/pairing',{scopeMode:'source',sourceId:cfg.source.sourceId});
  const response=await fetch(raw+'/mobile/api/pair',{method:'POST',headers:{'X-Forwarded-Proto':'https',Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({code:pair.pairingCode})});assert.equal(response.status,200);state.cookie=response.headers.get('set-cookie').split(';')[0];state.seeded=true;writeState();
 }
 const replay=await call('/api/v1/sync/source/push',state.operation,sourceHeaders);assert.equal(replay.replayed,true);assert.equal(replay.seq,state.original.seq);assert.equal(replay.hash,state.original.hash);
 await call('/api/v1/sync/source/push',{...state.operation,opId:'must-remain-denied-'+stage,ownerId:'foreign-owner'},sourceHeaders,403);
 const page=await call('/api/v1/sync/source/pull?after_seq=0&limit=100',undefined,sourceHeaders);assert.ok(page.events.some(e=>e.msgId==='legacy-message'&&e.message?.content==='SYNTHETIC_LEGACY_V2'));assert.ok(page.events.every(e=>e.ownerId==='synthetic-owner'));
 state.cursor=page.nextSeq;
 const phoneHeaders={'X-Forwarded-Proto':'https',Origin:origin,'Content-Type':'application/json',Cookie:state.cookie};
 const directory=await call('/mobile/api/directory?kind=topics&limit=100',undefined,phoneHeaders);assert.equal(directory.topics.length,2);
 const conversation=directory.topics.find(t=>t.topicId==='legacy-a');assert.ok(conversation);
 const readJob=async id=>{const view=await call('/mobile/api/conversations/'+conversation.key+'?after=0',undefined,phoneHeaders);const job=view.executions.find(j=>j.id===id);assert.ok(job);return job;};
 const jobIds=state.jobIds||[];
 for(const id of jobIds){const job=await readJob(id);assert.equal(job.state,'completed');assert.equal(job.attempts,1);}
 const callsBefore=(()=>{try{return fs.readFileSync(root+'/evidence/model-calls.jsonl','utf8').trim().split('\n').filter(Boolean).length;}catch{return 0;}})();
 assert.equal(callsBefore,jobIds.length);
 if(stage!=='reinstalled'&&!(state.completedSubmissions||[]).includes(stage)){
  const request={requestId:'synthetic-request-'+stage,text:'SYNTHETIC_EXPLICIT_'+stage};
  const accepted=await call('/mobile/api/conversations/'+conversation.key+'/messages',request,phoneHeaders,202);
  const repeated=await call('/mobile/api/conversations/'+conversation.key+'/messages',request,phoneHeaders,202);assert.equal(repeated.id,accepted.id);
  const finished=await until(async()=>{const job=await readJob(accepted.id);if(['failed','review_required','blocked_config'].includes(job.state))throw Error(job.errorCode||job.state);return job.state==='completed'?job:null;},'EXPLICIT_JOB_NOT_COMPLETED');assert.equal(finished.attempts,1);jobIds.push(finished.id);
  state.jobIds=jobIds;
  state.completedSubmissions=[...(state.completedSubmissions||[]),stage];writeState();
 }
 const calls=fs.readFileSync(root+'/evidence/model-calls.jsonl','utf8').trim().split('\n').filter(Boolean).map(JSON.parse);assert.equal(calls.length,jobIds.length);assert.ok(calls.every(c=>c.aliasFrozen&&c.latestHistoryPresent&&c.previousReplyPresent&&c.temperature===0.2&&c.maxTokens===128));
 const current=await call('/api/v1/sync/source/pull?after_seq='+state.cursor+'&limit=100',undefined,sourceHeaders);state.cursor=current.nextSeq;
 const browserEvidence=await require('./productionBrowser.cjs').verify(root,stage,cfg,state);
 writeState();
 const output={stage,limitedTopics:2,sourceSpacePreserved:true,originalOpSeq:state.original.seq,originalOpHash:state.original.hash,legacyReplayReturnedOriginal:true,foreignPushDenied:true,completedJobs:jobIds,attempts:1,modelCalls:calls.length,cursor:state.cursor,noRePairing:stage!=='old',browser:browserEvidence};fs.writeFileSync(root+'/evidence/flow-'+stage+'.json',JSON.stringify(output,null,2)+'\n');console.log(JSON.stringify(output));
})().catch(e=>{console.error(e.message);process.exitCode=1;});
