'use strict';
// Test-process preload only: require real cold-installed modules, never stubs.
const Module=require('node:module'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),original=Module._resolveFilename,seen=new Set();
Module._resolveFilename=function(...args){const result=Reflect.apply(original,this,args);if(typeof result==='string'&&path.isAbsolute(result)&&!seen.has(result)){if(result.startsWith('/home/jenn/NativeSync-Dev/'))throw Object.assign(Error('COLD_FORBIDDEN_OLD_MODULE'),{code:'COLD_FORBIDDEN_OLD_MODULE'});seen.add(result);fs.appendFileSync(path.join(root,'evidence','module-paths-'+process.pid+'.jsonl'),JSON.stringify({pid:process.pid,entry:process.argv[1]||'',path:result})+'\n');}return result;};
