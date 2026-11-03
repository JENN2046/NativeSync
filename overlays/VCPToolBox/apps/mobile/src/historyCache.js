// Page-local, suspended histories only. The active view keeps its existing
// history map; no bodies, cursors or authorization are written to storage.
export function historyCacheKey(recovery,topic){
 if(recovery?.version!==1||!(/^[a-f0-9]{64}$/).test(recovery.entryId||'')||!(/^[a-f0-9]{64}$/).test(recovery.sessionMarker||'')||topic?.historyProtocol!==2||topic.historyReady!==true)return '';
 if(!topic.key||!topic.ownerType||!topic.ownerId||!topic.topicId)return '';
 return JSON.stringify([recovery.entryId,recovery.sessionMarker,topic.sourceId||'',topic.ownerType,topic.ownerId,topic.topicId,topic.key]);
}
export function createHistoryCache({maxTopics=3,maxEstimatedBytes=32*1024*1024}={}){
 const entries=new Map();let bytes=0;
 function remove(key){const prior=entries.get(key);if(prior){bytes-=prior.bytes;entries.delete(key);}return prior;}
 function estimate(rows){
  let size=64+rows.size*64;const seen=new Set(),pending=[...rows.values()];
  while(pending.length){
   const value=pending.pop();
   if(typeof value==='string')size+=16+value.length*2;
   else if(value&&typeof value==='object'){
    if(seen.has(value))continue;seen.add(value);size+=48;
    for(const [key,child]of Object.entries(value)){size+=16+key.length*2;pending.push(child);}
   }else size+=8;
   if(size>maxEstimatedBytes)return size;
  }
  return size;
 }
 return {
  put(key,rows,cursor){
   remove(key);if(!key||!(rows instanceof Map)||!Number.isSafeInteger(cursor)||cursor<0)return false;
   const cost=estimate(rows);if(cost>maxEstimatedBytes||maxTopics<1)return false;
   while(entries.size>=maxTopics||bytes+cost>maxEstimatedBytes)remove(entries.keys().next().value);
   entries.set(key,{rows,cursor,bytes:cost});bytes+=cost;return true;
  },
  // Transfer the map to the active reader, which may then apply new deltas.
  take(key){const entry=remove(key);return entry?{rows:entry.rows,cursor:entry.cursor}:null;},
  has:key=>entries.has(key),
  remove,
  retain(keys){const allowed=new Set(keys);for(const key of entries.keys())if(!allowed.has(key))remove(key);},
  clear(){entries.clear();bytes=0;},
  metrics:()=>({topics:entries.size,estimatedBytes:bytes})
 };
}
