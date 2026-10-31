'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),Module=require('node:module'),{pathToFileURL}=require('node:url'),{execFileSync,spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),hosts=process.env.NATIVESYNC_TEST_HOSTS,baseline='9dc099b6007e018a9743d72048d5e6fbb43b94e7';
if(!hosts)throw Error('MATCHED_TEST_HOSTS_REQUIRED');
const oracleCache=new Map();
function source(host,relative){return execFileSync('git',['show',baseline+':overlays/'+host+'/'+relative],{cwd:root,encoding:'utf8'});}
// The original module bodies are read from the fixed Git object. Only require
// resolution is redirected to original peers or unchanged public host modules.
function oracle(host,relative){
 const key=host+'/'+relative;if(oracleCache.has(key))return oracleCache.get(key).exports;
 const file=path.join(hosts,host,relative),m=new Module(file,module);m.filename=file;oracleCache.set(key,m);
 const originalRequire=Module.createRequire(file);
 m.require=request=>{
  const target=path.relative(path.join(hosts,host),path.resolve(path.dirname(file),request)).replaceAll(path.sep,'/');
  const name=target.endsWith('.js')?target:target+'.js';
  const prefix=host==='VCPChat'?'modules/services/nativeSync/':'Plugin/NativeSync/sync/';
  if(request.startsWith('.')&&['protocol.js','metadata.js','sourceScope.js'].some(n=>name===prefix+n))return oracle(host,name);
  return originalRequire(request);
 };
 m._compile(source(host,relative),file);return m.exports;
}
function current(host,name){return require(path.join(hosts,host,host==='VCPChat'?'modules/services/nativeSync':'Plugin/NativeSync/sync',name));}
function capture(fn){try{return {ok:true,value:JSON.parse(JSON.stringify(fn()))};}catch(e){return {ok:false,name:e.name,message:e.message,code:e.code??null,status:e.status??null};}}
function same(actual,expected,label){assert.deepEqual(capture(actual),capture(expected),label);}
const original={};for(const host of ['VCPChat','VCPToolBox']){
 const prefix=host==='VCPChat'?'modules/services/nativeSync/':'Plugin/NativeSync/sync/';
 original[host]={protocol:oracle(host,prefix+'protocol.js'),metadata:oracle(host,prefix+'metadata.js'),scope:oracle(host,prefix+'sourceScope.js')};
}
test('generated contracts match the only maintained source, which has no IO/runtime-global dependencies',()=>{
 const result=spawnSync(process.execPath,[path.join(root,'tools/build_contracts.mjs'),'--check'],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);
 const acorn=Module.createRequire(path.join(process.env.VCP_R21_AA_DEPENDENCIES,'contracts-test.cjs'))('acorn');
 const text=fs.readFileSync(path.join(root,'packages/sync-contracts/src/contracts.mjs'),'utf8'),ast=acorn.parse(text,{ecmaVersion:'latest',sourceType:'module'}),forbidden=new Set(['require','process','Buffer','window','document','fetch','Date','localStorage']);
 const walk=node=>{if(!node||typeof node!=='object')return;if(['ImportDeclaration','AwaitExpression','ImportExpression'].includes(node.type)||node.async===true)assert.fail('Impure contract syntax: '+node.type);if(node.type==='Identifier')assert.ok(!forbidden.has(node.name),'Impure contract global: '+node.name);for(const value of Object.values(node))if(Array.isArray(value))value.forEach(walk);else if(value&&typeof value==='object')walk(value);};walk(ast);
});
test('identity, hashes and scope errors remain equivalent to both original host adapters',()=>{
 const identities=[{ownerType:'agent',ownerId:'owner',topicId:'topic',msgId:'m'}, {ownerType:'group',ownerId:'群组',topicId:'历史',msgId:'id👋'}];
 for(const field of ['ownerId','topicId'])for(const value of ['CON','..','a/../b','bad.','bad ','x\0y','x:y',''])identities.push({...identities[0],[field]:value});
 identities.push(null,{}, {...identities[0],ownerType:'unknown'});
 const scopes=[undefined,{mode:'full'},null,{}, {mode:'limited',topics:[]},{mode:'limited',topics:[{ownerType:'agent',ownerId:'one',topicId:'t'}]},{mode:'limited',topics:[{ownerType:'agent',ownerId:'one',topicId:'t'},{ownerType:'group',ownerId:'g',topicId:'u'}]}];
 scopes.push({mode:'limited',topics:[{ownerType:'agent',ownerId:'one',topicId:'t'},{ownerType:'agent',ownerId:'one',topicId:'t'}]});
 for(const host of Object.keys(original)){
  const p=current(host,'protocol'),s=current(host,'sourceScope'),before=original[host];
  for(const id of identities)for(const name of ['identity','messageKey','tombstoneHash'])same(()=>p[name](id),()=>before.protocol[name](id),host+' '+name);
  for(const scope of scopes){same(()=>s.normalizeScope(scope),()=>before.scope.normalizeScope(scope),host+' normalized scope');same(()=>s.scopeHash(scope),()=>before.scope.scopeHash(scope),host+' scope hash');for(const id of identities.filter(Boolean))same(()=>s.permits(scope,id),()=>before.scope.permits(scope,id),host+' permits');}
  for(const a of scopes)for(const b of scopes)same(()=>s.expansion(a,b),()=>before.scope.expansion(a,b),host+' expansion');
 }
});
test('control envelopes, canonical messages and invalid metadata preserve existing byte hashes and errors',()=>{
 const base={id:'m',role:'user',content:'checkpoint 中\n👋',timestamp:1};
 const messages=[base,{...base,contextCompaction:{kind:'vchat-context-checkpoint',version:1,checkpoint:'checkpoint',sourceCount:2,fidelity:{'𐀀':'a','':'b'}}},{...base,isThinking:false},{...base,role:'assistant',tool_calls:[{id:'call',type:'function',function:{name:'read',arguments:'{"a":1}'}}]}, {...base,role:'tool',tool_call_id:'call'}, {...base,continuity:{version:1,known:true,requestId:'request',dependsOnMessageIds:['parent']}}, {...base,attachments:[{id:'attachment',name:'a.txt',type:'text/plain',size:1,hash:'a'.repeat(64),extractedText:'中',frameHashes:['b'.repeat(64)]}]}, {...base,continuity:{version:1,known:true,dependsOnMessageIds:['m']}}, {...base,isThinking:1}, {...base,role:'user',tool_calls:[]}, {...base,contextCompaction:{kind:'bad'}}, {...base,contextCompaction:{kind:'vchat-context-checkpoint',version:1,checkpoint:'checkpoint',fidelity:{a:'中'.repeat(128000),b:'文'.repeat(128000),c:'字'.repeat(128000)}}}];
 for(const host of Object.keys(original)){
  const metadata=current(host,'metadata'),p=current(host,'protocol'),before=original[host];
  for(const m of messages){same(()=>metadata.fieldsFrom(structuredClone(m)),()=>before.metadata.fieldsFrom(structuredClone(m)),host+' fields');same(()=>p.canonicalMessage(structuredClone(m),'t'),()=>before.protocol.canonicalMessage(structuredClone(m),'t'),host+' canonical');same(()=>p.messageHash(m),()=>before.protocol.messageHash(m),host+' message hash');
   const r=capture(()=>before.metadata.envelopeFor(m,1));if(r.ok){const envelope=r.value;same(()=>metadata.envelopeFor(m,1),()=>before.metadata.envelopeFor(m,1),host+' envelope');same(()=>metadata.validateEnvelope(m,envelope),()=>before.metadata.validateEnvelope(m,envelope),host+' validate');same(()=>metadata.validateEnvelope(m,{...envelope,hash:'0'.repeat(64)}),()=>before.metadata.validateEnvelope(m,{...envelope,hash:'0'.repeat(64)}),host+' bad digest');}
  }
 }
 assert.equal(current('VCPToolBox','metadata').assertCompatibleBackfill,undefined);assert.equal(typeof current('VCPChat','metadata').assertCompatibleBackfill,'function');
});
test('Node and browser submission hashing match original implementations for Unicode and ordered attachments',async()=>{
 const node=require(path.join(hosts,'VCPToolBox/Plugin/NativeSync/mobile/submissionRecovery'));
 const beforeNode=oracle('VCPToolBox','Plugin/NativeSync/mobile/submissionRecovery.js');
 const web=await import(pathToFileURL(path.join(root,'overlays/VCPToolBox/apps/mobile/src/submissionRecovery.js')));
 const beforeWeb=await import('data:text/javascript;base64,'+Buffer.from(source('VCPToolBox','apps/mobile/src/submissionRecovery.js')).toString('base64'));
 for(let i=0;i<128;i++)for(const kind of ['message','invitation']){
  const payload=kind==='message'?{requestId:'request_'+i,text:['中文','👋','e\u0301','é','\ud800','x\0y'][i%6]+i,...(i%3?{attachments:['upload_'+i,'second_'+i]}:{})}:{requestId:'request_'+i,agentId:'agent_'+i};const input={topicKey:'topic_'+i,kind,payload};
  same(()=>node.payloadHash(input),()=>beforeNode.payloadHash(input),'Node submission');const currentHash=await web.submissionPayloadHash(input,crypto.webcrypto),oldHash=await beforeWeb.submissionPayloadHash(input,crypto.webcrypto);assert.equal(currentHash,oldHash);assert.equal(currentHash,node.payloadHash(input));
 }
 const invalid={topicKey:'long topic with spaces',kind:'message',payload:{requestId:'short',text:'still rejected by server'}};
 same(()=>node.payloadHash(invalid),()=>beforeNode.payloadHash(invalid),'Server validation remains separate');assert.equal(await web.submissionPayloadHash(invalid,crypto.webcrypto),await beforeWeb.submissionPayloadHash(invalid,crypto.webcrypto));
});
test('one hand-edited generated copy is detected and recovered from the maintained source',()=>{
 const target=path.join(root,'overlays/VCPChat/modules/services/nativeSync/contracts.generated.cjs'),before=fs.readFileSync(target);
 try{fs.appendFileSync(target,'\n// synthetic drift\n');const bad=spawnSync(process.execPath,[path.join(root,'tools/build_contracts.mjs'),'--check'],{encoding:'utf8'});assert.equal(bad.status,1);assert.match(bad.stderr,/GENERATED_CONTRACT_DRIFT/);
  const fixed=spawnSync(process.execPath,[path.join(root,'tools/build_contracts.mjs'),'--write'],{encoding:'utf8'});assert.equal(fixed.status,0,fixed.stderr);assert.deepEqual(fs.readFileSync(target),before);
 }finally{fs.writeFileSync(target,before);}
});
test('frozen baseline vectors detect transitive canonical drift in addition to shared-contract drift',async()=>{
 const vectors=require('./fixtures/contracts-golden.json'),web=await import(pathToFileURL(path.join(root,'overlays/VCPToolBox/apps/mobile/src/submissionRecovery.js')));
 for(const host of ['VCPChat','VCPToolBox']){
  const p=current(host,'protocol'),m=current(host,'metadata'),s=current(host,'sourceScope');
  for(const v of vectors.serialization)assert.equal(p.stable(v.input),v.expected);
  for(const v of vectors.messages){assert.deepEqual(p.canonicalMessage(structuredClone(v.input),'topic'),v.canonical);assert.equal(p.messageHash(v.input),v.messageHash);assert.equal(m.envelopeFor(v.input,1).hash,v.metadataHash);}
  for(const v of vectors.scopes){assert.deepEqual(s.normalizeScope(v.input),v.normalized);assert.equal(s.scopeHash(v.input),v.hash);}
 }
 for(const v of vectors.submissions)assert.equal(await web.submissionPayloadHash(v.input,crypto.webcrypto),v.hash);
});
