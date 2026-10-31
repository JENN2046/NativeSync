'use strict';
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),http=require('node:http'),{createHash}=require('node:crypto'),{createRequire}=require('node:module');
const [hosts,data,packageRoot]=process.argv.slice(2),box=path.join(hosts,'VCPToolBox'),express=createRequire(path.join(box,'package.json'))('express'),{CentralStore}=require(box+'/Plugin/NativeSync/sync/centralStore'),{MobilePortal}=require(box+'/Plugin/NativeSync/mobile/portal');
(async()=>{
const store=new CentralStore(path.join(data,'static.sqlite')),portal=new MobilePortal({store,agentManager:{isAgent:()=>true},config:{NativeMobileOrigin:'https://synthetic-static.invalid',NativeMobileTopics:JSON.stringify([{key:'static-probe',ownerType:'agent',ownerId:'synthetic',topicId:'static',agentAlias:'synthetic',model:'synthetic'}])}}),app=express();app.set('trust proxy','loopback');app.use('/mobile',portal.router);const server=http.createServer(app);await new Promise(r=>server.listen(0,'127.0.0.1',r));
try{const files=JSON.parse(fs.readFileSync(path.join(packageRoot,'MANIFEST.json'))).files.filter(f=>f.path.includes('/mobile-dist/'));assert.equal(files.length,8);
 for(const file of files){const name=file.path.split('/mobile-dist/')[1],response=await fetch('http://127.0.0.1:'+server.address().port+'/mobile/'+name,{headers:{'X-Forwarded-Proto':'https'}});assert.equal(response.status,200,name);assert.equal(createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex'),file.sha256,name);}
 console.log(JSON.stringify({servedFiles:files.length,defaultPwaPathVerified:true,browserRendering:false,modelCalls:0}));
}finally{await portal.close();store.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
