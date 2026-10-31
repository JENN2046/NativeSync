'use strict';
const {stable,sha256}=require('./protocol');
module.exports=require('./contracts.generated.cjs').createMetadata({stable,sha256,byteLength:value=>Buffer.byteLength(value)});
