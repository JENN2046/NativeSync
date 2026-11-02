'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const box=path.join(process.env.NATIVESYNC_TEST_HOSTS,'VCPToolBox/Plugin/NativeSync');
const {ExecutionConfigs}=require(box+'/mobile/executionConfigs');
const {stable,sha256}=require(box+'/sync/protocol');
function fixture(t,{source=true,prompt='Portable native prompt'}={}){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 const topic={key:'topic',ownerType:'agent',ownerId:'owner',topicId:'history',agentAlias:'Native',...(source?{sourceId:'source'}:{})};
 const catalog=source?{spaceId:'space',grants:new Map([['source',{deviceId:'device',executionMode:'all-supported'}]]),activeTopic:()=>({}),entity:()=>({deleted:0})}:null;
 if(catalog)db.exec('CREATE TABLE native_sync_metadata(key TEXT PRIMARY KEY,value TEXT)');
 const configs=new ExecutionConfigs(db,[topic],{isAgent:a=>a==='Native',getAgentPrompt:async()=>prompt},true,catalog);
 return {db,topic,configs,input:{name:'Native',systemPrompt:'{{agent:Native}}',model:'synthetic-model'}};
}
test('source native alias expansion rejects desktop workspace before accepting a snapshot',async t=>{
 const f=fixture(t,{prompt:'Expanded {{VCPChatWorkSpace:private}}'});
 await assert.rejects(f.configs.publish({topics:[{ownerType:'agent',ownerId:'owner',topicId:'history',expectedVersion:0,config:f.input}]}),{code:'DESKTOP_CONTEXT_REQUIRED'});
 assert.equal(f.db.prepare('SELECT count(*) n FROM owner_execution_configs').get().n,0);
 assert.equal(f.configs.public('topic').configError,'DESKTOP_CONTEXT_REQUIRED');
});
test('already accepted source snapshot is unavailable when its expanded prompt needs desktop context',async t=>{
 const f=fixture(t),config=await f.configs.normalize(f.topic,f.input);config.systemPrompt='Expanded {{VCPChatCanvas}}';
 const hash=sha256(stable(config));f.db.prepare('INSERT INTO owner_execution_configs VALUES(?,?,?,?,?)').run('topic',1,hash,JSON.stringify(config),1);
 assert.throws(()=>f.configs.snapshot(f.topic),{code:'DESKTOP_CONTEXT_REQUIRED'});
 assert.throws(()=>f.configs.assertRunnable(f.topic,{version:1,hash,...config}),{code:'DESKTOP_CONTEXT_REQUIRED'});
});
test('portable source alias continues to freeze and verify its native prompt',async t=>{
 const f=fixture(t);await f.configs.publish({topics:[{ownerType:'agent',ownerId:'owner',topicId:'history',expectedVersion:0,config:f.input}]});
 const snapshot=f.configs.snapshot(f.topic);assert.equal(snapshot.systemPrompt,'Portable native prompt');assert.equal(snapshot.promptPolicy,'native-alias-snapshot');f.configs.assertRunnable(f.topic,snapshot);
});
test('source group rejects desktop-dependent native member expansion',async t=>{
 const f=fixture(t,{prompt:'Expanded {{VCPChatWorkSpace}}'}),group={...f.topic,ownerType:'group',ownerId:'group',memberAliases:{owner:'Native'}};
 await assert.rejects(f.configs.normalize(group,{group:{name:'Group',members:['owner'],mode:'sequential'},agents:[{id:'owner',...f.input}]}),{code:'DESKTOP_CONTEXT_REQUIRED'});
});
test('selected legacy alias retains its existing context policy',async t=>{
 const f=fixture(t,{source:false,prompt:'Legacy {{VCPChatWorkSpace}}'}),config=await f.configs.normalize(f.topic,f.input);
 assert.equal(config.systemPrompt,'Legacy {{VCPChatWorkSpace}}');assert.equal(config.authority,undefined);
});
