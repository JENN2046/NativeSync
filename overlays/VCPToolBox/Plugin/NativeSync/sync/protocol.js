'use strict';
// Host-owned canonicalization and Node crypto remain at the adapter boundary.
const crypto=require('node:crypto');
const {canonicalizeMessage,BoundedWarnings,messageContentHash}=require('./canonical/canonical');
const {stableStringify}=require('./canonical/hash');
module.exports=require('./contracts.generated.cjs').createProtocol({canonicalizeMessage,BoundedWarnings,messageContentHash,stableStringify,sha256:value=>crypto.createHash('sha256').update(value).digest('hex')},()=>require('./metadata'));
