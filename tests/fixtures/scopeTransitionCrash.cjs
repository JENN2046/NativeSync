
'use strict';
const fs=require('node:fs'),path=require('node:path');
const spec=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));if(!spec.file.startsWith(require('node:os').tmpdir()+path.sep+'native-m2m3-'))throw Error('TEMP_ROOT_REQUIRED');
const box=process.env.VCP_R21_BOX_SOURCE,{CentralStore}=require(box+'/Plugin/NativeSync/sync/centralStore'),{SourceCatalog}=require(box+'/Plugin/NativeSync/sync/sourceCatalog');
const store=new CentralStore(spec.file),catalog=new SourceCatalog(store,spec.config);catalog.transitionFault=stage=>{if(stage==='pin-updated'){fs.writeFileSync(spec.receipt,JSON.stringify({pid:process.pid,stage}));process.exit(77);}};catalog.transition(spec.binding,spec.body);throw Error('EXIT_BOUNDARY_NOT_REACHED');
