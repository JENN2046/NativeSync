// Release assembly only. Build tools are the versions in the existing PWA lock.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const options={};for(let i=2;i<process.argv.length;i+=2){const key=process.argv[i];if(!['--out','--dependencies','--mode'].includes(key)||!process.argv[i+1]||options[key])throw Error('Use --out DIR --dependencies NODE_MODULES [--mode write|check]');options[key]=process.argv[i+1];}
const output=path.resolve(options['--out']||''),deps=path.resolve(options['--dependencies']||process.env.NATIVESYNC_PWA_DEPENDENCIES||''),mode=options['--mode']||'check';
if(!options['--out']||!['write','check'].includes(mode)||!options['--dependencies']&&!process.env.NATIVESYNC_PWA_DEPENDENCIES)throw Error('Explicit assembly output and locked dependencies required');
if(output===root||!path.relative(root,output).startsWith('..')&&!path.relative(root,output).startsWith('.local'+path.sep)&&!path.relative(root,output).startsWith('.artifacts'+path.sep))throw Error('Generated outputs must stay outside the maintained source tree');
const lock=JSON.parse(await fs.readFile(path.join(root,'overlays/VCPToolBox/apps/mobile/package-lock.json'),'utf8'));
const version=JSON.parse(await fs.readFile(path.join(deps,'rolldown/package.json'),'utf8')).version;
if(version!==lock.packages['node_modules/rolldown'].version)throw Error('Locked rolldown version required');
const {rolldown}=await import(pathToFileURL(path.join(deps,'rolldown/dist/index.mjs')));
const source=path.join(root,'packages/sync-contracts/src/contracts.mjs'),hash=createHash('sha256').update(await fs.readFile(source)).digest('hex');
const bundle=await rolldown({cwd:root,input:source,platform:'neutral'});const outputs=new Map();
try{for(const [format,names]of [['cjs',['VCPChat/modules/services/nativeSync/contracts.generated.cjs','VCPToolBox/Plugin/NativeSync/sync/contracts.generated.cjs']],['es',['VCPToolBox/apps/mobile/src/contracts.generated.js']]]){
 const result=await bundle.generate({format,file:'contracts.'+(format==='cjs'?'cjs':'js'),sourcemap:false,minify:false});
 if(result.output.length!==1||result.output[0].type!=='chunk'||result.output[0].imports.length||result.output[0].dynamicImports.length)throw Error('Contract bundle must be standalone');
 const bytes=`// Generated during release assembly; source SHA256 ${hash}\n`+result.output[0].code;
 for(const name of names)outputs.set(name,bytes);
}}finally{await bundle.close();}
for(const [name,bytes]of outputs){const target=path.join(output,name);if(mode==='write'){await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,bytes);}else if(await fs.readFile(target,'utf8')!==bytes)throw Error('GENERATED_CONTRACT_DRIFT '+name);}
process.stdout.write(JSON.stringify({mode,outputs:outputs.size,sourceSha256:hash,compiler:{name:'rolldown',version}})+'\n');
