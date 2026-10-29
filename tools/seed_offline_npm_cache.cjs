// Build a NEW credential-free cache from ONLY lock-matched public tarballs.
// node seed_offline_npm_cache.cjs PUBLIC_TARBALLS.json NEW_CACHE NPM_CLI_PATH LOCKFILE
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{createRequire}=require('node:module');
const [manifestFile,cacheArg,npmCLI,lockFile]=process.argv.slice(2);if(!lockFile)throw Error('FOUR_ARGUMENTS_REQUIRED');
const manifest=JSON.parse(fs.readFileSync(manifestFile)),lock=JSON.parse(fs.readFileSync(lockFile));
if(crypto.createHash('sha256').update(fs.readFileSync(lockFile)).digest('hex')!==manifest.lockSha256)throw Error('LOCK_HASH_CHANGED');
const cache=path.resolve(cacheArg),base=path.dirname(path.resolve(manifestFile));
if(fs.existsSync(cache)&&fs.readdirSync(cache).length)throw Error('NEW_EMPTY_CACHE_REQUIRED');fs.mkdirSync(cache,{recursive:true});
const npmRoot=path.dirname(path.dirname(fs.realpathSync(npmCLI))),cacache=createRequire(path.join(npmRoot,'package.json'))('cacache');
(async()=>{
 const expected=Object.entries(lock.packages).filter(([key,value])=>key&&!value.link);if(expected.length!==manifest.packages.length)throw Error('INCOMPLETE_LOCK_SET');
 for(const [key,value]of expected){
  const row=manifest.packages.find(r=>r.packagePath===key);if(!row||row.integrity!==value.integrity||row.url!==value.resolved)throw Error('LOCK_PACKAGE_CHANGED');
  const url=new URL(row.url);if(url.protocol!=='https:'||url.hostname!=='registry.npmjs.org'||url.username||url.password||url.search)throw Error('PUBLIC_REGISTRY_ONLY');
  const file=path.resolve(base,row.file);if(!file.startsWith(base+path.sep)||!row.file.startsWith('tarballs/'))throw Error('INVALID_TARBALL_PATH');
  const bytes=fs.readFileSync(file);if(bytes.length!==row.bytes||crypto.createHash('sha256').update(bytes).digest('hex')!==row.sha256||'sha512-'+crypto.createHash('sha512').update(bytes).digest('base64')!==row.integrity)throw Error('TARBALL_INTEGRITY_MISMATCH');
  await cacache.put(cache,'make-fetch-happen:request-cache:'+row.url,bytes,{integrity:row.integrity,metadata:{time:Date.now(),url:row.url,reqHeaders:{},resHeaders:{'content-type':'application/octet-stream','cache-control':'public,max-age=31536000'},options:{compress:true}}});
 }
 console.log(JSON.stringify({packages:expected.length,publicOnly:true,credentialsCopied:false,cache}));
})().catch(e=>{console.error(e);process.exitCode=1;});
