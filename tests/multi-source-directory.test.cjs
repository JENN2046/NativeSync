'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {fixture,SourceCatalog}=require('./fixtures/boundedSourceHarness.cjs');
async function sources(t){
 const f=await fixture(t,{scope:{mode:'full'},executionMode:'all-supported'});await f.adopt();await f.pump();
 const grants=[...f.store.sourceCatalog.grants.values()].map(g=>({...g,label:'Windows fixture'}));grants.push({sourceId:'sourceB',deviceId:'deviceB',label:'Linux fixture',executionMode:'all-supported'});
 const catalog=new SourceCatalog(f.store,{NativeSyncFullSources:JSON.stringify(grants),NativeMobileTopics:JSON.stringify(f.portal.staticTopics)});f.store.sourceCatalog=catalog;f.portal.sourceCatalog=catalog;f.portal.engine.configs.sourceCatalog=catalog;
 const binding={sourceId:'sourceB',deviceId:'deviceB',spaceId:catalog.spaceId};
 const publish=(sourceId,ownerId,topicId,{owner=false}={})=>{const b=sourceId==='sourceB'?binding:{sourceId:'sourceA',deviceId:'deviceA',spaceId:catalog.spaceId};catalog.publish(b,{opId:randomUUID(),baseRevision:catalog.revision(sourceId),agents:owner?[{ownerType:'agent',ownerId,name:'one'}]:[],topics:[{ownerType:'agent',ownerId,topicId,name:topicId,sourceState:'available'}],removed:[]});const base=catalog.beginBaseline(b,{planId:randomUUID(),ownerType:'agent',ownerId,topicId});catalog.completeBaseline(b,base.id);f.portal.refreshDirectoryTopics();return f.portal.topics.find(t=>t.sourceId===sourceId&&t.ownerId===ownerId&&t.topicId===topicId);};
 const topicB=publish('sourceB','linux-one','first',{owner:true});
 const pair=async options=>{const code=f.portal.createPairing(options),headers={'X-Forwarded-Proto':'https',Origin:'https://synthetic-mobile.invalid','Content-Type':'application/json'},r=await fetch(f.connection.url+'/mobile/api/pair',{method:'POST',headers,body:JSON.stringify({code:code.pairingCode})});assert.equal(r.status,200);const cookie=r.headers.get('set-cookie').split(';')[0];return{cookie,call:async(route,body)=>{const r=await fetch(f.connection.url+'/mobile/api'+route,{method:body?'POST':'GET',headers:{...headers,Cookie:cookie},body:body?JSON.stringify(body):undefined});const v=await r.json();assert.equal(r.status,200);return v;}};};
 return Object.assign(f,{catalog,binding,publish,topicB,pair});
}

test('explicit mixed-source pairing freezes one source, follows another, and preserves old sessions and identities',async t=>{
 const f=await sources(t),old=await f.pair({scopeMode:'source',sourceId:'sourceA',snapshot:true}),before=f.store.db.prepare('SELECT * FROM mobile_sessions ORDER BY id').all(),oldTopics=(await old.call('/directory?kind=topics')).topics,grants=JSON.stringify([...f.catalog.grants]);
 const combined=await f.pair({scopeMode:'sources',sources:[{sourceId:'sourceA',snapshot:true},{sourceId:'sourceB',snapshot:false}]}),first=await combined.call('/directory?kind=topics');assert.equal(first.topics.length,oldTopics.length+1);assert.equal(first.topics.find(t=>t.key===f.topicB.key).sourceLabel,'Linux fixture');assert.ok(first.topics.filter(t=>t.sourceId==='sourceA').every(t=>t.sourceLabel==='Windows fixture'));
 const agents=(await combined.call('/directory?kind=agents')).agents.filter(a=>a.name==='one');assert.equal(agents.length,2);assert.equal(new Set(agents.map(a=>a.id)).size,2);
 f.publish('sourceA','one','future-windows');f.publish('sourceB','linux-one','future-linux');const next=(await combined.call('/directory?kind=topics')).topics;assert.ok(next.some(t=>t.topicId==='future-linux'));assert.ok(!next.some(t=>t.topicId==='future-windows'));assert.equal((await old.call('/directory?kind=topics')).topics.length,oldTopics.length);
 for(const row of before)assert.deepEqual(f.store.db.prepare('SELECT * FROM mobile_sessions WHERE id=?').get(row.id),row);
 assert.equal(JSON.stringify([...f.catalog.grants]),grants);
 assert.equal(f.store.db.prepare('SELECT count(*) n FROM mobile_executions').get().n,1);
});

test('multi-source pairing refuses unknown sources, duplicates, implicit future grants and scoped cross-source escalation',async t=>{
 const f=await sources(t),options={scopeMode:'sources',sources:[{sourceId:'sourceA',snapshot:true},{sourceId:'sourceB',snapshot:false}]},count=()=>f.store.db.prepare('SELECT count(*) n FROM mobile_pairings').get().n,before=count();
 assert.throws(()=>f.portal.createPairing({...options,sources:[{sourceId:'unknown',snapshot:false}]}),{code:'SOURCE_NOT_APPROVED'});
 for(const invalid of [[],null,{...options,sources:[{sourceId:'sourceA'}]},{...options,sources:[options.sources[0],options.sources[0]]},{...options,sourceId:'sourceA'},{...options,snapshot:true},{...options,sources:[]},{scopeMode:'source',sourceId:'sourceA',sources:options.sources}])assert.throws(()=>f.portal.createPairing(invalid),{code:'INVALID_PAIRING_SCOPE'});
 assert.throws(()=>f.portal.createPairing(options,{topics:[],source:{sourceId:'sourceA'}}),{code:'SOURCE_SCOPE_MISMATCH'});assert.equal(count(),before);
 const p=f.portal.createPairing({scopeMode:'sources',sources:[{sourceId:'sourceA',snapshot:true}]},{topics:[],source:{sourceId:'sourceA'}});assert.ok(p.pairingCode);
 assert.equal(f.portal.connection.information().capabilities.multiSourcePairing,true);
});

