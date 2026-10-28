'use strict';
// Expand only the server-validated alias in its already verified immutable
// snapshot. Other native variables remain the author's handler's responsibility.
function snapshotPrompt(config, fallback='') {
 if(config.promptPolicy!=='native-alias-snapshot')return config.systemPrompt||fallback;
 if(typeof config.agentAlias!=='string'||!config.agentAlias||typeof config.systemPrompt!=='string'||!config.systemPrompt)throw Object.assign(Error('CONFIG_PROMPT_SNAPSHOT_UNAVAILABLE'),{code:'CONFIG_PROMPT_SNAPSHOT_UNAVAILABLE'});
 const alias=config.agentAlias.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 const pattern=new RegExp('\\{\\{(?:agent:)?'+alias+'\\}\\}','g');let replaced=0;
 const result=(config.promptTemplate||'{{agent:'+config.agentAlias+'}}').replace(pattern,()=>{replaced++;return config.systemPrompt;});
 if(!replaced)throw Object.assign(Error('CONFIG_PROMPT_AUTHORITY_CONFLICT'),{code:'CONFIG_PROMPT_AUTHORITY_CONFLICT'});
 return result;
}
module.exports={snapshotPrompt};
