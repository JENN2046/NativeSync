// Two bounded views: pending/review work and recent history. Pagination never
// stands in for the exact request lookup used by submission recovery.
export function createExecutionPager(){
 let owner='',state={},epoch=0;
 const reset=()=>{owner='';state={};epoch++;};
 async function refresh(api,key,current=()=>true){
  if(owner!==key){reset();owner=key;}
  const revision=epoch,request=async mode=>{
   const cursor=state[mode]?.cursor;
   const page=await api('conversations/'+encodeURIComponent(key)+'/executions?'+new URLSearchParams({mode,limit:'64',...(cursor?{cursor}:{})}));
   if(page.version!==2||page.topicKey!==key||page.mode!==mode||!Array.isArray(page.executions)||page.executions.length>64||!Number.isSafeInteger(page.total)||typeof page.hasMore!=='boolean'||(page.hasMore&&(typeof page.next!=='string'||!page.next||page.next===cursor)))throw Error('执行分页校验失败');
   if(page.executions.some(r=>r.topicKey!==key)||new Set(page.executions.map(r=>r.id)).size!==page.executions.length)throw Error('执行分页身份不一致');
   return {cursor,page};
  };
  const [attention,recent]=await Promise.all(['attention','recent'].map(request));if(!current()||owner!==key||revision!==epoch)return null;
  state={attention,recent};const rows=[...new Map([...attention.page.executions,...recent.page.executions].map(r=>[r.id,r])).values()];
  return {rows,total:recent.page.total,attentionTotal:attention.page.total,moreRecent:recent.page.hasMore,moreAttention:attention.page.hasMore,historyPage:Boolean(recent.cursor||attention.cursor)};
 }
 function next(mode){if(!['recent','attention'].includes(mode)||!state[mode]?.page?.hasMore)return;state[mode]={cursor:state[mode].page.next,page:null};epoch++;}
 return {refresh,next,reset};
}
