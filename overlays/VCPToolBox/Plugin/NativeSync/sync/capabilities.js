'use strict';
const REFERENCE_CAPABILITY='desktop-references-v1';
const SOURCE_DATA_CAPABILITY='source-data-v2';
const {requiresSourceDataV2}=require('./metadata');
const supported=(header,capability=REFERENCE_CAPABILITY)=>String(header||'').split(',').map(s=>s.trim()).includes(capability);
const needsReferences=message=>Boolean(message?.desktopReferences?.length||message?._nativeSyncMetadata?.fields?.desktopReferences?.length);
function requireReferenceReader(page,header){
 const rows=[...(page?.events||[]),...(page?.messages||[])];
 if(!supported(header)&&rows.some(row=>needsReferences(row.message)||needsReferences(row.previous?.message)||needsReferences(row.previous)||Boolean(row.previous?.metadata?.fields?.desktopReferences?.length)))throw Object.assign(Error('Desktop reference support required'),{code:'DESKTOP_REFERENCE_CLIENT_UPGRADE_REQUIRED',status:409});
 if(!supported(header,SOURCE_DATA_CAPABILITY)&&rows.some(row=>requiresSourceDataV2(row.message,row.metadata||row.message?._nativeSyncMetadata)||requiresSourceDataV2(row.previous?.message||row.previous,row.previous?.metadata)))throw Object.assign(Error('Source data v2 support required'),{code:'SOURCE_DATA_CLIENT_UPGRADE_REQUIRED',status:409});
 return page;
}
module.exports={REFERENCE_CAPABILITY,SOURCE_DATA_CAPABILITY,supported,needsReferences,requireReferenceReader};
