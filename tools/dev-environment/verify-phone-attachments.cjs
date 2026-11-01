'use strict';
// Computer browser evidence for the in-page path. Android standalone is a
// separate user-operated acceptance step, never inferred from this result.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const root=path.resolve(process.argv[2]),read=p=>JSON.parse(fs.readFileSync(root+'/'+p)),config=read('PHONE.json'),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const calls=()=>fs.readFileSync(root+'/evidence/provider.jsonl','utf8').trim().split('\n').filter(Boolean).length;
async function until(fn,label){for(let i=0;i<300;i++){const v=await fn();if(v)return v;await new Promise(r=>setTimeout(r,100));}throw Error('TIMEOUT '+label);}
let browser;
(async()=>{
 assert.equal(config.kind,'nativesync-android-local-test');
 const before=calls(),fixtures=read('evidence/phone-files-baseline.json').expectedFiles,history=read('data/chat/UserData/ns-normal/topics/test-topic/history.json'),message=history.find(m=>m.role==='user'&&fixtures.every(f=>m.attachments?.some(a=>a.name===f.name&&a.hash===f.sha256)));assert(message,'Synthetic phone attachments required');
 const key=read('config/local-credentials.json').serverKey,scope=Buffer.from(JSON.stringify([['agent','ns-normal','test-topic']])).toString('base64url');
 const grant=await(await fetch('http://127.0.0.1:17650/api/plugins/NativeSync/mobile/pairing',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json','X-NativeSync-Topics':scope},body:'{}'})).json();assert(grant.pairingCode);
 const cert=new crypto.X509Certificate(fs.readFileSync(root+'/config/phone/server-cert.pem')),pin=crypto.createHash('sha256').update(cert.publicKey.export({type:'spki',format:'der'})).digest('base64');
 browser=await require(root+'/VCPChat/node_modules/puppeteer').launch({executablePath:'/usr/bin/google-chrome',headless:true,userDataDir:fs.mkdtempSync(root+'/data/attachment-browser-'),args:['--ignore-certificate-errors-spki-list='+pin],defaultViewport:{width:414,height:896,isMobile:true,hasTouch:true}});
 const page=await browser.newPage();await page.goto(config.origin+'/mobile/#pair='+grant.pairingCode,{waitUntil:'networkidle0'});await page.click('#pair-submit');await page.waitForSelector('#message-text');
 const selector=`[data-message-id="${message.id}"] .attachment-open`;await page.waitForSelector(selector);
 const dir=fs.mkdtempSync(root+'/evidence/attachment-downloads-'),monitor=await browser.target().createCDPSession(),downloads=[],progress=new Map();
 monitor.on('Browser.downloadWillBegin',e=>downloads.push({guid:e.guid,name:e.suggestedFilename,blobUrl:e.url.startsWith('blob:')}));monitor.on('Browser.downloadProgress',e=>progress.set(e.guid,e.state));await monitor.send('Browser.setDownloadBehavior',{behavior:'allowAndName',downloadPath:dir,eventsEnabled:true});
 const initialPages=(await browser.pages()).length,checks=[];
 for(const fixture of fixtures){
  const buttons=await page.$$(selector);let clicked=false;for(const button of buttons)if(await button.evaluate((e,name)=>e.textContent===name,fixture.name)){await button.click();clicked=true;break;}assert(clicked);
  await page.waitForSelector('#attachment-save',{visible:true});assert.equal(await page.$eval('#attachment-title',x=>x.textContent),fixture.name);
  if(fixture.name.endsWith('.png'))await page.waitForFunction(()=>{const img=document.querySelector('#attachment-viewer img');return img?.complete&&img.naturalWidth===96&&img.src.startsWith('blob:');});
  else assert.ok(await page.$eval('#attachment-viewer pre',x=>x.textContent.includes('NATIVESYNC_ANDROID_SYNTHETIC_FILE')));
  const n=downloads.length;await page.click('#attachment-save');const item=await until(()=>downloads[n],'download start');await until(()=>progress.get(item.guid)==='completed'&&fs.existsSync(dir+'/'+item.guid),'download completion');assert.equal(item.name,fixture.name);assert(item.blobUrl);assert.equal(sha(fs.readFileSync(dir+'/'+item.guid)),fixture.sha256);
  assert.equal((await browser.pages()).length,initialPages);checks.push({name:fixture.name,preview:'PASS',downloadHash:fixture.sha256,noNewWindow:true,authenticatedApiNotUsedAsDownloadUrl:true});await page.click('#attachment-close');await until(()=>page.$('#attachment-viewer').then(x=>!x),'viewer closed');
 }
 const anon=await browser.createBrowserContext(),other=await anon.newPage(),a=message.attachments[0],denied=await other.goto(config.origin+'/mobile/api/conversations/normal/attachments/messages/'+message.id+'/'+a.id);assert.equal(denied.status(),401);await anon.close();
 const button=(await page.$$(selector))[0];await button.click();await page.waitForSelector('#attachment-save');await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));await until(()=>page.$('#attachment-viewer').then(x=>!x),'pagehide clears attachment');assert.equal(calls(),before);
 const result={result:'PASS',scope:'computer Chrome through LAN gateway, not physical Android standalone acceptance',manifestSha256:read('PROVENANCE.json').payloadManifestSha256,checks,missingSessionStillDenied:401,pagehideClearsPreview:true,modelCallsAdded:0};
 fs.writeFileSync(root+'/evidence/phone-attachment-browser.json',JSON.stringify(result,null,2)+'\n');await page.screenshot({path:root+'/evidence/phone-attachment-browser.png',fullPage:true});console.log(JSON.stringify(result));
})().catch(e=>{console.error(String(e.message).replace(/#pair=[A-Za-z0-9_-]+/g,'#pair=[redacted]'));process.exitCode=1;}).finally(async()=>{await browser?.close();});
