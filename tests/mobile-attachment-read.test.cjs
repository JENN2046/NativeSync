'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),{pathToFileURL}=require('node:url');
const load=()=>import(pathToFileURL(path.join(process.env.NATIVESYNC_ASSEMBLY||path.resolve(__dirname,'../overlays'),'VCPToolBox/apps/mobile/src/attachmentRead.js')).href);
test('attachment bytes are read with the current page session and without redirecting authentication to another context',async()=>{
 const {readAttachment}=await load(),bytes=Buffer.from('synthetic file\n');let requested;
 const blob=await readAttachment('/mobile/api/conversations/test/attachments/messages/m/a',{fetchImpl:async(url,options)=>{requested={url,options};return new Response(bytes,{headers:{'Content-Type':'text/plain'}});}});
 assert.equal(await blob.text(),bytes.toString());assert.equal(requested.options.credentials,'same-origin');assert.equal(requested.options.cache,'no-store');assert.equal(requested.options.redirect,'error');assert.equal(new URL(requested.url,'https://local.test').search,'');
});
test('missing-session and forbidden attachment responses remain errors, never files',async()=>{
 const {readAttachment}=await load();for(const status of [401,403]){let bodyRead=false;await assert.rejects(readAttachment('/mobile/api/attachment',{fetchImpl:async()=>({ok:false,status,blob(){bodyRead=true;}})}),e=>e.status===status);assert.equal(bodyRead,false);}
});
