'use strict';
// Isolated test fixture only: no product route or production fault switch.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),https=require('node:https');
const root=path.resolve(__dirname,'..');
if(JSON.parse(fs.readFileSync(root+'/ISOLATED.json')).kind!=='nativesync-full-local-runtime')throw Error('ISOLATION_REQUIRED');
const control=()=>JSON.parse(fs.readFileSync(root+'/control.json'));
function record(name,value){const fd=fs.openSync(root+'/evidence/'+name,'a',0o600);try{fs.writeSync(fd,JSON.stringify(value)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function calls(){try{return fs.readFileSync(root+'/evidence/provider.jsonl','utf8').trim().split('\n').filter(Boolean).map(JSON.parse);}catch{return [];}}
http.createServer(async(req,res)=>{
 try{
  if(req.url==='/health'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({mode:'isolated-local-scripted',calls:calls().length}));}
  if(req.url==='/v1/models'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({data:['normal','offline','lost-response','reply-intent','reply-applied','effect','aa','startup'].map(n=>({id:'nativesync-'+n,object:'model',owned_by:'local-test'}))}));}
  let raw='';for await(const part of req)raw+=part;const body=JSON.parse(raw);
  if(req.url==='/v1/embeddings'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({data:(Array.isArray(body.input)?body.input:[body.input]).map((_,i)=>({index:i,embedding:Array.from({length:3072},(_,n)=>n===0?1:0)}))}));}
  if(req.url!=='/v1/chat/completions'){res.writeHead(404);return res.end('{}');}
  const previous=calls().filter(r=>r.model===body.model).length;record('provider.jsonl',{model:body.model,ordinal:previous+1,pid:process.pid,at:Date.now()});
  let content='【本地模拟模型】隔离验证回复 '+body.model;
  if(body.model==='nativesync-effect'&&previous===0)content='<<<[TOOL_REQUEST]>>>\ntool_name:「始」IsolatedEffect「末」\n<<<[END_TOOL_REQUEST]>>>';
  if(body.model==='nativesync-aa'&&previous===0)content='<<<[TOOL_REQUEST]>>>\ntool_name:「始」AgentAssistant「末」,\nagent_name:「始」IsolatedAA「末」,\nprompt:「始」Return the isolated read-only report.「末」,\ntask_delegation:「始」true「末」\n<<<[END_TOOL_REQUEST]>>>';
  if(body.model==='nativesync-aa-child')content='ISOLATED_AA_REPORT\n[[Flowlock::Complete]]';
  if(body.stream){res.writeHead(200,{'Content-Type':'text/event-stream'});for(const chunk of [{role:'assistant',content},{}])res.write('data: '+JSON.stringify({id:'isolated-'+Date.now(),object:'chat.completion.chunk',choices:[{index:0,delta:chunk,finish_reason:chunk.content?null:'stop'}]})+'\n\n');return res.end('data: [DONE]\n\n');}
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify({id:'isolated-'+Date.now(),object:'chat.completion',choices:[{index:0,message:{role:'assistant',content},finish_reason:'stop'}]}));
 }catch{res.writeHead(500);res.end('{"error":"ISOLATED_PROVIDER_FAILED"}');}
}).listen(17652,'127.0.0.1');
https.createServer({key:fs.readFileSync(root+'/config/tls/localhost-key.pem'),cert:fs.readFileSync(root+'/config/tls/localhost-cert.pem')},(req,res)=>{
 const c=control();
 if(c.offline&&(req.url.startsWith('/api/v1/sync')||req.url.startsWith('/api/plugins/NativeSync/'))){res.writeHead(503,{'Content-Type':'application/json'});return res.end('{"error":{"code":"ISOLATED_SYNC_OFFLINE"}}');}
 const mobileSubmit=req.method==='POST'&&/^\/mobile\/api\/conversations\/[^/]+\/messages$/.test(req.url);
 const drop=c.dropResponseOnce&&mobileSubmit&&!fs.existsSync(root+'/evidence/lost-response.json');
 let requestBody='';if(mobileSubmit)req.on('data',b=>{requestBody+=b;});
 const upstream=http.request({host:'127.0.0.1',port:req.url.startsWith('/AdminPanel')||req.url.startsWith('/admin_api')?17651:17650,path:req.url,method:req.method,headers:{...req.headers,'x-forwarded-proto':'https','x-forwarded-host':req.headers.host}},response=>{
  if(drop&&response.statusCode===202){let body='';response.on('data',b=>{body+=b;});response.on('end',()=>{const accepted=JSON.parse(body);fs.writeFileSync(root+'/evidence/lost-response.json',JSON.stringify({requestId:JSON.parse(requestBody).requestId,executionId:accepted.id}));res.destroy();});return;}
  res.writeHead(response.statusCode,response.headers);response.pipe(res);
 });upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end('Isolated backend unavailable');});req.pipe(upstream);
}).listen(17653,'127.0.0.1');
