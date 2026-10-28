'use strict';
const { extractAgentDTO } = require('../../../VCPDistributedServer/Plugin/VCPMobileSync/dto/agent.dto');
const { extractGroupDTO } = require('../../../VCPDistributedServer/Plugin/VCPMobileSync/dto/group.dto');
const { fail } = require('./protocol');

// Called only after explicit opt-in to private configuration publication.
// Never spread the full Agent object (which may contain credentials/paths).
async function publishExecutionConfigs({ topics, readAgentConfig, readGroupConfig, readTavernRules=()=>[], readExecutionPolicy=()=>({}), send }) {
    const current = await send('/api/plugins/NativeSync/mobile/execution-configs');
    const rows = [];
    for (const t of topics) {
        const group = t.itemType === 'group';
        if(group&&typeof readGroupConfig!=='function')throw fail('GROUP_CONFIG_AUTHORITY_REQUIRED');
        const original = await (group?readGroupConfig:readAgentConfig)(t.itemId);
        if (!original.topics?.some(topic=>topic.id===t.topicId)) throw fail('SELECTED_TOPIC_NOT_IN_AGENT');
        const project=value=>{const dto=extractAgentDTO(value);return {name:dto.name,systemPrompt:dto.systemPrompt,model:dto.model,temperature:dto.temperature,contextTokenLimit:dto.contextTokenLimit,maxOutputTokens:dto.maxOutputTokens,streamOutput:dto.streamOutput};};
        const prior = current.topics.find(r=>r.ownerType===(group?'group':'agent')&&r.ownerId===t.itemId&&r.topicId===t.topicId);
        if (!prior) throw fail('TOPIC_NOT_ALLOWED');
        let config=project(original);
        if(group){
            const dto=extractGroupDTO(original);const agents=[];
            for(const id of dto.members){try{const value=await readAgentConfig(id);if(!value||value.error)throw Error();agents.push({id,...project(value)});}catch{agents.push({id,unavailable:true});}}
            config={group:{...dto,...(original.modeSettings?.sequential?.speakerOrder?{modeSettings:{sequential:{speakerOrder:original.modeSettings.sequential.speakerOrder}}}:{}),...(original.sequentialSpeakerOrder?{sequentialSpeakerOrder:original.sequentialSpeakerOrder}:{})},agents};
        }
        config.tavernRules=await readTavernRules();config.executionPolicy=await readExecutionPolicy();
        rows.push({ownerType:group?'group':'agent',ownerId:t.itemId,topicId:t.topicId,expectedVersion:prior.configVersion||0,config});
    }
    return send('/api/plugins/NativeSync/mobile/execution-configs',{body:{topics:rows}});
}
module.exports = { publishExecutionConfigs };
