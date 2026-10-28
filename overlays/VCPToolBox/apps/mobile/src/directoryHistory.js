// A whole directory revision is published to the view only after every page.
// Failures retain the previous view; absence in a failed read is never removal.
export async function readDirectoryPages(api,current=()=>true){
 for(let attempt=0;attempt<3;attempt++){
  try{
   const marker=await api('directory?kind=revision');if(!current())return null;
   const output={revision:marker.revision,agents:[],topics:[],sourceProgress:marker.sourceProgress||[]};
   for(const kind of ['agents','topics']){
    let cursor='',pages=0;const seen=new Set();
    do{
     if(++pages>10000)throw Object.assign(Error('目录分页未能完成'),{code:'DIRECTORY_PAGE_LIMIT'});
     const result=await api('directory?'+new URLSearchParams({kind,limit:'100',revision:marker.revision,...(cursor?{cursor}:{})}));
     if(!current())return null;
     if(result.revision!==marker.revision||!Array.isArray(result[kind])||result[kind].length>100||typeof result.hasMore!=='boolean')throw Object.assign(Error('目录版本校验失败'),{code:'DIRECTORY_INVALID'});
     for(const row of result[kind]){const key=kind==='agents'?JSON.stringify([row.ownerType,row.id]):row.key;if(!key||seen.has(key))throw Object.assign(Error('目录身份重复'),{code:'DIRECTORY_INVALID'});seen.add(key);output[kind].push(row);}
     if(!result.hasMore)break;if(!result.next||result.next===cursor)throw Object.assign(Error('目录分页停滞'),{code:'DIRECTORY_INVALID'});cursor=result.next;
    }while(true);
   }
   return output;
  }catch(e){if(e.code!=='DIRECTORY_REVISION_CHANGED'||attempt===2)throw e;}
 }
}
// Initial history is an immutable Journal prefix, followed by normal deltas.
// A mutable messages.last_seq page is retained only for explicitly old servers.
export async function readHistoryBaseline(api,key,requestId,current=()=>true){
 const route='conversations/'+encodeURIComponent(key),snapshot=await api(route+'/baseline',{requestId});if(!current())return null;
 if(!snapshot.id||!Number.isSafeInteger(snapshot.watermark)||!Number.isSafeInteger(snapshot.total))throw Error('历史基线无效');
 const rows=new Map(),seen=new Set();let after=0,count=0,pages=0;
 do{
  if(++pages>100000)throw Error('历史分页未能完成');
  const r=await api(route+'/baseline/'+encodeURIComponent(snapshot.id)+'?after='+after+'&limit=100');if(!current())return null;
  if(r.id!==snapshot.id||r.watermark!==snapshot.watermark||r.total!==snapshot.total||!Array.isArray(r.events)||r.events.length>100||typeof r.hasMore!=='boolean')throw Error('历史基线已变化');
  let previous=after;for(const event of r.events){if(!Number.isSafeInteger(event.position)||event.position<=previous||!Number.isSafeInteger(event.seq)||event.seq>r.watermark||seen.has(event.msgId)||!['delete','upsert'].includes(event.action))throw Error('历史分页身份无效');previous=event.position;seen.add(event.msgId);if(event.action==='upsert'){if(event.message?.id!==event.msgId)throw Error('历史消息身份无效');rows.set(event.msgId,event.message);}count++;}
  if(!Number.isSafeInteger(r.next)||r.next<previous||(r.hasMore&&r.next===after))throw Error('历史分页停滞');after=r.next;
  if(!r.hasMore)break;
 }while(true);
 if(count!==snapshot.total)throw Error('历史分页未完成');return {rows,cursor:snapshot.watermark};
}
