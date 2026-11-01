'use strict';
const http=require('node:http');let calls=0;
http.createServer(async(req,res)=>{
 if(req.url==='/health'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({mode:'local-synthetic-development',calls}));}
 if(req.url==='/v1/models'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({object:'list',data:[{id:'nativesync-local-stub',object:'model',owned_by:'local-development'}]}));}
 let raw='';for await(const part of req)raw+=part;let body;try{body=JSON.parse(raw);}catch{res.writeHead(400);return res.end('{}');}calls++;
 if(req.url==='/v1/embeddings'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({object:'list',data:(Array.isArray(body.input)?body.input:[body.input]).map((_,i)=>({object:'embedding',index:i,embedding:Array.from({length:3072},(_,n)=>n===0?1:0)})),model:'nativesync-local-embedding',usage:{prompt_tokens:0,total_tokens:0}}));}
 if(req.url!=='/v1/chat/completions'){res.writeHead(404);return res.end('{}');}
 const content='【本地模拟模型】NativeSync 开发请求已收到。此回复由本机测试提供者生成，未调用外部模型。';
 if(body.stream){res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache'});res.write('data: '+JSON.stringify({id:'local-'+calls,object:'chat.completion.chunk',choices:[{index:0,delta:{role:'assistant',content},finish_reason:null}]})+'\n\n');res.write('data: '+JSON.stringify({id:'local-'+calls,object:'chat.completion.chunk',choices:[{index:0,delta:{},finish_reason:'stop'}]})+'\n\n');return res.end('data: [DONE]\n\n');}
 res.setHeader('Content-Type','application/json');res.end(JSON.stringify({id:'local-'+calls,object:'chat.completion',model:'nativesync-local-stub',choices:[{index:0,message:{role:'assistant',content},finish_reason:'stop'}],usage:{prompt_tokens:0,completion_tokens:0,total_tokens:0}}));
}).listen(17652,'127.0.0.1',()=>console.log('Local synthetic provider ready on loopback:17652'));
