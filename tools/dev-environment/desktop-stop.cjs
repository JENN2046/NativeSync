'use strict';
// Invoke the real host's guarded quit; never bypass a busy refusal with a signal.
const path=require('node:path'),root=path.resolve(__dirname,'..'),p=require(root+'/VCPChat/node_modules/puppeteer');
(async()=>{
 const b=await p.connect({browserURL:'http://127.0.0.1:17654',defaultViewport:null});
 const page=(await b.pages()).find(x=>x.url()==='file://'+root+'/VCPChat/main.html');
 if(!page){await b.disconnect();throw Error('OWNED_DESKTOP_TARGET_REQUIRED');}
 try{await page.evaluate(()=>window.electronAPI.closeApp());}catch(e){if(!/closed|destroyed|detached/i.test(e.message))throw e;}
 await b.disconnect();
 const deadline=Date.now()+20000;
 while(Date.now()<deadline){try{await fetch('http://127.0.0.1:17654/json/version');}catch{console.log('desktop closed through guarded host quit');return;}await new Promise(r=>setTimeout(r,100));}
 throw Error('Desktop did not quit; host may be busy. No forced termination attempted.');
})().catch(e=>{console.error(e.message);process.exitCode=1;});
