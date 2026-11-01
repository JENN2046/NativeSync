'use strict';
// Temporary local test boundary. Never installed as a product management API.
const http=require('node:http'),https=require('node:https'),fs=require('node:fs'),net=require('node:net'),path=require('node:path');
function mobilePath(raw){
 if(typeof raw!=='string'||!raw.startsWith('/mobile/'))return false;
 const pathname=raw.split('?')[0];if(!/^\/[A-Za-z0-9_./-]*$/.test(pathname)||pathname.includes('//')||pathname.split('/').some(p=>p==='.'||p==='..'))return false;
 return !/^\/mobile\/api\/connection\/(authenticate|test)(?:\/|$)/i.test(pathname);
}
function sameNetwork(peer,address,prefix){
 peer=peer?.replace(/^::ffff:/,'');if(net.isIP(peer)!==4)return false;
 const number=s=>s.split('.').reduce((n,p)=>(n*256+Number(p))>>>0,0),mask=prefix===0?0:(0xffffffff<<(32-prefix))>>>0;return (number(peer)&mask)===(number(address)&mask);
}
function createGateway({config,key,cert,upstreamPort=17650,record=()=>{}}){
 const origin=new URL(config.origin);
 return https.createServer({key,cert},(req,res)=>{
  const done=(status,text)=>{res.writeHead(status,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'});res.end(text);record({method:req.method,path:req.url.split('?')[0],status});};
  if(req.headers.host!==origin.host)return done(421,'Unexpected test host');
  if(!sameNetwork(req.socket.remoteAddress,config.address,config.prefix))return done(403,'Outside test network');
  if(!['GET','POST','HEAD'].includes(req.method)||!mobilePath(req.url))return done(404,'Mobile test route only');
  if(req.headers.authorization||req.headers.upgrade)return done(400,'Cookie pairing only');
  if(req.method==='POST'&&req.headers.origin!==config.origin)return done(403,'Unexpected origin');
  const headers={host:origin.host,'x-forwarded-proto':'https','x-forwarded-host':origin.host,'x-forwarded-for':req.socket.remoteAddress};
  for(const name of ['content-type','content-length','cookie','origin','accept','accept-language','user-agent','x-nativesync-entry-id','x-nativesync-session-marker'])if(req.headers[name]!==undefined)headers[name]=req.headers[name];
  const upstream=http.request({host:'127.0.0.1',port:upstreamPort,path:req.url,method:req.method,headers},response=>{res.writeHead(response.statusCode,response.headers);response.pipe(res);record({method:req.method,path:req.url.split('?')[0],status:response.statusCode,peer:req.socket.remoteAddress});});
  upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end('Local test backend unavailable');});req.on('aborted',()=>upstream.destroy());req.pipe(upstream);
 });
}
module.exports={mobilePath,sameNetwork,createGateway};
if(require.main===module){
 const root=path.resolve(__dirname,'..'),config=JSON.parse(fs.readFileSync(root+'/PHONE.json'));
 if(JSON.parse(fs.readFileSync(root+'/ISOLATED.json')).kind!=='nativesync-full-local-runtime'||config.kind!=='nativesync-android-local-test')throw Error('ISOLATED_PHONE_ROOT_REQUIRED');
 const record=row=>fs.appendFileSync(root+'/evidence/phone-access.jsonl',JSON.stringify({at:Date.now(),...row})+'\n',{mode:0o600});
 const server=createGateway({config,key:fs.readFileSync(root+'/config/phone/server-key.pem'),cert:fs.readFileSync(root+'/config/phone/server-cert.pem'),record});
 const cert=fs.readFileSync(root+'/config/phone/ca.crt');
 const bootstrap=http.createServer((req,res)=>{
  if(req.headers.host!==config.address+':17664'||!sameNetwork(req.socket.remoteAddress,config.address,config.prefix)||req.method!=='GET'){res.writeHead(404);return res.end();}
  record({method:req.method,path:req.url.split('?')[0],status:200,peer:req.socket.remoteAddress,bootstrap:true});
  if(req.url==='/nativesync-phone-ca.crt'){res.writeHead(200,{'Content-Type':'application/x-x509-ca-cert','Content-Disposition':'attachment; filename="NativeSync-Android-Test-CA.crt"','Cache-Control':'no-store'});return res.end(cert);}
  if(req.url!=='/'){res.writeHead(404);return res.end();}
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'",'Referrer-Policy':'no-referrer'});res.end(`<meta name="viewport" content="width=device-width"><h1>NativeSync 本机测试</h1><p>仅合成会话、本机模拟模型。先在电脑对照证书指纹，再安装临时 CA 证书。</p><p><a href="/nativesync-phone-ca.crt">下载测试 CA 证书</a></p><pre style="white-space:pre-wrap">SHA256 ${config.caFingerprint}</pre><p>安装后打开 <a href="${config.origin}/mobile/">HTTPS 测试入口</a>，再扫描电脑上的一次性配对二维码。</p><p>测试结束后移除名为 NativeSync Android Local Test 的用户 CA 证书。</p>`);
 });
 server.listen(17663,config.address);bootstrap.listen(17664,config.address);
 const close=()=>{server.close();bootstrap.close();server.closeAllConnections();bootstrap.closeAllConnections();};
 const expiry=setTimeout(close,Math.max(0,config.expiresAt-Date.now()));expiry.unref();process.on('SIGTERM',()=>{clearTimeout(expiry);close();});
 console.log('Phone test mobile-only gateway ready');
}
