'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
async function verify(root,stage,cfg,state){
 const origin='https://127.0.0.1:'+cfg.proxyPort,p=require(cfg.puppeteer);
 const browser=await p.launch({executablePath:'/opt/google/chrome/chrome',headless:true,userDataDir:root+'/browser-history-'+stage+'-'+Date.now(),args:['--ignore-certificate-errors-spki-list='+cfg.spki,'--disable-background-networking','--no-first-run']});
 try{
  const tab=await browser.newPage(),cookie=state.cookie.split('=');
  await tab.setCookie({name:cookie[0],value:cookie.slice(1).join('='),domain:'127.0.0.1',path:'/mobile/',secure:true,httpOnly:true,sameSite:'Strict'});
  await tab.goto(origin+'/mobile/',{waitUntil:'networkidle0'});
  await tab.waitForFunction(()=>document.querySelectorAll('select').length===2);
  const key=await tab.evaluate(async()=>{const response=await fetch('/mobile/api/directory?kind=topics&limit=100');const directory=await response.json();if(response.status!==200||directory.topics.length!==2)throw Error('PWA_DIRECTORY_NOT_AUTHENTICATED');return directory.topics.find(t=>t.topicId==='legacy-a').key;});
  await (await tab.$$('select'))[1].select(key);
  const reply='SYNTHETIC_PROD_REPLY_'+state.jobIds.length;
  await tab.waitForFunction(last=>document.body.innerText.includes('SYNTHETIC_LEGACY_V2')&&document.body.innerText.includes(last),{timeout:15000},reply);
  const scripts=await tab.evaluate(()=>[...document.scripts].map(s=>s.src).filter(Boolean));
  const asset=['new','reinstalled'].includes(stage)?'index-BcpsuVsp.js':'index-DI5CQjGO.js';assert.ok(scripts.some(s=>s.endsWith(asset)));
  await tab.screenshot({path:root+'/evidence/pwa-history-'+stage+'.png',fullPage:true});
  const result={rendered:true,directoryTopics:2,asset,selectedTopic:'legacy-a',latestLegacyMessageVisible:true,latestExplicitReplyVisible:true,sessionReused:true};
  fs.writeFileSync(root+'/evidence/browser-history-'+stage+'.json',JSON.stringify(result,null,2)+'\n');return result;
 }finally{await browser.close();}
}
module.exports={verify};
if(require.main===module){const root=path.resolve(process.argv[2]);verify(root,process.argv[3],JSON.parse(fs.readFileSync(root+'/private.json')),JSON.parse(fs.readFileSync(root+'/client-state.json'))).then(v=>console.log(JSON.stringify(v))).catch(e=>{console.error(e.message);process.exitCode=1;});}
