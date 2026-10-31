'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
(async()=>{
 const [inputPath,stage]=process.argv.slice(2),input=JSON.parse(await fs.readFile(inputPath,'utf8')),root=path.dirname(inputPath),hosts=process.env.NATIVESYNC_TEST_HOSTS;
 if(!root.startsWith(os.tmpdir()+path.sep)||!path.basename(root).startsWith('native-m2m3-')||!input.statePath.startsWith(root+path.sep)||!['before','after'].includes(stage)||!hosts)throw Error('ISOLATED_INBOX_CRASH_ONLY');
 const {HistoryMutationQueue}=require(hosts+'/VCPChat/modules/services/historyMutationQueue'),{NativeSyncAdapter}=require(hosts+'/VCPChat/modules/services/nativeSync/adapter'),{durableJson}=require(hosts+'/VCPChat/modules/services/nativeSync/durableJson');
 const state=JSON.parse(await fs.readFile(input.statePath,'utf8')),queue=new HistoryMutationQueue({userDataDir:path.join(input.app,'UserData'),logger:{warn(){}}});
 const adapter=await NativeSyncAdapter.open({queue,statePath:input.statePath,deviceId:state.deviceId,url:'http://127.0.0.1',token:'synthetic-only',topics:state.topics,source:state.source,request:async()=>input.page});
 adapter.persist=async(file,next)=>{if(next.cursor>state.cursor&&next.inbox.length){if(stage==='after')await durableJson(file,next);process.exit(78);}return durableJson(file,next);};
 await adapter.pull();throw Error('CRASH_BOUNDARY_NOT_REACHED');
})().catch(e=>{console.error(e);process.exitCode=1;});
