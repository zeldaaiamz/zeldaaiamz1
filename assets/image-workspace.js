(function(root){
 'use strict';
 function mount({app,taskId,frame}){
  let source=null,version=null,revision=0,pending=null,saving=false,ready=false,lastError=null;
  const clone=v=>JSON.parse(JSON.stringify(v));
  const key=()=>`keyword-image-workspace:${taskId}:${source}:${version}`;
  const storage={read(){try{return JSON.parse(localStorage.getItem(key())||'null');}catch{return null;}},write(value){try{localStorage.setItem(key(),JSON.stringify(value));}catch{}},clear(){try{localStorage.removeItem(key());}catch{}}};
  const send=(type,data={})=>frame.contentWindow?.postMessage({type,sourceDigest:source,checklistVersion:version,...data},'*');
  async function flush(){
   if(saving||!pending||!ready)return;
   saving=true;lastError=null;const value=pending,context={source,version};pending=null;storage.write({workspace:value.workspace,baseRevision:revision});
   try{
    const result=await app.client.rpc('save_keyword_image_workspace',{p_task_id:taskId,p_revision:revision,p_source_digest:source,p_checklist_version:version,p_workspace:value.workspace});
    if(result.error)throw result.error;
    const record=Array.isArray(result.data)?result.data[0]:result.data;
    if(!record||!Number.isInteger(record.revision))throw Error('保存回执不完整，请保留草稿后刷新');
    if(source!==context.source||version!==context.version)return;
    revision=record.revision;
    if(!pending){storage.clear();send('keyword-image-workspace-saved',{local:app.localPreview===true,editSequence:value.editSequence});}
    else storage.write({workspace:pending.workspace,baseRevision:revision});
   }catch(error){if(source!==context.source||version!==context.version)return;lastError=error.message||String(error);pending=pending||value;storage.write({workspace:pending.workspace,baseRevision:revision});send('keyword-image-workspace-save-error',{error:lastError});}
   finally{saving=false;}
   if(pending&&!lastError)await flush();
  }
  async function load(defaults){
   ready=false;pending=null;revision=0;const draft=storage.read();
   try{
    const result=await app.client.from('keyword_image_workspaces').select('revision,source_digest,checklist_version,workspace').eq('task_id',taskId).maybeSingle();if(result.error)throw result.error;
    const row=result.data;if(row&&(row.source_digest!==source||row.checklist_version!==version))throw Error('已保存草稿属于旧图片版本，请先核对来源');
    revision=row?.revision||0;ready=true;const conflict=draft&&draft.baseRevision!==revision;
    let module=null;try{module=localStorage.getItem(`keyword-report-module:${taskId}`);}catch{}
    send('keyword-image-workspace-load',{workspace:draft?.workspace||row?.workspace||null,draft:Boolean(draft),module,error:conflict?'在线版本已变化，本地草稿保留；核对后点击重新保存。':null});
   }catch(error){send('keyword-image-workspace-load',{workspace:draft?.workspace||defaults,draft:Boolean(draft),error:error.message||String(error)});}
  }
  const listener=async event=>{
   if(event.source!==frame.contentWindow||!event.data)return;
   const msg=event.data;if(!msg.type?.startsWith('keyword-image-workspace-'))return;
   if(msg.type==='keyword-image-workspace-ready'){
    if(typeof msg.sourceDigest!=='string'||typeof msg.checklistVersion!=='string'||!msg.sourceDigest||!msg.checklistVersion)return;
    source=msg.sourceDigest;version=msg.checklistVersion;await load(msg.defaults);return;
   }
   if(msg.sourceDigest!==source||msg.checklistVersion!==version)return;
   if(msg.type==='keyword-image-workspace-module'&&/^[0-9]{2}$/.test(msg.module)){try{localStorage.setItem(`keyword-report-module:${taskId}`,msg.module);}catch{}return;}
   if(msg.type==='keyword-image-workspace-save'){
    if(!ready)await load(msg.workspace);
    pending={workspace:clone(msg.workspace),editSequence:msg.editSequence};storage.write({workspace:pending.workspace,baseRevision:revision});
    if(!ready){send('keyword-image-workspace-save-error',{error:'保存服务未连接，草稿已保留在本机。'});return;}
    await flush();
   }
  };
  window.addEventListener('message',listener);
  return {dispose(){window.removeEventListener('message',listener);},getState:()=>({revision,saving,lastError})};
 }
 root.KeywordImageWorkspace={mount};
}(window));
