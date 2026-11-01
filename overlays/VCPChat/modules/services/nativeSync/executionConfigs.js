'use strict';
const { extractAgentDTO } = require('../../../VCPDistributedServer/Plugin/VCPMobileSync/dto/agent.dto');
const { extractGroupDTO } = require('../../../VCPDistributedServer/Plugin/VCPMobileSync/dto/group.dto');
const { fail } = require('./protocol');
// Private inputs are projected through the existing native DTO whitelist.
async function executionConfigFor(t,{readAgentConfig,readGroupConfig,readTavernRules=()=>[],readExecutionPolicy=()=>({}),allowDirectoryTopic=false}){
 const group=t.itemType==='group';if(group&&typeof readGroupConfig!=='function')throw fail('GROUP_CONFIG_AUTHORITY_REQUIRED');
 const original=await(group?readGroupConfig:readAgentConfig)(t.itemId);
 if(!original.topics?.some(topic=>topic.id===t.topicId)&&!allowDirectoryTopic)throw fail('SELECTED_TOPIC_NOT_IN_AGENT');
 const project=value=>{const dto=extractAgentDTO(value);return {name:dto.name,systemPrompt:dto.systemPrompt,model:dto.model,temperature:dto.temperature,contextTokenLimit:dto.contextTokenLimit,maxOutputTokens:dto.maxOutputTokens,streamOutput:dto.streamOutput};};
 let config=project(original);
 if(group){
  const dto=extractGroupDTO(original),agents=[];
  for(const id of dto.members){try{const value=await readAgentConfig(id);if(!value||value.error)throw Error();agents.push({id,...project(value)});}catch{agents.push({id,unavailable:true});}}
  config={group:{...dto,...(original.modeSettings?.sequential?.speakerOrder?{modeSettings:{sequential:{speakerOrder:original.modeSettings.sequential.speakerOrder}}}:{}),...(original.sequentialSpeakerOrder?{sequentialSpeakerOrder:original.sequentialSpeakerOrder}:{})},agents};
 }
 config.tavernRules=await readTavernRules();config.executionPolicy=await readExecutionPolicy();return config;
}
async function publishExecutionConfigs({topics,send,...readers}){
 const current=await send('/api/plugins/NativeSync/mobile/execution-configs'),rows=[];
 for(const t of topics){
  const ownerType=t.itemType==='group'?'group':'agent',prior=current.topics.find(r=>r.ownerType===ownerType&&r.ownerId===t.itemId&&r.topicId===t.topicId);
  if(!prior)throw fail('TOPIC_NOT_ALLOWED');
  rows.push({ownerType,ownerId:t.itemId,topicId:t.topicId,expectedVersion:prior.configVersion||0,config:await executionConfigFor(t,readers)});
 }
 const batches=[];let batch=[];
 for(const row of rows){if(batch.length&&Buffer.byteLength(JSON.stringify({topics:[...batch,row]}))>96000){batches.push(batch);batch=[];}batch.push(row);}
 if(batch.length||!batches.length)batches.push(batch);
 const result={topics:[]};for(const topics of batches){const response=await send('/api/plugins/NativeSync/mobile/execution-configs',{body:{topics}});result.topics.push(...response.topics);}return result;
}
module.exports={publishExecutionConfigs,executionConfigFor};
