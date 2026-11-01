// Read in the paired page. An Android standalone app may hand a new-window
// navigation to another browser context without its HttpOnly session cookie.
export async function readAttachment(url,{signal,fetchImpl=fetch}={}){
 const response=await fetchImpl(url,{credentials:'same-origin',cache:'no-store',redirect:'error',signal});
 if(!response.ok)throw Object.assign(Error(response.status===401?'附件会话未获认证，请返回会话重新连接':response.status===403?'当前会话无权读取此附件':'附件暂时无法读取，请检查连接'),{status:response.status});
 return response.blob();
}
export function saveAttachment(blob,name){
 const url=URL.createObjectURL(blob),link=document.createElement('a');
 link.href=url;link.download=name||'attachment';document.body.append(link);
 try{link.click();}finally{link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
}
