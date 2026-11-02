'use strict';
// Independent local provider/proxy. All durable observations are synthetic.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),https=require('node:https');
const root=path.resolve(process.argv[2]),cfg=JSON.parse(fs.readFileSync(root+'/private.json'));
if(JSON.parse(fs.readFileSync(root+'/ISOLATED.json')).kind!=='nativesync-production-public-fixture')throw Error('ISOLATION_REQUIRED');
http.createServer(async(req,res)=>{
 if(req.url==='/v1/models'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({data:[{id:'nativesync-prod-stub',object:'model'}]}));}
 if(req.url==='/health')return res.end('{"kind":"synthetic-only"}');
 let text='';for await(const chunk of req)text+=chunk;
 if(req.url!=='/v1/chat/completions'){res.writeHead(404);return res.end('{}');}
 const body=JSON.parse(text);if(body.model!=='nativesync-prod-stub'){res.writeHead(400);return res.end('{}');}
 const file=root+'/evidence/model-calls.jsonl';let prior=[];try{prior=fs.readFileSync(file,'utf8').trim().split('\n').filter(Boolean);}catch{}
 const content=JSON.stringify(body.messages),ordinal=prior.length+1;
 const record={ordinal,model:body.model,aliasFrozen:content.includes('SYNTHETIC_NATIVE_ALIAS_CONTEXT'),latestHistoryPresent:content.includes('SYNTHETIC_LEGACY_V2'),previousReplyPresent:ordinal===1||content.includes('SYNTHETIC_PROD_REPLY_'+(ordinal-1)),temperature:body.temperature,maxTokens:body.max_tokens};
 const fd=fs.openSync(file,'a',0o600);try{fs.writeSync(fd,JSON.stringify(record)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 const message='SYNTHETIC_PROD_REPLY_'+ordinal;
 if(body.stream){res.writeHead(200,{'Content-Type':'text/event-stream'});res.end('data: '+JSON.stringify({choices:[{delta:{role:'assistant',content:message},finish_reason:null}]})+'\n\ndata: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');}
 else{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{role:'assistant',content:message},finish_reason:'stop'}]}));}
}).listen(cfg.providerPort,'127.0.0.1');
https.createServer({key:fs.readFileSync(root+'/tls/key.pem'),cert:fs.readFileSync(root+'/tls/cert.pem')},(req,res)=>{
 const upstream=http.request({host:'127.0.0.1',port:cfg.backendPort,path:req.url,method:req.method,headers:{...req.headers,'x-forwarded-proto':'https','x-forwarded-host':req.headers.host}},response=>{res.writeHead(response.statusCode,response.headers);response.pipe(res);});
 upstream.on('error',()=>{if(!res.headersSent)res.writeHead(503);res.end();});req.pipe(upstream);
}).listen(cfg.proxyPort,'127.0.0.1');
