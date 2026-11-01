'use strict';
const fs=require('node:fs');
const {Server,Client}=require('./prototype.cjs');
const input=JSON.parse(fs.readFileSync(process.argv[2])),fault=point=>{if(point===input.crashAt)process.exit(86);};
if(input.action==='repair'){
 const server=new Server(input.serverFile,input.product,{fault});server.repair(input.topic,input.generation,JSON.parse(fs.readFileSync(input.backupFile)));server.close();
}else if(input.action==='pull'){
 const server=new Server(input.serverFile,input.product,{fault});server.pull(input.cursor,input.limit,input.allowed);server.close();
}else{
 const client=new Client(input.clientFile,input.allowed,{fault}),frame=JSON.parse(fs.readFileSync(input.frameFile));
 if(input.action==='global')client.global(frame);else client.recovered(frame);client.close();
}
