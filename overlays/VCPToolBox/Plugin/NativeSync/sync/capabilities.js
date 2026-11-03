'use strict';
const REFERENCE_CAPABILITY='desktop-references-v1';
const supported=header=>String(header||'').split(',').map(s=>s.trim()).includes(REFERENCE_CAPABILITY);
const needsReferences=message=>Boolean(message?.desktopReferences?.length||message?._nativeSyncMetadata?.fields?.desktopReferences?.length);
function requireReferenceReader(page,header){
 if(supported(header))return page;
 const rows=[...(page?.events||[]),...(page?.messages||[])];
 if(rows.some(row=>needsReferences(row.message)||needsReferences(row.previous?.message)||needsReferences(row.previous)||Boolean(row.previous?.metadata?.fields?.desktopReferences?.length)))throw Object.assign(Error('Desktop reference support required'),{code:'DESKTOP_REFERENCE_CLIENT_UPGRADE_REQUIRED',status:409});
 return page;
}
module.exports={REFERENCE_CAPABILITY,supported,needsReferences,requireReferenceReader};
