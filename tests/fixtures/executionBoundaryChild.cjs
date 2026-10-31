'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),http=require('node:http');
(async()=>{
 const [inputFile,stage]=process.argv.slice(2),input=JSON.parse(await fs.readFile(inputFile,'utf8')),root=path.dirname(inputFile),hosts=process.env.NATIVESYNC_TEST_HOSTS;
 if(!hosts||!root.startsWith(os.tmpdir()+path.sep)||!path.basename(root).startsWith('native-m2m3-')||input.root!==root||![input.dbPath,input.effectFile].every(p=>p.startsWith(root+path.sep))||!['reply-intent','reply-applied','external-effect'].includes(stage))throw Error('ISOLATED_EXECUTION_BOUNDARY_ONLY');
 const box=path.join(hosts,'VCPToolBox'),{CentralStore}=require(box+'/Plugin/NativeSync/sync/centralStore'),{ConversationExecution}=require(box+'/Plugin/NativeSync/mobile/execution'),context=require(box+'/modules/requestExecutionContext');
 const store=new CentralStore(input.dbPath),topic={key:'boundary-topic',ownerType:'agent',ownerId:'one',topicId:'old',agentAlias:'synthetic-one'},engine=new ConversationExecution({store,topics:[topic],agentManager:{isAgent:()=>true},configRequired:true,fault:point=>{if(point===stage)process.exit(78);}});
 const append=async()=>{const handle=await fs.open(input.effectFile,'a',0o600);try{await handle.writeFile('effect\n');await handle.sync();}finally{await handle.close();}};
 if(stage==='external-effect'){
  store.db.prepare("UPDATE mobile_executions SET state='running',attempts=1,request_dispatched=1 WHERE id=?").run(input.jobId);
  context.register(input.jobId,null,engine.nativeTasks.hooks(input.jobId));await context.run(input.jobId,new AbortController().signal,()=>context.runToolInvocation({pluginName:'SyntheticEffect'},async()=>{await append();process.exit(78);}));
 }else {
  const server=http.createServer(async(req,res)=>{for await(const _ of req){}await append();res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:'synthetic committed reply'}}]}));});await new Promise(r=>server.listen(0,'127.0.0.1',r));engine.setEndpoint({url:'http://127.0.0.1:'+server.address().port+'/v1/chat/completions',key:'synthetic-only'});
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
