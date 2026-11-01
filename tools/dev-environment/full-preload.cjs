'use strict';
// Loaded only by the verification command's node --require argument.
const fs=require('node:fs'),path=require('node:path'),root=path.resolve(__dirname,'..');
if(JSON.parse(fs.readFileSync(root+'/ISOLATED.json')).kind!=='nativesync-full-local-runtime')throw Error('ISOLATION_REQUIRED');
const control=()=>JSON.parse(fs.readFileSync(root+'/control.json'));
function crash(stage,extra={}){const fd=fs.openSync(root+'/evidence/crash-'+stage+'.json','w',0o600);fs.writeSync(fd,JSON.stringify({stage,pid:process.pid,...extra}));fs.fsyncSync(fd);fs.closeSync(fd);process.exit(78);}
const execution=require(root+'/VCPToolBox/Plugin/NativeSync/mobile/execution');
const Original=execution.ConversationExecution;
execution.ConversationExecution=class extends Original {constructor(options){super({...options,fault:stage=>{if(control().fault===stage)crash(stage);}});}};
const {NativeTaskLinks}=require(root+'/VCPToolBox/Plugin/NativeSync/mobile/nativeTasks');
const observe=NativeTaskLinks.prototype.observe;
NativeTaskLinks.prototype.observe=function(row,data){if(control().fault==='aa-terminal'&&data.state==='completed')crash('aa-terminal',{nativeTaskId:data.nativeTaskId,executionId:row.execution_id,resultRef:data.resultRef,resultHash:data.resultHash});return observe.call(this,row,data);};
