// Build-owned deployment copies. Edit packages/sync-contracts/src/contracts.mjs.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const mode=process.argv[2]||'--check';
if(!['--write','--check'].includes(mode)||process.argv.length>3)throw Error('Use --write or --check');
const source=await fs.readFile(path.join(root,'packages/sync-contracts/src/contracts.mjs'),'utf8');
const hash=createHash('sha256').update(source).digest('hex');
const header=`// GENERATED from packages/sync-contracts/src/contracts.mjs; source SHA256 ${hash}\n// Do not hand edit: node tools/build_contracts.mjs --write\n`;
const cjs=header+"'use strict';\n"+source.replace(/^export /gm,'')+'\nmodule.exports={createProtocol,createMetadata,createSourceScope,submissionText};\n';
const outputs=new Map([
 ['overlays/VCPChat/modules/services/nativeSync/contracts.generated.cjs',cjs],
 ['overlays/VCPToolBox/Plugin/NativeSync/sync/contracts.generated.cjs',cjs],
 ['overlays/VCPToolBox/apps/mobile/src/contracts.generated.js',header+source],
]);
const lifecycle=await fs.readFile(path.join(root,'packages/execution-decisions/src/lifecycle.mjs'),'utf8');
const lifecycleHash=createHash('sha256').update(lifecycle).digest('hex');
outputs.set('overlays/VCPToolBox/Plugin/NativeSync/mobile/executionDecisions.generated.cjs',`// GENERATED from packages/execution-decisions/src/lifecycle.mjs; source SHA256 ${lifecycleHash}\n`+"'use strict';\n"+lifecycle.replace(/^export /gm,'')+'\nmodule.exports={step};\n');
let failed=false;
for(const [name,content]of outputs){
 const target=path.join(root,name);
 if(mode==='--write'){await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,content);}
 else {let current;try{current=await fs.readFile(target,'utf8');}catch{}if(current!==content){failed=true;process.stderr.write('GENERATED_CONTRACT_DRIFT '+name+'\n');}}
}
if(failed)process.exitCode=1;
else process.stdout.write(JSON.stringify({mode,outputs:outputs.size,sourceSha256:hash})+'\n');
