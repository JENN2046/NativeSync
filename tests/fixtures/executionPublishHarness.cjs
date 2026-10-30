// Real NativeSync registration/ExecutionConfigs/acceptance; isolated loopback only.
'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),http=require('node:http'),assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const hosts=process.env.NATIVESYNC_TEST_HOSTS;if(!hosts)throw Error('NATIVESYNC_TEST_HOSTS_REQUIRED');
const BOX=path.join(hosts,'VCPToolBox'),CHAT=path.join(hosts,'VCPChat');
const express=require('node:module').createRequire(BOX+'/package.json')('express');
const plugin=require(BOX+'/Plugin/NativeSync/native-sync');
const {createSyncRequest}=require(CHAT+'/modules/services/nativeSync/runtime');
const {publishExecutionConfigs}=require(CHAT+'/modules/services/nativeSync/executionConfigs');
const descriptors=Array.from({length:8},(_,i)=>({itemType:'agent',itemId:'a'+i,topicId:'t'+i})).concat({itemType:'group',itemId:'g',topicId:'tg'});
const tuple=t=>({ownerType:t.itemType,ownerId:t.itemId,topicId:t.topicId});
const bindings=descriptors.map((t,i)=>({key:'topic'+i,...tuple(t),...(t.itemType==='group'?{memberAliases:{a0:'alias0',a1:'alias1'}}:{agentAlias:'alias'+i})}));
bindings.push({key:'unprepared',ownerType:'agent',ownerId:'unprepared',topicId:'u',agentAlias:'alias0'});
async function fixture({root,timeout=250,seed=true}={}){
 const owned=!root;root=root||await fs.mkdtemp(path.join(os.tmpdir(),'nativesync-config-publish-'));await fs.mkdir(root,{recursive:true});
 plugin.setMobileHostAuthority({agentManager:{isAgent:a=>/^alias[0-7]$/.test(a),getAgentPrompt:async a=>'frozen '+a},verifyKey:async()=>true});
 await plugin.initialize({NativeSyncEnabled:true,NativeSyncDataDir:root,NativeMobileEnabled:true,NativeMobileConfigSync:true,NativeMobileOrigin:'https://synthetic.invalid',NativeMobileTopics:JSON.stringify(bindings),NativeSyncFullSources:JSON.stringify([{sourceId:'synthetic-config-source',deviceId:'synthetic-config-device',scope:{mode:'limited',topics:bindings.map(({ownerType,ownerId,topicId})=>({ownerType,ownerId,topicId}))}}])});
 const db=new DatabaseSync(path.join(root,'central.sqlite')),fault={mode:null,posts:0,requests:[],processed:0};
 const app=express();app.set('trust proxy','loopback');
 app.use('/mobile',plugin.handleMobile);
 const router=express.Router();
 router.use((req,res,next)=>req.headers.authorization==='Bearer synthetic-only'?next():res.status(401).json({error:{code:'UNAUTHORIZED'}}));
 // Same parser limit as the supplied public server.js, not a raised product limit.
 router.use(express.json({limit:'300mb'}));
 router.use((req,res,next)=>{
  if(req.method==='POST'&&req.path==='/mobile/execution-configs'){
   fault.posts++;fault.requests.push({bytes:Buffer.byteLength(JSON.stringify(req.body)),rows:req.body.topics.map(r=>r.topicId)});
   const mode=fault.posts===2?fault.mode:null;
   if(mode==='reject')return res.status(503).json({error:{code:'SYNTHETIC_SECOND_BATCH_REJECTED'}});
   if(mode==='timeout')return;
   const json=res.json.bind(res);res.json=value=>{
    if(!value.error)fault.processed++;
    if(mode==='drop')return res.socket.destroy();
    if(mode==='exit')process.exit(78);
    return json(value);
   };
  }
  next();
 });
 plugin.registerApiRoutes(router);app.use('/api/plugins/NativeSync',router);
 app.use((e,req,res,next)=>res.status(e.status||400).json({error:{code:e.code||'SYNTHETIC_HTTP_ERROR'}}));
 const server=http.createServer(app);await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const url='http://127.0.0.1:'+server.address().port;
 const send=createSyncRequest({url,token:'synthetic-only'},timeout);
 const config=(id,prompt='v1')=>({name:id,systemPrompt:prompt,model:'synthetic-model',temperature:0.5,contextTokenLimit:12000,maxOutputTokens:1024,streamOutput:false,topics:[{id:'t'+id.slice(1)}]});
 let prompts=Object.fromEntries(Array.from({length:8},(_,i)=>['a'+i,'v1']));
 const group={id:'g',name:'Synthetic Group',topics:[{id:'tg'}],members:['a0','a1'],mode:'sequential',modeSettings:{sequential:{speakerOrder:['a1','a0']}},groupPrompt:'synthetic group',createdAt:1};
 const publish=(topics=descriptors)=>publishExecutionConfigs({topics,readAgentConfig:async id=>config(id,prompts[id]),readGroupConfig:async()=>group,send});
 const f={plugin,root,db,send,fault,descriptors,config,publish,setPrompt:(id,p)=>{prompts[id]=p;},resetFault:mode=>{fault.mode=mode;fault.posts=0;fault.requests=[];fault.processed=0;},
  rows:()=>db.prepare('SELECT topic_key,version,hash,config_json FROM owner_execution_configs ORDER BY topic_key,version').all(),
  latest:key=>db.prepare('SELECT * FROM owner_execution_configs WHERE topic_key=? ORDER BY version DESC LIMIT 1').get(key),
  snapshot:()=>({configs:db.prepare('SELECT * FROM owner_execution_configs ORDER BY topic_key,version').all(),jobs:db.prepare('SELECT * FROM mobile_executions ORDER BY id').all(),journal:db.prepare('SELECT * FROM journal ORDER BY seq').all()}),
  close:async({remove=owned}={})=>{await plugin.shutdown();server.closeAllConnections();await new Promise(r=>server.close(r));db.close();if(remove)await fs.rm(root,{recursive:true,force:true});}};
 const headers={'X-Forwarded-Proto':'https',Origin:'https://synthetic.invalid','Content-Type':'application/json'};
 f.phone=async()=>{
  const pairing=await send('/api/plugins/NativeSync/mobile/pairing',{body:{}});
  const paired=await fetch(url+'/mobile/api/pair',{method:'POST',headers,body:JSON.stringify({code:pairing.pairingCode})});assert.equal(paired.status,200);const cookie=paired.headers.get('set-cookie').split(';')[0];
  return async(route,body)=>{const res=await fetch(url+'/mobile/api'+route,{method:body?'POST':'GET',headers:{...headers,Cookie:cookie},body:body?JSON.stringify(body):undefined});return {status:res.status,body:await res.json()};};
 };
 if(seed){await publish();f.resetFault(null);}return f;
}
module.exports={fixture,bindings,descriptors,tuple,publishExecutionConfigs,BOX,CHAT};
