'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),{pathToFileURL}=require('node:url');
const modulePath=path.join(process.env.NATIVESYNC_ASSEMBLY||path.resolve(__dirname,'../overlays'),'VCPToolBox/apps/mobile/src/pairingLink.js');
const load=()=>import(pathToFileURL(modulePath).href);
test('pairing fragment is erased before returning an in-memory code, without changing query or history state',async()=>{
 const {consumePairingLink}=await load(),code='synthetic_'+('x'.repeat(22));assert.equal(code.length,32);let replaced;
 const history={state:{existing:true},replaceState(...args){replaced=args;}};
 assert.equal(consumePairingLink({location:{hash:'#pair='+code,pathname:'/mobile/',search:'?view=chat',protocol:'https:'},history,secureContext:true}),code);assert.deepEqual(replaced,[history.state,'','/mobile/?view=chat']);
});
test('malformed, extended, insecure or unerased pairing links cannot prefill credentials',async()=>{
 const {consumePairingLink}=await load(),base={hash:'#pair='+'a'.repeat(32),pathname:'/mobile/',search:'',protocol:'https:'};
 for(const hash of ['#pair=short','#pair='+'a'.repeat(33),'#pair='+'a'.repeat(32)+'&apiKey=x','#pair=%61'+'a'.repeat(31),'#apiKey='+'a'.repeat(32)])assert.equal(consumePairingLink({location:{...base,hash},history:{replaceState(){}},secureContext:true}),null);
 assert.equal(consumePairingLink({location:base,history:{replaceState(){}},secureContext:false}),null);assert.equal(consumePairingLink({location:{...base,protocol:'http:'},history:{replaceState(){}},secureContext:true}),null);assert.equal(consumePairingLink({location:base,history:{replaceState(){throw Error('blocked');}},secureContext:true}),null);
});
