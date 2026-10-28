<script setup>
import {ref,computed,onMounted,onUnmounted,nextTick} from 'vue';
import {readDirectoryPages,readHistoryBaseline} from './directoryHistory.js';
import {createAttachmentStatusPager} from './attachmentStatus.js';
import {uploadAttachment} from './attachmentUpload.js';
import {createSubmissionRecovery,validSessionRecovery,SUBMISSION_STORAGE_KEY} from './submissionRecovery.js';
import {projectNativeWork,verifyNativeResult,nativeTaskLabels,toolLabels,resultHash} from './nativeTasks.js';
const attachmentPager=createAttachmentStatusPager();
const attachmentStates=ref({}),reviewChecks=ref({}),invitedAgent=ref('');
// Unsent drafts belong to this page and one entry/owner/topic. They never enter
// the durable submission store until the existing explicit send path is used.
const drafts=new Map(),composerDraft=ref({text:'',files:[],revision:0});let composerScope='';
const text=computed({get:()=>composerDraft.value.text,set:value=>{composerDraft.value.text=value;composerDraft.value.revision++;}});
const pendingFiles=computed({get:()=>composerDraft.value.files,set:value=>{composerDraft.value.files=value;}});
const nativeResult=ref(null),nativeResultPanel=ref(null);let nativeResultRequest=0;
const paired=ref(false),pairCode=ref(''),topics=ref([]),selected=ref(''),agentId=ref(''),messages=ref([]),jobs=ref([]),busy=ref(false),notice=ref('正在连接…'),online=ref(false),history=ref(null);
const directoryAgents=ref(null),directoryNotice=ref(''),sourceProgress=ref([]);
let directoryPaged=false,directoryRevision='',directoryLoading=false,directoryRequest=0,baselineReady=false,baselineRequestId='';
const settingsOpen=ref(false),serverUrl=ref(''),accessKey=ref(''),server=ref(null),tested=ref(false);
const recoveryContext=ref(null),recoveryRecords=ref([]),recoveryError=ref(''),recoveryDetail=ref(''),acceptedReceipt=ref(null);
const browserOrigin=window.location.origin;
const submissionStore=createSubmissionRecovery({origin:browserOrigin,getStorage:()=>window.localStorage});
let timer,refreshing=false,historyKey='',cursor=0,historyRows=new Map(),generation=0,authEpoch=0,submissionNoticeHeld=false;
const ownerKey=t=>JSON.stringify([t.ownerType||'agent',t.ownerId||t.agentName]);
const labels={waiting_approval:'等待原生工具审批',review_required:'执行中断 · 接力已暂停',blocked_config:'上下文或配置不可用 · 接力已暂停',recovering:'正在恢复已保存的结果',interrupted:'已中断 · 不自动重跑',preparing:'正在持久保存',queued:'已接受 · 等待执行',running:'服务端执行中',cancelling:'正在取消',cancelled:'已取消',publishing:'正在保存回复',completed:'回复已保存',failed:'执行失败'};
const agents=computed(()=>directoryAgents.value?directoryAgents.value.map(a=>({...a,id:JSON.stringify([a.ownerType||'agent',a.id]),name:(a.ownerType==='group'?'群聊 · ':'')+a.name})):[...new Map(topics.value.map(t=>[ownerKey(t),{id:ownerKey(t),name:(t.ownerType==='group'?'群聊 · ':'')+t.agentName,avatar:t.avatar,model:t.model,executable:t.executable}])).values()]);
const visibleTopics=computed(()=>topics.value.filter(t=>ownerKey(t)===agentId.value));
const currentTopic=computed(()=>topics.value.find(t=>t.key===selected.value));
function draftScope(){const topic=currentTopic.value;return paired.value&&validSessionRecovery(recoveryContext.value)&&topic?JSON.stringify([recoveryContext.value.entryId,ownerKey(topic),topic.topicId,topic.key]):'';}
function switchDraft(){
 const next=draftScope();if(next===composerScope)return;
 if(composerScope&&!text.value&&!pendingFiles.value.length&&!composerDraft.value.submitted)drafts.delete(composerScope);
 composerScope=next;composerDraft.value=drafts.get(next)||{text:'',files:[],revision:0};
 if(next)drafts.set(next,composerDraft.value);
}
function confirmDraft(record,context){
 const draft=drafts.get(context.draftScope),sent=draft?.submitted;
 if(!sent||sent.requestId!==record.requestId)return;
 if(draft.revision===sent.revision&&draft.text===record.payload.text)draft.text='';
 draft.files=draft.files.filter(item=>!sent.files.includes(item));
 delete draft.submitted;
 if(context.draftScope!==composerScope&&!draft.text&&!draft.files.length)drafts.delete(context.draftScope);
}
// Keep the original executions for submission reconciliation. This separate
// projection only displays bounded, correlated native task facts.
const displayJobs=computed(()=>jobs.value.map(job=>{try{if(job.topicKey!==selected.value)throw Error('NATIVE_TASK_TOPIC_MISMATCH');return {...job,...projectNativeWork(job)};}catch{return {...job,nativeTasks:[],toolInvocations:[],nativeTaskError:'原生任务关联暂不能核对，请刷新或在宿主检查。'};}}));
const keyAllowed=computed(()=>Boolean(isSecureContext&&server.value?.credentialExchangeAllowed));
const pendingSubmission=computed(()=>recoveryRecords.value.find(record=>record.entryId===recoveryContext.value?.entryId&&record.topicKey===selected.value)||null);
const recoveryBlocker=computed(()=>recoveryError.value||(!validSessionRecovery(recoveryContext.value)?'当前服务端未提供可靠提交恢复信息，暂不能发送。':''));
const newSubmissionBlocked=computed(()=>Boolean(recoveryBlocker.value||pendingSubmission.value));
const recoveryMessages={SUBMISSION_LOCK_UNAVAILABLE:'当前浏览器无法取得跨页面提交保护；已有原记录或草稿会继续保留，提交是否受理请先核对。请使用支持此保护的安全浏览器入口。',SUBMISSION_STORE_UNAVAILABLE:'无法保存或读取待确认提交，请检查浏览器存储后再试。',SUBMISSION_STORE_CORRUPT:'本地待确认提交校验失败，原记录已保留，请先核对。',SUBMISSION_STORE_BUDGET:'本地待确认提交已达到保存上限，请先核对已有提交。',SUBMISSION_STORE_UNVERIFIED:'待确认提交未能完成保存校验，本次未获本地确认。',SUBMISSION_CRYPTO_UNAVAILABLE:'当前入口无法校验提交身份，暂不能发送。',SUBMISSION_RECOVERY_UNAVAILABLE:'当前服务端未提供可靠提交恢复信息，暂不能发送。',SUBMISSION_TOPIC_UNAVAILABLE:'当前会话未获此话题授权，原提交继续保留，请使用原有授权核对。',SUBMISSION_CONTEXT_CHANGED:'提交前会话或入口已变化，服务端未受理，原提交保留待核对。',SUBMISSION_PENDING:'本话题有待确认提交，请先核对原提交；其他话题仍可使用。',SUBMISSION_RECORD_CHANGED:'待确认记录已变化，请重新核对，不会另建提交。',SUBMISSION_RECEIPT_UNVERIFIED:'回执未能唯一匹配原提交，已保留记录等待核对。',SUBMISSION_INVALID:'提交内容或身份不完整，本次未发送。'};
const recoveryReasons={metadata:'缺少可信恢复信息，原提交保留待核对，不会补发。',scope:'执行列表与原话题不一致，原提交保留待核对。',ambiguous:'发现多个同身份候选，原提交保留待核对。',conflict:'云端候选与原提交身份或内容不同，原提交保留待核对。',session:'会话已变更，尚未查到原提交的可信结果；原记录保留，不会在新会话补发。'};
function recoveryMessage(error){return recoveryMessages[error.code]||error.message||'无法核对原提交，请稍后再试。';}
function loadRecovery(){try{recoveryRecords.value=submissionStore.load();recoveryError.value='';return true;}catch(error){recoveryError.value=recoveryMessage(error);return false;}}
function invalidateSession(){directoryRequest++;closeNativeResult();authEpoch++;submissionNoticeHeld=false;recoveryContext.value=null;switchDraft();recoveryDetail.value='';acceptedReceipt.value=null;loadRecovery();}
function captureContext(){if(!paired.value||!selected.value||!validSessionRecovery(recoveryContext.value))throw Object.assign(Error(recoveryMessages.SUBMISSION_RECOVERY_UNAVAILABLE),{code:'SUBMISSION_RECOVERY_UNAVAILABLE'});return {topicKey:selected.value,recovery:{...recoveryContext.value},generation,authEpoch,draftScope:draftScope()};}
function sameView(context){return context.topicKey===selected.value&&context.generation===generation&&context.authEpoch===authEpoch&&context.recovery?.entryId===recoveryContext.value?.entryId&&context.recovery?.sessionMarker===recoveryContext.value?.sessionMarker;}
function newSubmissionContext(){if(!loadRecovery())throw Error(recoveryError.value);const context=captureContext();if(!currentTopic.value)throw Object.assign(Error(recoveryMessages.SUBMISSION_TOPIC_UNAVAILABLE),{code:'SUBMISSION_TOPIC_UNAVAILABLE'});if(submissionStore.current({entryId:context.recovery.entryId,topicKey:context.topicKey}))throw Object.assign(Error(recoveryMessages.SUBMISSION_PENDING),{code:'SUBMISSION_PENDING'});return context;}
const errors={GROUP_MODE_REQUIRES_DESKTOP:'此群聊模式请在桌面执行',GROUP_MEMBER_UNAVAILABLE:'此成员配置暂不可用',DEPENDENCY_REVIEW_REQUIRED:'同一话题有待核对的执行，请先处理暂停任务',DESKTOP_CONTEXT_REQUIRED:'此消息引用了仅在桌面可用的上下文',CONFIG_SNAPSHOT_CORRUPT:'执行配置校验失败，请在桌面重新发布',GROUP_CONTEXT_UNAVAILABLE:'有效上下文暂不可用',ATTACHMENT_BLOB_MISSING:'附件暂未同步，请等待电脑补齐',ATTACHMENT_BLOB_CORRUPT:'附件完整性校验失败，请重新同步',ATTACHMENT_TEXT_UNAVAILABLE:'此文件的文本尚不可用',ATTACHMENT_TYPE_REJECTED:'支持 PNG、JPEG、WebP、PDF 和 UTF-8 文本文件',ATTACHMENT_STORAGE_BUDGET:'附件空间已达到上限',ATTACHMENT_REQUEST_BUDGET:'附件请求过多，请稍后重试',MODEL_IMAGE_UNSUPPORTED:'当前模型不支持图片，请在电脑端选择支持图片的模型并发布配置',EXECUTION_CONFIG_REQUIRED:'请先在电脑端发布有效 Agent 配置',PAIR_REQUIRED:'输入你的 Key 连接会话',HTTPS_REQUIRED:'当前入口尚未启用 HTTPS，不能提交 Key',SERVER_NOT_APPROVED:'此地址尚未由服务端批准，请使用已获授权的服务器',PROTECTED_HOST_NOT_READY:'安全链路或服务端接入尚未就绪，暂不接收访问凭据',AUTH_FAILED:'访问凭据不正确',AUTH_RATE_LIMIT:'尝试过于频繁，请稍后重试',AGENT_NOT_EXECUTABLE:'此 Agent 尚未配置服务端执行能力',EXECUTION_INTERRUPTED_REVIEW_REQUIRED:'执行曾被中断，需确认工具副作用后另行发起，系统不会自动重跑'};
async function api(route,body,requestHeaders={}){
 const requestEpoch=authEpoch;
 const r=await fetch('/mobile/api/'+route,{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',redirect:'error',headers:body?{'Content-Type':'application/json',...requestHeaders}:{},body:body?JSON.stringify(body):undefined});
 const result=await r.json();if(!r.ok){if(r.status===401&&result.error?.code==='PAIR_REQUIRED'&&requestEpoch===authEpoch){paired.value=false;invalidateSession();notice.value=errors.PAIR_REQUIRED+'；本地待确认提交继续保留。';}throw Object.assign(Error(errors[result.error?.code]||'请求未完成，请检查连接'),{code:result.error?.code,status:r.status});}return result;
}
function resetHistory(){attachmentPager.reset();baselineReady=false;baselineRequestId='';switchDraft();closeNativeResult();invitedAgent.value='';reviewChecks.value={};attachmentStates.value={};generation++;submissionNoticeHeld=false;historyKey='';cursor=0;historyRows=new Map();messages.value=[];jobs.value=[];recoveryDetail.value='';acceptedReceipt.value=null;loadRecovery();}
async function setDirectory(result,{initial=false,selectedTopic=null,adjustSelection=true}={}){
 const previous=selected.value,previousAgent=agentId.value;
 topics.value=result.topics;directoryAgents.value=Array.isArray(result.agents)?result.agents:null;sourceProgress.value=result.sourceProgress||[];
 directoryRevision=result.revision||'';
 if(adjustSelection){
  const preferred=topics.value.find(t=>t.key===(previous||(initial?selectedTopic:null)));
  if(preferred){agentId.value=ownerKey(preferred);selected.value=preferred.key;}
  else{agentId.value=agents.value.some(a=>a.id===previousAgent)?previousAgent:agents.value[0]?.id||'';selected.value=visibleTopics.value[0]?.key||'';}
  if(previous&&previous!==selected.value)directoryNotice.value='原话题已删除或当前会话已失去访问权限；本页草稿和待确认提交仍保留。';
  else directoryNotice.value='';
  if(previous!==selected.value)resetHistory();else switchDraft();
 }
}
async function refreshDirectory(force=false,{adjustSelection=true}={}){
 if(!paired.value||!directoryPaged||directoryLoading)return;
 directoryLoading=true;const request=++directoryRequest,epoch=authEpoch;const current=()=>request===directoryRequest&&epoch===authEpoch&&paired.value;
 try{
  const marker=await api('directory?kind=revision');if(!current())return;
  sourceProgress.value=marker.sourceProgress||[];
  if(!force&&marker.revision===directoryRevision)return;
  const result=await readDirectoryPages(api,current);if(result&&current())await setDirectory(result,{adjustSelection});
 }catch(e){if(current()){directoryNotice.value='目录暂未更新，保留上次列表：'+e.message;throw e;}}
 finally{directoryLoading=false;}
}
async function session(){const epoch=authEpoch;try{
 const r=await api('session');if(epoch!==authEpoch)return;
 const nextRecovery=validSessionRecovery(r.recovery)?{version:1,entryId:r.recovery.entryId,sessionMarker:r.recovery.sessionMarker}:null;
 if(nextRecovery?.entryId!==recoveryContext.value?.entryId||nextRecovery?.sessionMarker!==recoveryContext.value?.sessionMarker){authEpoch++;closeNativeResult();submissionNoticeHeld=false;acceptedReceipt.value=null;recoveryDetail.value='';}
 recoveryContext.value=nextRecovery;paired.value=true;online.value=true;server.value=r.server||server.value;serverUrl.value=r.server?.serverUrl||serverUrl.value;
 directoryPaged=r.directory?.paged===true;
 const currentEpoch=authEpoch,result=directoryPaged?await readDirectoryPages(api,()=>currentEpoch===authEpoch):{topics:r.topics,agents:r.agents};
 if(!result||currentEpoch!==authEpoch)return;await setDirectory(result,{initial:true,selectedTopic:r.selectedTopic});loadRecovery();await refresh();
 }catch(e){notice.value=e.message;}}

async function pair(){busy.value=true;invalidateSession();try{await api('pair',{code:pairCode.value});pairCode.value='';resetHistory();await session();settingsOpen.value=false;}catch(e){notice.value=e.message;}finally{busy.value=false;}}
async function connectionInfo(){try{server.value=await api('connection');serverUrl.value=server.value.serverUrl||server.value.suggestedServerUrl||'';online.value=true;if(keyAllowed.value){server.value=await api('connection/test',{serverUrl:serverUrl.value});tested.value=true;}}catch{notice.value='安全连接尚未就绪，尚未提交任何凭据';}}
async function testConnection(){busy.value=true;tested.value=false;accessKey.value='';try{server.value=await api('connection/test',{serverUrl:serverUrl.value});tested.value=true;notice.value='服务器身份和受保护接入已确认';}catch(e){notice.value=e.message;}finally{busy.value=false;}}
async function connect(){if(!keyAllowed.value||!tested.value)return;busy.value=true;const key=accessKey.value;accessKey.value='';invalidateSession();try{await api('connection/authenticate',{serverUrl:serverUrl.value,apiKey:key});resetHistory();await session();settingsOpen.value=false;notice.value='已保存服务器连接，使用受限设备会话；待确认提交继续保留。';}catch(e){notice.value=e.message;}finally{busy.value=false;}}
async function disconnect(){busy.value=true;accessKey.value='';try{await api('connection/disconnect',{});paired.value=false;invalidateSession();topics.value=[];directoryAgents.value=null;sourceProgress.value=[];directoryRevision='';resetHistory();tested.value=false;settingsOpen.value=true;notice.value='此设备会话已撤销，待确认提交继续保留，可重新认证核对。';}catch(e){notice.value=e.message;}finally{busy.value=false;}}
function selectAgent(){selected.value=visibleTopics.value[0]?.key||'';changeTopic();}
async function changeTopic(){resetHistory();if(!selected.value)return;try{await api('selection',{key:selected.value});await refresh();}catch(e){notice.value=e.message;}}
async function refresh(){
 if(!paired.value||!selected.value||refreshing)return;refreshing=true;const key=selected.value,epoch=generation,sessionEpoch=authEpoch,context=validSessionRecovery(recoveryContext.value)?captureContext():null;
 const stick=historyKey!==key||!history.value||history.value.scrollHeight-history.value.scrollTop-history.value.clientHeight<80;
 try{if(historyKey!==key){historyRows=new Map();cursor=0;historyKey=key;baselineReady=false;baselineRequestId='';}let result;
  const current=()=>selected.value===key&&epoch===generation&&sessionEpoch===authEpoch;
  if(currentTopic.value?.historyProtocol===2){
   if(!baselineReady){baselineRequestId ||= crypto.randomUUID();const baseline=await readHistoryBaseline(api,key,baselineRequestId,current);if(!baseline||!current())return;historyRows=baseline.rows;cursor=baseline.cursor;baselineReady=true;}
   do{result=await api('conversations/'+encodeURIComponent(key)+'/events?after='+cursor+'&limit=100');if(!current())return;
    if(!Array.isArray(result.events)||!Number.isSafeInteger(result.nextSeq)||result.nextSeq<cursor||result.nextSeq>result.headSeq||(result.hasMore&&result.nextSeq===cursor))throw Error('历史增量游标无效');
    let last=cursor;for(const e of result.events){if(!Number.isSafeInteger(e.seq)||e.seq<=last||e.seq>result.nextSeq)throw Error('历史增量顺序无效');last=e.seq;if(e.action==='delete')historyRows.delete(e.msgId);else if(e.action==='upsert'&&e.message?.id===e.msgId)historyRows.set(e.msgId,e.message);else throw Error('历史增量身份无效');}cursor=result.nextSeq;
   }while(result.hasMore);
  }else do{result=await api('conversations/'+encodeURIComponent(key)+'?after='+cursor);if(!current())return;for(const row of result.messages){if(row.deleted)historyRows.delete(row.id);else historyRows.set(row.id,row.message);}cursor=result.next;}while(result.hasMore);
  messages.value=[...historyRows.values()].sort((a,b)=>a.timestamp-b.timestamp);jobs.value=result.executions;online.value=true;if(currentTopic.value){currentTopic.value.messageCount=messages.value.length;if(result.topicState)Object.assign(currentTopic.value,result.topicState);}
  if(context&&loadRecovery()){const pending=submissionStore.current({entryId:context.recovery.entryId,topicKey:key});if(pending)await reconcileSubmission(pending,result.executions,context);}
  if(selected.value!==key||epoch!==generation||sessionEpoch!==authEpoch)return;
  if(currentTopic.value?.attachmentsEnabled){const batch=attachmentPager.select(messages.value);attachmentStates.value=batch.retained;if(batch.ids.length){const status=await api('conversations/'+encodeURIComponent(key)+'/attachments/status',{messageIds:batch.ids});if(selected.value!==key||epoch!==generation||sessionEpoch!==authEpoch)return;attachmentStates.value=attachmentPager.merge(batch,status.attachments,messages.value);}}
  if(!busy.value&&!submissionNoticeHeld)notice.value=recoveryBlocker.value||(pendingSubmission.value?'本地提交仍待核对，未发起新请求。':'中央会话已更新');await nextTick();if(stick&&history.value&&selected.value===key&&epoch===generation)history.value.scrollTop=history.value.scrollHeight;
 }catch(e){if(selected.value===key&&epoch===generation&&sessionEpoch===authEpoch){online.value=false;if(!submissionNoticeHeld){notice.value=recoveryMessage(e);if(e.code?.startsWith('SUBMISSION_'))submissionNoticeHeld=true;}}}finally{refreshing=false;}
}
async function reconcileSubmission(record,executions,context){
 const result=await submissionStore.inspect(record,executions,context.recovery);
 if(result.state==='confirmed'){
  await submissionStore.confirm(record,result.execution,context.recovery);
  if(!loadRecovery())throw Error(recoveryError.value);
  if(record.kind==='message')confirmDraft(record,context);
  if(sameView(context)){
   submissionNoticeHeld=false;
   acceptedReceipt.value={requestId:record.requestId,id:result.execution.id};recoveryDetail.value='';
   if(record.kind==='invitation'&&invitedAgent.value===record.payload.agentId)invitedAgent.value='';
  }
 }else if(sameView(context)){recoveryDetail.value=result.state==='absent'?'尚未查到云端接受记录。点击核对 / 重试只会使用原提交身份和内容。':recoveryReasons[result.reason];}
 return result;
}
async function postPrepared(record,context){
 await submissionStore.verify(record);submissionStore.requireCurrent(record);
 if(!sameView(context))return;
 notice.value='本地已保存 · 正在等待云端确认…';
 const accepted=await api('conversations/'+encodeURIComponent(record.topicKey)+(record.kind==='invitation'?'/invitations':'/messages'),record.payload,{'X-NativeSync-Entry-Id':record.entryId,'X-NativeSync-Session-Marker':record.sessionMarker});
 const result=await reconcileSubmission(record,[accepted],context);
 if(result.state!=='confirmed')throw Object.assign(Error(recoveryMessages.SUBMISSION_RECEIPT_UNVERIFIED),{code:'SUBMISSION_RECEIPT_UNVERIFIED'});
 if(sameView(context)){
  notice.value='云端已接受 · '+(labels[accepted.state]||accepted.state);
  await refresh();
 }
}
async function submit(submission,kind='message',context=newSubmissionContext()){
 busy.value=true;submissionNoticeHeld=false;
 try{
  if(!sameView(context))return;
  const record=await submissionStore.prepare({entryId:context.recovery.entryId,sessionMarker:context.recovery.sessionMarker,topicKey:context.topicKey,kind,payload:submission});
  if(!loadRecovery())throw Error(recoveryError.value);
  if(sameView(context)){recoveryDetail.value='本地已保存，尚未收到可核验的云端接受回执。';acceptedReceipt.value=null;}
  await postPrepared(record,context);
 }catch(error){loadRecovery();if(sameView(context)){submissionNoticeHeld=true;notice.value='尚未完成提交确认：'+recoveryMessage(error);}}
 finally{busy.value=false;}
}
function selectFiles(event){for(const file of event.target.files||[]){if(pendingFiles.value.length>=8)break;if(file.size>20*1024*1024){notice.value='单个附件需在 20 MB 以内';continue;}if(!pendingFiles.value.some(f=>f.file.name===file.name&&f.file.size===file.size&&f.file.lastModified===file.lastModified))pendingFiles.value.push({file,progress:0,error:'',uploadId:null});}event.target.value='';}
function attachmentUrl(message,attachment){return '/mobile/api/conversations/'+encodeURIComponent(selected.value)+'/attachments/messages/'+encodeURIComponent(message.id)+'/'+encodeURIComponent(attachment.id);}
async function send(){
 if((!text.value.trim()&&!pendingFiles.value.length)||busy.value||currentTopic.value?.executable===false)return;
 let context;busy.value=true;submissionNoticeHeld=false;
 try{context=newSubmissionContext();const draft=composerDraft.value,snapshot={text:draft.text,revision:draft.revision,files:[...draft.files]},ids=[];for(const item of snapshot.files){item.error='';try{if(item.uploadSessionMarker!==context.recovery.sessionMarker)item.uploadId=null;item.uploadId=item.uploadId||await uploadAttachment(api,context.topicKey,item.file,n=>item.progress=n);item.uploadSessionMarker=context.recovery.sessionMarker;ids.push(item.uploadId);}catch(e){item.error=e.message;throw e;}}if(!sameView(context))return;const requestId=crypto.randomUUID();draft.submitted={requestId,revision:snapshot.revision,files:snapshot.files};await submit({requestId,text:snapshot.text,attachments:ids},'message',context);}
 catch(error){if(!context||sameView(context)){submissionNoticeHeld=true;notice.value=recoveryMessage(error);}}finally{busy.value=false;}
}
async function refreshRetrySession(context){
 const result=await api('session');if(!sameView(context))return null;
 const nextRecovery=validSessionRecovery(result.recovery)?{version:1,entryId:result.recovery.entryId,sessionMarker:result.recovery.sessionMarker}:null;
 if(nextRecovery?.entryId!==recoveryContext.value?.entryId||nextRecovery?.sessionMarker!==recoveryContext.value?.sessionMarker){authEpoch++;closeNativeResult();submissionNoticeHeld=false;acceptedReceipt.value=null;recoveryDetail.value='';}
 recoveryContext.value=nextRecovery;directoryPaged=result.directory?.paged===true;
 const readEpoch=authEpoch,directory=directoryPaged?await readDirectoryPages(api,()=>readEpoch===authEpoch):{topics:Array.isArray(result.topics)?result.topics:[],agents:result.agents};
 if(!directory||readEpoch!==authEpoch)return null;await setDirectory(directory,{adjustSelection:false});
 switchDraft();
 // Refresh authorization and the live Cookie's noncredential marker without
 // adopting selectedTopic from another page or clearing this page's draft.
 return {...context,authEpoch,recovery:nextRecovery};
}
async function retry(){
 if(busy.value)return;let context;busy.value=true;submissionNoticeHeld=false;
 try{
  if(!loadRecovery())throw Error(recoveryError.value);context=captureContext();
  const record=submissionStore.current({entryId:context.recovery.entryId,topicKey:context.topicKey});if(!record)return;
  context=await refreshRetrySession(context);if(!context)return;
  if(!validSessionRecovery(context.recovery))throw Object.assign(Error(recoveryMessages.SUBMISSION_RECOVERY_UNAVAILABLE),{code:'SUBMISSION_RECOVERY_UNAVAILABLE'});
  if(!topics.value.some(topic=>topic.key===record.topicKey))throw Object.assign(Error(recoveryMessages.SUBMISSION_TOPIC_UNAVAILABLE),{code:'SUBMISSION_TOPIC_UNAVAILABLE'});
  await submissionStore.verify(record);
  // Executions are not paginated by the history cursor. Always query the
  // authorized topic; cached jobs and the latest own job cannot identify it.
  const response=await api('conversations/'+encodeURIComponent(record.topicKey)+'?after=0');
  if(!sameView(context))return;
  const result=await reconcileSubmission(record,response.executions,context);
  if(result.state==='confirmed'){if(sameView(context)){notice.value='已核对云端接受记录，未重新发送。';await refresh();}return;}
  if(result.state!=='absent'){if(sameView(context)){submissionNoticeHeld=true;notice.value=recoveryReasons[result.reason];}return;}
  // This explicit click is the only resend path. inspect() permits it only
  // when the same session has no candidate for this original request.
  if(sameView(context))await postPrepared(record,context);
 }catch(error){loadRecovery();if(!context||sameView(context)){submissionNoticeHeld=true;notice.value='原提交仍待核对：'+recoveryMessage(error);}}
 finally{busy.value=false;}
}
async function invite(){if(!invitedAgent.value||busy.value||currentTopic.value?.executable===false)return;submissionNoticeHeld=false;try{const context=newSubmissionContext();await submit({requestId:crypto.randomUUID(),agentId:invitedAgent.value},'invitation',context);}catch(error){submissionNoticeHeld=true;notice.value=recoveryMessage(error);}}
function needsReview(j){return j.nativeTasks?.some(task=>task.reviewRequired&&!task.reviewResolved)||(!j.reviewResolved&&(['review_required','blocked_config'].includes(j.state)||j.errorCode?.endsWith('REVIEW_REQUIRED')));}
function canResolveReview(j){
 if(!needsReview(j))return false;
 if(!Array.isArray(j.steps)&&!['group_message','group_invitation'].includes(j.kind))return true;
 return ['review_required','blocked_config','failed','cancelled','completed'].includes(j.state)&&!(j.steps||[]).some(step=>['running','waiting_approval','publishing'].includes(step.state));
}
function closeNativeResult(){nativeResultRequest++;nativeResult.value=null;}
async function showNativeResult(job,task){
 const context={topicKey:selected.value,generation,authEpoch},request=++nativeResultRequest;
 const current=()=>request===nativeResultRequest&&context.topicKey===selected.value&&context.generation===generation&&context.authEpoch===authEpoch;
 nativeResult.value={taskId:task.nativeTaskId,loading:true,content:null,error:null};
 try{
  const value=await api('conversations/'+encodeURIComponent(context.topicKey)+'/executions/'+encodeURIComponent(job.id)+'/native-tasks/'+encodeURIComponent(task.nativeTaskId)+'/result');
  const verified=await verifyNativeResult(value,job.id,task,resultHash);
  if(current()){nativeResult.value={taskId:task.nativeTaskId,loading:false,content:verified.content,error:null};await nextTick();if(current())nativeResultPanel.value?.scrollIntoView({block:'nearest'});}
 }catch(error){if(current())nativeResult.value={taskId:task.nativeTaskId,loading:false,content:null,error:'报告暂不可核对，原任务记录保留。'+(error.code?'（'+error.code+'）':'')};}
}
async function abandon(j){if(!canResolveReview(j)||!reviewChecks.value[j.id])return;try{await api('executions/'+j.id+'/resolve',{action:'acknowledge_and_abandon_remaining'});notice.value='已记录人工核对并解除本次暂停；旧请求不会重跑。这不代表已取消 AA 或撤回工具副作用。';await refresh();}catch(e){notice.value=e.message;}}
async function cancel(id){try{await api('executions/'+id+'/cancel',{});await refresh();}catch(e){notice.value=e.message;}}
function clearTransientKey(){accessKey.value='';pairCode.value='';}
function storageChanged(event){if(event.key===SUBMISSION_STORAGE_KEY||event.key===null){loadRecovery();recoveryDetail.value='';}}
async function refreshView(){try{await refreshDirectory();}catch{}await refresh();}
function reconnect(){loadRecovery();refreshView();}
onMounted(async()=>{loadRecovery();window.addEventListener('pagehide',clearTransientKey);window.addEventListener('storage',storageChanged);window.addEventListener('online',reconnect);await connectionInfo();await session();timer=setInterval(refreshView,2000);});
onUnmounted(()=>{clearInterval(timer);window.removeEventListener('pagehide',clearTransientKey);window.removeEventListener('storage',storageChanged);window.removeEventListener('online',reconnect);clearTransientKey();});
</script>
<template>
 <div class="shell">
  <header><img :src="'/mobile/icon.svg'" alt=""><div><strong>VCP Mobile</strong><small>同一段会话，随时接续</small></div><span class="connection" :class="{offline:!online}">{{online?(paired?'已连接':'服务可达'):'离线'}}</span><button id="open-settings" class="settings-toggle" @click="settingsOpen=!settingsOpen">设置</button></header>
  <main v-if="settingsOpen||!paired" class="pairing settings">
   <div class="intro">连接你的会话</div><p>输入 VCPToolBox API Key。服务器和连接参数已自动配置。</p>
   <form @submit.prevent="connect">
    <details :open="settingsOpen"><summary>连接设置</summary><label for="server-address">后端地址</label><input id="server-address" v-model="serverUrl" type="url" required @input="tested=false;accessKey=''" :disabled="busy">
    <button id="test-connection" type="button" @click="testConnection" :disabled="busy">测试连接</button>
    <p v-if="server" id="server-info">{{server.service}} · {{server.plugin}}<br>{{server.serverUrl||'尚未配置正式后端'}}</p></details>
    <p v-if="!keyAllowed" id="connection-blocker">安全接入尚未确认，访问凭据输入暂不可用。</p>
    <label for="server-key">访问凭据 · VCPToolBox API Key</label><input id="server-key" v-model="accessKey" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" :disabled="busy||!keyAllowed||!tested" :placeholder="keyAllowed&&tested?'只需输入你的 Key':'HTTPS 安全入口就绪后可输入'" :required="keyAllowed&&tested">
    <button id="save-connection" :disabled="busy||!tested||!keyAllowed||!accessKey">{{paired?'重新认证并保存连接':'保存服务器连接'}}</button>
   </form>
   <div v-if="paired" class="device-actions"><button id="disconnect" @click="disconnect" :disabled="busy">断开连接</button><button id="clear-session" @click="disconnect" :disabled="busy">清除设备会话</button><button id="close-settings" @click="settingsOpen=false">返回会话</button></div>
   <details v-if="!paired"><summary>使用一次性配对码</summary><form @submit.prevent="pair"><label for="pair-code">一次性配对码</label><input id="pair-code" v-model="pairCode" type="password" autocomplete="off" required><button id="pair-submit" :disabled="busy">连接会话</button></form></details>
   <p v-if="recoveryRecords.length" id="saved-submissions">此设备保留 {{recoveryRecords.length}} 条待确认提交。重新连接后会核对原记录，不会自动重发。</p><p v-if="recoveryError" role="alert">{{recoveryError}}</p><p role="status">{{notice}}</p>
  </main>
  <template v-else>
   <nav><div class="agent-heading"><img v-if="agents.find(a=>a.id===agentId)?.avatar" :src="agents.find(a=>a.id===agentId).avatar" alt="Agent 头像"><div><label for="agent-select">Agent / 群聊</label><select id="agent-select" v-model="agentId" @change="selectAgent" :disabled="busy"><option v-for="a in agents" :key="a.id" :value="a.id">{{a.name}}</option></select></div></div><label for="topic-select">历史话题</label><select id="topic-select" v-model="selected" @change="changeTopic" :disabled="busy"><option v-for="t in visibleTopics" :key="t.key" :value="t.key">{{t.topicName}} · {{t.messageCount}} 条</option></select><small v-if="currentTopic" class="topic-detail"><template v-if="currentTopic.configVersion">配置 v{{currentTopic.configVersion}} · </template>{{currentTopic.topicId}} · {{currentTopic.model||'未配置模型'}} · {{currentTopic.historyReady===false?'等待电脑首次同步':currentTopic.executable===false?(errors[currentTopic.unavailableReason]||'仅可阅读'):'可继续对话'}}<template v-if="currentTopic.updatedAt"> · {{new Date(currentTopic.updatedAt).toLocaleString()}}</template></small><small v-if="!visibleTopics.length">此 Agent 暂无话题；新话题同步后会自动出现。</small><small v-if="directoryNotice" role="status">{{directoryNotice}}</small><small v-for="progress in sourceProgress" :key="progress.sourceId" class="source-progress">最近已知：目录待核对 {{progress.directoryErrors??'未知'}} · 历史待接入 {{progress.pendingImports??'未知'}} · 本地操作待确认 {{progress.pendingOperations??'未知'}} · 冲突 {{progress.conflicts??'未知'}} · 附件待就绪 {{progress.attachmentsPending??'未知'}}</small></nav>
   <section ref="history" id="history" aria-label="聊天历史"><div class="start">会话 · 服务端持久保存</div><article v-for="m in messages" :key="m.id" class="message" :class="m.role" :data-message-id="m.id"><small>{{m.role==='user'?'你':(m.name||currentTopic?.agentName||'Agent')}}</small><div class="bubble">{{typeof m.content==='string'?m.content:'此消息包含非文本内容，请在桌面查看'}}</div><div v-if="m.attachments?.length" class="attachments"><div v-for="a in m.attachments" :key="a.id" class="attachment"><template v-if="attachmentStates[m.id+'/'+a.id]?.state==='available'"><img v-if="attachmentStates[m.id+'/'+a.id]?.type?.startsWith('image/')" :src="attachmentUrl(m,a)" :alt="a.name||'图片附件'" loading="lazy"><a :href="attachmentUrl(m,a)" target="_blank" rel="noopener">{{a.name||'查看附件'}}</a><details v-if="a.extractedText"><summary>查看文本</summary><pre>{{a.extractedText}}</pre></details></template><span v-else>{{a.name||'附件'}} · {{attachmentStates[m.id+'/'+a.id]?.state==='corrupt'?'完整性校验失败':'附件暂未同步或正在确认'}}</span></div></div></article><p v-if="!messages.length" class="empty">{{currentTopic?.historyReady===false?'正在等待电脑同步所选历史，完成后即可接续。':'还没有消息，发送一条开始会话。'}}</p></section>
   <section v-if="recoveryBlocker||pendingSubmission||acceptedReceipt||recoveryRecords.length" id="submission-recovery" class="submission-recovery" aria-label="提交确认状态" aria-live="polite"><p v-if="recoveryBlocker" role="alert">{{recoveryBlocker}}</p><div v-if="pendingSubmission" id="pending-submission" :data-request-id="pendingSubmission.requestId"><strong>本地已保存 · 云端接受尚待确认</strong><p>{{pendingSubmission.kind==='invitation'?'邀请成员：'+pendingSubmission.payload.agentId:pendingSubmission.payload.text.slice(0,120)||'附件消息'}}</p><small>提交 {{pendingSubmission.requestId}}<template v-if="pendingSubmission.payload.attachments?.length"> · {{pendingSubmission.payload.attachments.length}} 个附件</template></small><p id="submission-recovery-detail">{{recoveryDetail||'原提交已保留。刷新或重连只核对云端记录，不会自动发送。'}}</p></div><p v-else-if="acceptedReceipt" id="accepted-submission" :data-request-id="acceptedReceipt.requestId"><strong>云端已接受</strong> · 提交 {{acceptedReceipt.requestId}}</p><small v-if="recoveryRecords.length>(pendingSubmission?1:0)">此设备另有 {{recoveryRecords.length-(pendingSubmission?1:0)}} 条待确认提交，返回对应入口和话题可核对。</small></section>
   <section class="executions" aria-label="原生执行状态">
    <small v-if="jobs.length">云端已接受 · {{online?'本次查询的原生执行状态':'最近已知状态，联网后重新核对'}}</small>
    <article v-for="j in displayJobs" :key="j.id" class="execution-job" :data-exec-id="j.id" :data-state="j.state">
     <div class="execution-row"><span>{{errors[j.errorCode]?errors[j.errorCode]:(labels[j.state]||j.state)}}<template v-if="j.steps"> · {{j.steps.filter(s=>s.state==='completed').length}} / {{j.stepCount}} 位成员</template></span><button v-if="j.own&&['queued','running','waiting_approval'].includes(j.state)" :data-cancel-id="j.id" @click="cancel(j.id)">{{j.steps?'取消剩余接力':'请求取消本次回复'}}</button></div>
     <ol v-if="j.steps" class="group-steps"><li v-for="step in j.steps" :key="step.id">{{step.name}} · {{labels[step.state]||step.state}}<small v-if="step.errorCode"> · {{errors[step.errorCode]||'本步异常，详情请核对原生宿主'}}</small></li></ol>
     <p v-if="j.nativeTaskError" class="native-task-error" role="alert">{{j.nativeTaskError}}</p>
     <details v-if="j.toolInvocations.length" class="native-tools"><summary>原生工具调用 {{j.toolInvocations.length}} 项（返回不等于 AA 完成）</summary><ul><li v-for="call in j.toolInvocations" :key="call.invocationId">{{call.pluginName}} · {{toolLabels[call.state]}}<small> · 调用 {{call.invocationId}}</small></li></ul></details>
     <details v-for="task in j.nativeTasks" :key="task.nativeTaskId" class="native-aa-task" :data-task-id="task.nativeTaskId" :data-state="task.state">
      <summary>{{nativeTaskLabels[task.state]}} · {{task.agentBaseName}}</summary>
      <small>任务 {{task.nativeTaskId}}<br>调用 {{task.invocationId}}<template v-if="task.stepId"><br>群聊步骤 {{task.stepId}}</template></small>
      <p v-if="task.summary">{{task.summary}}</p>
      <p v-if="task.reviewRequired">{{task.reviewResolved?'已记录人工核对；原生任务状态仍按上方记录显示。':'请在原生宿主核对任务与可能的工具副作用。'}}</p>
      <button v-if="task.resultRef" class="native-result-read" @click="showNativeResult(j,task)">查看已核对报告</button>
     </details>
     <div v-if="j.own&&needsReview(j)" class="review-state"><p>工具是否已经生效仍需核对。解除暂停不会批准工具、重跑旧请求、取消 AA 或撤回副作用。</p><p v-if="!canResolveReview(j)" role="status">当前群成员仍在执行或收尾，请等待当前步骤稳定暂停后再确认。</p><label><input type="checkbox" v-model="reviewChecks[j.id]" :disabled="!canResolveReview(j)">我已核对，放弃本次未完成的后续工作</label><button @click="abandon(j)" :disabled="!canResolveReview(j)||!reviewChecks[j.id]">记录核对并解除暂停</button></div>
     <p v-else-if="j.reviewResolved" class="review-state">已记录人工核对；这不表示已取消 AA 或撤回工具副作用。</p>
    </article>
    <section v-if="nativeResult" ref="nativeResultPanel" id="native-task-result" class="native-task-result" aria-label="原生 AA 报告"><p role="status">{{nativeResult.loading?'正在只读核对原生报告…':nativeResult.error||'原生报告已核对，仅本次查看，不作为聊天消息。'}}</p><small>{{nativeResult.taskId}}</small><pre v-if="nativeResult.content!==null">{{nativeResult.content}}</pre><button @click="closeNativeResult">关闭报告</button></section>
   </section>
   <footer><div v-if="currentTopic?.ownerType==='group'" class="group-invitation"><label for="group-invite">邀请成员发言</label><select id="group-invite" v-model="invitedAgent" :disabled="busy||newSubmissionBlocked||currentTopic.executable===false"><option value="">选择成员</option><option v-for="member in currentTopic.members||[]" :key="member.id" :value="member.id" :disabled="member.unavailable">{{member.name}}{{member.unavailable?' · 暂不可用':''}}</option></select><button @click="invite" :disabled="busy||newSubmissionBlocked||!invitedAgent||currentTopic.executable===false">邀请</button></div><div v-if="currentTopic?.attachmentsEnabled" class="upload-area"><label class="attachment-picker">添加图片或文件<input type="file" accept=".png,.jpg,.jpeg,.webp,.pdf,.txt,.md,.csv,.json" multiple @change="selectFiles" :disabled="busy||newSubmissionBlocked||currentTopic?.executable===false"></label><small>最多 8 个，每个 20 MB；断线后可重新选择同一文件续传。</small><div v-for="(item,i) in pendingFiles" :key="i" class="pending-file"><span>{{item.file.name}} · {{item.error||item.progress+'%'}}</span><button @click="pendingFiles.splice(i,1)" :disabled="busy">移除</button></div></div><small class="draft-scope">草稿按话题暂存于本页；刷新或关闭页面会清空。</small><form @submit.prevent="send"><label class="sr-only" for="message-text">消息</label><textarea id="message-text" v-model="text" placeholder="输入文字…" rows="2" maxlength="12000" :disabled="!currentTopic||currentTopic.executable===false"></textarea><button id="send" :disabled="!currentTopic||busy||newSubmissionBlocked||(!text.trim()&&!pendingFiles.length)||currentTopic?.executable===false">发送</button></form><div class="send-state"><span id="send-state" role="status">{{notice}}</span><button id="retry-last" @click="retry" :disabled="busy||!pendingSubmission||Boolean(recoveryBlocker)">核对 / 同会话重试</button></div></footer>
  </template>
 </div>
</template>
