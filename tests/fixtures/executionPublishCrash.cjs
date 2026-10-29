// Actual abrupt process exit after second batch commits and before its response.
'use strict';
const {fixture}=require('./executionPublishHarness.cjs');
(async()=>{const f=await fixture({root:process.argv[2],seed:false});for(let i=0;i<8;i++)f.setPrompt('a'+i,'\u4e2d'.repeat(5000));f.resetFault('exit');await f.publish();throw Error('EXIT_FAULT_NOT_REACHED');})().catch(e=>{console.error(e);process.exit(1);});
