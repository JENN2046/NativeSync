// One bounded request per existing refresh. A round freezes message IDs, not
// bodies, so continuous appends cannot prevent older missing files being checked
// again. No upload, persistence, or execution capability lives in this pager.
export function createAttachmentStatusPager(){
 let epoch=0,remaining=[],states={},signatures=new Map();
 const key=(m,a)=>m+'/'+a;
 const describe=messages=>{
  const ids=[],current=new Map();
  for(const message of messages){
   if(!message.attachments?.length)continue;ids.push(message.id);
   for(const a of message.attachments)current.set(key(message.id,a.id),JSON.stringify([a.hash,a.blobHash,a.frameHashes]));
  }
  return {ids:[...new Set(ids)],current};
 };
 const prune=current=>{
  states=Object.fromEntries(Object.entries(states).filter(([k])=>current.has(k)&&signatures.get(k)===current.get(k)));
  signatures=new Map([...signatures].filter(([k])=>Object.hasOwn(states,k)));
 };
 return {
  reset(){epoch++;remaining=[];states={};signatures=new Map();},
  select(messages){
   const {ids,current}=describe(messages);prune(current);const live=new Set(ids);
   remaining=remaining.filter(id=>live.has(id));if(!remaining.length)remaining=[...ids];
   return {epoch,ids:remaining.slice(0,100),signatures:current,retained:{...states}};
  },
  merge(batch,rows,messages){
   if(batch.epoch!==epoch)return {...states};
   if(!Array.isArray(rows))throw Error('附件状态响应无效');
   const {current}=describe(messages);prune(current);const requested=new Set(batch.ids);
   for(const [k,row]of Object.entries(states))if(requested.has(row.messageId))delete states[k];
   for(const row of rows){
    const k=key(row.messageId,row.attachmentId);
    if(requested.has(row.messageId)&&current.has(k)&&batch.signatures.get(k)===current.get(k)){
     states[k]=row;signatures.set(k,current.get(k));
    }
   }
   remaining=remaining.filter(id=>!requested.has(id));return {...states};
  },
 };
}
