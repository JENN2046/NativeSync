'use strict';
const {wireTopic,stable,sha256,fail}=require('./protocol');
const {executionConfigFor}=require('./executionConfigs');
const route='/api/plugins/NativeSync/mobile/execution-configs';
const key=t=>JSON.stringify([t.itemType||t.ownerType||'agent',t.itemId||t.ownerId,t.topicId]);

// Derived scheduling state. Durable versions remain in existing server snapshots.
class SourceExecutionPublication{
 constructor({send,getTopics,getDirectory,...readers}){Object.assign(this,{send,getTopics,getDirectory,readers});this.versions=new Map();this.sent=new Map();this.inputHashes=new Map();this.errors=new Map();this.cursor='';this.revision='';this.loaded=false;this.pending=null;this.error=null;}
 async tick(){
  try{
   if(!this.loaded){
    const q=new URLSearchParams({limit:'128',...(this.cursor?{cursor:this.cursor,revision:this.revision}:{})}),page=await this.send(route+'?'+q);
    if(!Array.isArray(page.topics)||typeof page.hasMore!=='boolean'||!page.revision)throw fail('CONFIG_PUBLICATION_PAGE_INVALID');
    for(const row of page.topics)this.versions.set(key(row),row);
    if(page.hasMore){if(!page.next||page.next===this.cursor)throw fail('CONFIG_PUBLICATION_PAGE_INVALID');this.cursor=page.next;this.revision=page.revision;}else{this.loaded=true;this.cursor='';this.revision='';}
    this.error=null;return;
   }
   const directory=this.getDirectory();if(!directory)return;
   const policy=await(this.readers.readExecutionPolicy?.()||{}),rules=await(this.readers.readTavernRules?.()||[]),globals=sha256(stable([policy,rules]));
   const revisions=directory.configRevisions||{},topics=this.getTopics().filter(t=>directory.topics.some(row=>key(row)===key(t)));
   const candidates=topics.map(t=>{const owner=revisions[JSON.stringify([t.itemType||'agent',t.itemId])];return {t,key:key(t),revision:sha256(stable([owner?.hash,...(owner?.members||[]).map(id=>[id,revisions[JSON.stringify(['agent',id])]?.hash||null]),globals]))};});
   const active=new Set(candidates.map(c=>c.key));for(const k of this.errors.keys())if(!active.has(k))this.errors.delete(k);
   const pending=candidates.filter(c=>(this.sent.get(c.key)!==c.revision||this.errors.has(c.key))&&(this.errors.get(c.key)?.revision!==c.revision||(this.errors.get(c.key)?.retryAt||0)<=Date.now()));this.pending=pending.length;
   const c=pending[0];if(!c){this.error=null;return;}
   if(!this.versions.has(c.key)){this.loaded=false;this.cursor='';this.revision='';return;}
   try{
    const config=await executionConfigFor(c.t,{...this.readers,allowDirectoryTopic:true,readExecutionPolicy:()=>policy,readTavernRules:()=>rules}),prior=this.versions.get(c.key);
    const inputHash=sha256(stable(JSON.parse(JSON.stringify(config))));if(this.inputHashes.get(c.key)===inputHash&&!this.errors.has(c.key)){this.sent.set(c.key,c.revision);this.pending--;this.error=null;return;}
    const result=await this.send(route,{body:{topics:[{...wireTopic(c.t),expectedVersion:prior.configVersion||0,config}]}}),row=result.topics?.[0];
    if(result.topics?.length!==1||row?.key!==prior.key||!Number.isSafeInteger(row.configVersion)||!row.configHash)throw fail('CONFIG_PUBLICATION_ACK_INVALID');
    this.versions.set(c.key,{...prior,...row});this.sent.set(c.key,c.revision);this.inputHashes.set(c.key,inputHash);this.errors.delete(c.key);this.pending--;this.error=null;
   }catch(error){
    if([400,403,413,415].includes(error.status)||['SELECTED_TOPIC_NOT_IN_AGENT','GROUP_CONFIG_AUTHORITY_REQUIRED','DESKTOP_CONTEXT_REQUIRED','CONFIG_PROMPT_SNAPSHOT_UNAVAILABLE','CONFIG_PROMPT_AUTHORITY_CONFLICT'].includes(error.code))this.errors.set(c.key,{revision:c.revision,code:error.code||'CONFIG_PUBLICATION_FAILED',retryAt:Date.now()+30000});
    if(error.code==='CONFIG_VERSION_CONFLICT'){this.loaded=false;this.cursor='';this.revision='';}
    throw error;
   }
  }catch(error){if(error.code==='CONFIG_DIRECTORY_CHANGED'){this.loaded=false;this.cursor='';this.revision='';}this.error=error.code||'CONFIG_PUBLICATION_FAILED';}
 }
 diagnostics(){return {pending:this.loaded?this.pending:null,failed:this.errors.size,error:this.error};}
}
module.exports={SourceExecutionPublication};