module.exports={sources};

test('Chrome source filters separate same-name agents and retain per-topic drafts without submitting', {skip:!process.env.NATIVESYNC_PWA_DIST},async t=>{
 const f=await sources(t),fs=require('node:fs/promises'),path=require('node:path'),https=require('node:https'),http=require('node:http'),crypto=require('node:crypto'),{execFileSync}=require('node:child_process');
 for(const topic of f.portal.topics)await f.portal.engine.configs.publish({topics:[{ownerType:topic.ownerType,ownerId:topic.ownerId,topicId:topic.topicId,expectedVersion:f.portal.engine.configs.public(topic.key).configVersion||0,config:{name:'one',systemPrompt:'SYNTHETIC_PORTABLE',model:'synthetic-model'}}]});
 const session=await f.pair({scopeMode:'sources',sources:[{sourceId:'sourceA',snapshot:true},{sourceId:'sourceB',snapshot:false}]}),cert=path.join(f.root,'test-cert.pem'),key=path.join(f.root,'test-key.pem');execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=localhost'],{stdio:'ignore'});
 const pair={cert:await fs.readFile(cert),key:await fs.readFile(key)},spki=crypto.createHash('sha256').update(new crypto.X509Certificate(pair.cert).publicKey.export({type:'spki',format:'der'})).digest('base64');let messagePosts=0;
 const proxy=https.createServer(pair,(req,res)=>{if(req.method==='POST'&&/\/messages$/.test(req.url))messagePosts++;const remote=http.request(f.connection.url+req.url,{method:req.method,headers:{...req.headers,'x-forwarded-proto':'https',origin:'https://synthetic-mobile.invalid'}},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res);});remote.on('error',()=>{res.statusCode=502;res.end();});req.pipe(remote);});await new Promise(r=>proxy.listen(0,'127.0.0.1',r));
 const puppeteer=require(process.env.NATIVESYNC_PUPPETEER),browser=await puppeteer.launch({executablePath:'/opt/google/chrome/chrome',headless:true,userDataDir:path.join(f.root,'browser'),args:['--ignore-certificate-errors-spki-list='+spki,'--disable-background-networking','--no-first-run']});
 f.cleanups.push(async()=>{await browser.close();proxy.closeAllConnections();await new Promise(r=>proxy.close(r));});
 const page=await browser.newPage();await page.setViewport({width:390,height:844,isMobile:true,hasTouch:true,deviceScaleFactor:1});const origin='https://127.0.0.1:'+proxy.address().port,[cookieName,...value]=session.cookie.split('=');await page.setCookie({name:cookieName,value:value.join('='),domain:'127.0.0.1',path:'/mobile',secure:true,httpOnly:true,sameSite:'Strict'});await page.goto(origin+'/mobile/',{waitUntil:'networkidle0'});await page.waitForSelector('#source-select');
 const labels=await page.$$eval('#agent-select option',rows=>rows.map(r=>r.textContent));assert.equal(labels.filter(s=>s.startsWith('one')).length,2);assert.ok(labels.some(s=>s.includes('Windows fixture')));assert.ok(labels.some(s=>s.includes('Linux fixture')));
 const topicA=f.portal.topics.find(t=>t.sourceId==='sourceA'&&t.ownerId==='one'&&t.topicId==='old');
 const chooseA=async()=>{await page.select('#source-select','sourceA');await page.select('#agent-select',JSON.stringify(['agent','one']));await page.select('#topic-select',topicA.key);await page.waitForFunction(key=>document.querySelector('#topic-select')?.value===key&&!document.querySelector('textarea')?.disabled,{},topicA.key);};
 await chooseA();await page.type('textarea','DRAFT_WINDOWS');await page.select('#source-select','sourceB');await page.waitForFunction(key=>document.querySelector('#topic-select')?.value===key&&!document.querySelector('textarea')?.disabled,{},f.topicB.key);assert.equal(await page.$eval('textarea',e=>e.value),'');await page.type('textarea','DRAFT_LINUX');
 await chooseA();await page.waitForFunction(()=>document.querySelector('textarea')?.value==='DRAFT_WINDOWS');await page.select('#source-select','sourceB');await page.waitForFunction(()=>document.querySelector('textarea')?.value==='DRAFT_LINUX');assert.equal(messagePosts,0);assert.equal(f.store.db.prepare('SELECT count(*) n FROM mobile_executions').get().n,1);
 if(process.env.NATIVESYNC_BROWSER_EVIDENCE){await page.screenshot({path:process.env.NATIVESYNC_BROWSER_EVIDENCE,fullPage:true});}
});
