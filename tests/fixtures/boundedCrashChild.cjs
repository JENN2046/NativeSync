// Real subprocess exits; never used against production paths.
'use strict';
const fs=require('node:fs/promises'),path=require('node:path');
const HOSTS=process.env.NATIVESYNC_TEST_HOSTS;if(!HOSTS)throw Error('NATIVESYNC_TEST_HOSTS_REQUIRED');
const CHAT=path.join(HOSTS,'VCPChat');
const {HistoryMutationQueue}=require(CHAT+'/modules/services/historyMutationQueue'),{NativeSyncAdapter}=require(CHAT+'/modules/services/nativeSync/adapter'),{SourceSync}=require(CHAT+'/modules/services/nativeSync/sourceSync'),{createSyncRequest}=require(CHAT+'/modules/services/nativeSync/runtime');
(async()=>{
 const spec=JSON.parse(await fs.readFile(process.argv[2],'utf8'));if(!spec.app.startsWith(require('node:os').tmpdir()+path.sep+'native-m2m3-'))throw Error('TEMP_FIXTURE_REQUIRED');
 const connection=spec.connection;if(new URL(connection.url).hostname!=='127.0.0.1')throw Error('LOOPBACK_REQUIRED');
 const queue=new HistoryMutationQueue({userDataDir:path.join(spec.app,'UserData'),logger:{warn(){}}}),statePath=path.join(spec.app,'.native-sync/state.json'),state=JSON.parse(await fs.readFile(statePath,'utf8')),send=createSyncRequest(connection);
 const adapter=await NativeSyncAdapter.open({queue,statePath,...connection,topics:state.topics,source:state.source,request:send});
 const sync=await new SourceSync({adapter,connection,appDataRoot:spec.app,readAgentConfig:id=>fs.readFile(path.join(spec.app,'Agents',id,'config.json'),'utf8').then(JSON.parse),readGroupConfig:id=>fs.readFile(path.join(spec.app,'AgentGroups',id,'config.json'),'utf8').then(JSON.parse),send,fault:async(stage,detail)=>{if(stage===spec.stage){await fs.writeFile(spec.receipt,JSON.stringify({stage,pid:process.pid,...detail}));process.exit(73);}}}).open();
 if(spec.stage==='local-committed'){await queue.mutate(spec.topic,rows=>[...rows,{id:'child-offline',role:'user',content:'synthetic child commit',timestamp:1}]);await fs.writeFile(spec.receipt,JSON.stringify({stage:spec.stage,pid:process.pid,opIds:adapter.state.outbox.map(o=>o.opId)}));process.exit(74);}
 await sync.discover();for(let i=0;i<60;i++){await sync.tick();await adapter.synchronize();}throw Error('FAULT_NOT_REACHED');
})().catch(e=>{console.error(e.code||e.message);process.exitCode=1;});
