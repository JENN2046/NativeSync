'use strict';
const fs=require('node:fs/promises'),path=require('node:path');
const {identity,fail}=require('./protocol');
const key=d=>JSON.stringify([d.ownerType,d.ownerId,d.topicId||'']);
async function plain(file,{directory=false,missing=false}={}){
 try{const s=await fs.lstat(file);if(s.isSymbolicLink()||(!directory&&(!s.isFile()||s.nlink!==1)))throw fail('SOURCE_PATH_ALIAS');if(directory&&!s.isDirectory())throw fail('SOURCE_PATH_ALIAS');return s;}
 catch(e){if(missing&&e.code==='ENOENT')return null;throw e;}
}
// Native config membership is authoritative. Missing/failed reads are observations,
// never deletions. In particular, do not upload the get-agents DTO or its prompts.
async function sourceDirectory({appDataRoot,readAgentConfig,readGroupConfig}){
 const agents=[],topics=[],errors=[],root=path.resolve(appDataRoot);
 await plain(root,{directory:true});
 for(const [ownerType,folder,read]of [['agent','Agents',readAgentConfig],['group','AgentGroups',readGroupConfig]]){
  const dir=path.join(root,folder);if(!await plain(dir,{directory:true,missing:true}))continue;
  const entries=await fs.readdir(dir,{withFileTypes:true});
  for(const entry of entries){if(!entry.isDirectory()||entry.isSymbolicLink())continue;
   const ownerId=entry.name;
   try{
    identity({ownerType,ownerId,topicId:'_',msgId:'_'});await plain(path.join(dir,ownerId),{directory:true});
    await plain(path.join(dir,ownerId,'config.json'));
    if(typeof read!=='function')throw fail('SOURCE_CONFIG_READER_REQUIRED');
    const config=await read(ownerId);
    if(!config||!Array.isArray(config.topics))throw fail('SOURCE_TOPICS_UNAVAILABLE');
    const own={ownerType,ownerId,name:String(config.name||ownerId).slice(0,200),avatar:null};agents.push(own);
    const ids=new Set();
    for(const t of config.topics){
     identity({ownerType,ownerId,topicId:t.id,msgId:'_'});if(ids.has(t.id))throw fail('SOURCE_DUPLICATE_TOPIC');ids.add(t.id);
     const history=path.join(root,'UserData',ownerId,'topics',t.id,'history.json');
     await assertHistoryPath(root,history);
     const exists=await plain(history,{missing:true});
     topics.push({ownerType,ownerId,topicId:t.id,name:String(t.name||t.id).slice(0,500),archived:t.archived===true,sourceState:exists?'available':'file-pending'});
    }
    // Native committed side-chat children are marked by the host, not inferred
    // from arbitrary history folders. Unbound temporary creations stay local.
    if(ownerType==='agent'){
     const children=path.join(root,'UserData',ownerId,'topics');await assertHistoryPath(root,path.join(children,'_','history.json'));
     const dirs=await fs.readdir(children,{withFileTypes:true}).catch(e=>{if(e.code==='ENOENT')return [];throw e;});
     for(const d of dirs){if(!d.isDirectory()||!/^sidechat_\d+_[0-9a-f]+$/.test(d.name)||ids.has(d.name))continue;
      const cd=path.join(children,d.name);await plain(cd,{directory:true});
      const markerFile=path.join(cd,'sidechat-child.json');if(!await plain(markerFile,{missing:true}))continue;
      const marker=JSON.parse(await fs.readFile(markerFile,'utf8'));
      if(marker.schemaVersion!==1||marker.ephemeral!==true||marker.agentId!==ownerId||marker.topicId!==d.name||!marker.parentTopicId)continue;
      identity({ownerType,ownerId,topicId:d.name,msgId:'_'});
      topics.push({ownerType,ownerId,topicId:d.name,name:'辅助对话',archived:false,sourceState:await plain(path.join(cd,'history.json'),{missing:true})?'available':'file-pending'});
     }
    }
   }catch(e){errors.push({ownerType,ownerId,code:e.code||'SOURCE_DIRECTORY_READ_FAILED'});}
  }
 }
 if(new Set(topics.map(key)).size!==topics.length)throw fail('SOURCE_DUPLICATE_TOPIC');
 return {agents,topics,errors};
}
async function assertHistoryPath(root,file){
 const resolved=path.resolve(file);if(!resolved.startsWith(path.resolve(root)+path.sep))throw fail('SOURCE_PATH_ESCAPE');
 let current=path.resolve(root);for(const part of path.relative(current,resolved).split(path.sep)){current=path.join(current,part);const s=await plain(current,{missing:true,directory:current!==resolved});if(!s)break;}
}
module.exports={sourceDirectory,assertHistoryPath,sourceEntityKey:key};
