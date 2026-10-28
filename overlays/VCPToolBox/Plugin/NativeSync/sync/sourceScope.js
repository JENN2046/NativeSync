'use strict';
const {identity,stable,sha256}=require('./protocol');
const fail=code=>Object.assign(Error(code),{code,status:403});
// Absence alone means the legacy full-root contract. A malformed explicit
// limited contract must never downgrade to that legacy authority.
function normalizeScope(value){
 if(value===undefined)return null;
 if(!value||Array.isArray(value)||typeof value!=='object')throw fail('INVALID_SOURCE_SCOPE');
 if(value.mode==='full'&&Object.keys(value).length===1)return null;
 if(value.mode!=='limited'||Object.keys(value).some(k=>!['mode','topics'].includes(k))||!Array.isArray(value.topics)||!value.topics.length||value.topics.length>128)throw fail('INVALID_SOURCE_SCOPE');
 const keys=new Set(),topics=value.topics.map(t=>{
  if(!t||Object.keys(t).length!==3||Object.keys(t).some(k=>!['ownerType','ownerId','topicId'].includes(k)))throw fail('INVALID_SOURCE_SCOPE');
  try{identity({...t,msgId:'_scope'});}catch{throw fail('INVALID_SOURCE_SCOPE');}
  const row={ownerType:t.ownerType,ownerId:t.ownerId,topicId:t.topicId},key=stable(row);
  if(keys.has(key))throw fail('INVALID_SOURCE_SCOPE');keys.add(key);return row;
 }).sort((a,b)=>stable(a)<stable(b)?-1:stable(a)>stable(b)?1:0);
 return {mode:'limited',topics};
}
const scopeHash=value=>{const s=normalizeScope(value);return s?sha256(stable(s)):null;};
function permits(scope,d,owner=false){
 const s=scope===null?null:normalizeScope(scope);if(!s)return true;
 return s.topics.some(t=>t.ownerType===(d.ownerType||d.itemType||'agent')&&t.ownerId===(d.ownerId||d.itemId)&&(owner||t.topicId===d.topicId));
}
module.exports={normalizeScope,scopeHash,permits};
