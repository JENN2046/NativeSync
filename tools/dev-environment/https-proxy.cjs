'use strict';
const https=require('node:https'),http=require('node:http'),fs=require('node:fs'),path=require('node:path');const root=path.resolve(__dirname,'..');
https.createServer({key:fs.readFileSync(root+'/config/tls/localhost-key.pem'),cert:fs.readFileSync(root+'/config/tls/localhost-cert.pem')},(req,res)=>{
 const admin=req.url.startsWith('/AdminPanel')||req.url.startsWith('/admin_api');const upstream=http.request({host:'127.0.0.1',port:admin?17651:17650,path:req.url,method:req.method,headers:{...req.headers,'x-forwarded-proto':'https','x-forwarded-host':req.headers.host}},response=>{res.writeHead(response.statusCode,response.headers);response.pipe(res);});upstream.on('error',()=>{res.writeHead(502);res.end('Local service not ready');});req.pipe(upstream);
}).listen(17653,'127.0.0.1',()=>console.log('Local HTTPS ready on loopback:17653'));
