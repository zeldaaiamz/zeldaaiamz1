(async function () {
 'use strict';
 const {client,config,session,message,reportPath}=window.VOC,$=id=>document.getElementById(id),frame=$('report-frame'),status=$('report-message'),api=window.VOCReportContext;
 let displayToken=0;
 let loading=false,task,versions=[],records=[],context=null,pending=new Set(),dirty=new Set();
 frame.onload=sendContext;
 window.addEventListener('beforeunload',event=>{if(dirty.size||pending.size){event.preventDefault();event.returnValue='';}});
 function discardDrafts(){return !dirty.size||window.confirm('有未保存的处理记录，仍要离开当前报告吗？');}
 function sendContext(){if(context)frame.contentWindow.postMessage({type:'voc:context',...context,records},'*');}
 window.addEventListener('message',async event=>{
  if(event.source!==frame.contentWindow)return;
  if(event.data?.type==='voc:dirty'&&context&&event.data.nonce===context.nonce&&event.data.versionId===context.versionId&&context.keys.includes(event.data.key)){dirty.add(event.data.key);return;}
  if(event.data?.type==='voc:ready'&&event.data.taskId===task?.id){sendContext();return;}
  const params=api.validateSave(event,frame.contentWindow,context);if(!params||pending.has(params.p_key))return;pending.add(params.p_key);const active=context,m=event.data;
  try{const {data,error}=await client.rpc('voc_save_decision',params);if(error)throw error;const record=Array.isArray(data)?data[0]:data;if(!record||record.task_id!==task.id||record.action_key!==params.p_key)throw Error('返回记录不一致，请刷新核对。');dirty.delete(params.p_key);records=records.filter(r=>r.action_key!==record.action_key).concat(record);if(context===active)frame.contentWindow.postMessage({type:'voc:result',nonce:active.nonce,taskId:active.taskId,versionId:active.versionId,key:m.key,requestId:m.requestId,record},'*');}
  catch(e){if(context===active)frame.contentWindow.postMessage({type:'voc:result',nonce:active.nonce,taskId:active.taskId,versionId:active.versionId,key:m.key,requestId:m.requestId,error:e.code==='40001'?'记录已在其他页面更新。请刷新报告后再修改。':'保存未确认：'+e.message+'。请刷新核对后再操作。'},'*');}
  finally{pending.delete(params.p_key);}
 });
 function fillVersions(){const select=$('report-version');select.replaceChildren();for(const v of versions){const option=document.createElement('option');option.value=v.id;option.textContent=(v.report_path===task.report_path?'当前版本 · ':'历史留底 · ')+new Date(v.generated_at).toLocaleString('zh-CN');select.append(option);}select.disabled=versions.length<2;}
 async function display(version){
  if(pending.size){message(status,'处理记录正在保存，请完成后再切换。');return;}const token=++displayToken;context=null;dirty.clear();frame.hidden=true;frame.removeAttribute('srcdoc');$('report-version').disabled=true;$('reload-report').disabled=true;message(status,'正在打开并核验报告留底…');$('report-version-note').textContent='';
  try{
  const path=version?.report_path||task.report_path;if(version&&!api.versionPath(version,task))throw Error('版本与任务不一致。');
  const {data,error}=await client.storage.from(config.reportBucket).download(path);if(error)throw error;const html=await data.text();
  if(version){const bytes=new TextEncoder().encode(html),digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(b=>b.toString(16).padStart(2,'0')).join('');if(digest!==version.sha256||bytes.length!==Number(version.bytes))throw Error('报告留底校验失败，请返回列表核对。');}
  const payload=html.match(/<script id="report-data" type="application\/json">([\s\S]*?)<\/script>/);let modern=false;if(payload){const p=JSON.parse(payload[1]);if(p.task.id!==task.id)throw Error('报告任务身份不一致。');modern=p.presentation?.version===3;}
  if(token!==displayToken)return;
  const isCurrent=path===task.report_path;context={nonce:crypto.randomUUID(),taskId:task.id,versionId:version?.id||null,keys:version?.action_keys||[],canSave:!!version&&modern&&isCurrent&&records!==null};
  $('report-version-note').textContent=isCurrent?'当前报告 · 处理记录仅当前账户可见，保存不会发起分析调用。':'历史留底 · 旧版内容仅供追溯，以当前版本为准。原文件只读。';
  // Historical HTML is preserved in storage. Remove only its old duplicate navigation in this view.
  frame.srcdoc=html.replace(/<header class="report-header">[\s\S]*?<\/header>/,'<span id="header-asins" hidden></span>');frame.hidden=false;message(status,records===null?'报告已打开，但处理记录未能读取；刷新后可再核对。':'');
  }catch(error){if(token===displayToken)throw error;}finally{if(token===displayToken){$('report-version').disabled=versions.length<2;$('reload-report').disabled=false;}}
 }
 async function load(){if(loading)return;loading=true;context=null;
  try{const id=new URLSearchParams(location.search).get('task');if(!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id||''))throw Error('任务号无效，请返回任务列表。');let currentId=id;const seen=new Set();
   while(true){if(!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(currentId)||seen.has(currentId)||seen.size>=10)throw Error('复用任务关系无效，请返回任务列表核对。');seen.add(currentId);const {data,error}=await client.from('voc_tasks').select('id,asins,status,report_path,failure_reason,waiting_reason,control_state,duplicate_of').eq('id',currentId).maybeSingle();if(error)throw error;if(!data)throw Error('找不到任务，或当前账户无权查看。');task=data;if(!task.duplicate_of)break;currentId=task.duplicate_of;}
   $('report-title').textContent=task.asins;if(task.status==='失败')throw Error(task.failure_reason||'任务失败');if(task.status!=='完成')throw Error('报告尚未生成。'+(task.waiting_reason||'当前阶段：'+task.status));if(!task.report_path)throw Error('该任务已结束但没有可打开的报告，历史记录未提供原因。');if(!reportPath(task))throw Error('报告文件路径不符合 VOC 规则。');
   const [history,choices]=await Promise.all([client.from('voc_report_versions').select('*').eq('task_id',task.id).order('generated_at',{ascending:false}),client.from('voc_action_decisions').select('*').eq('task_id',task.id)]);
   versions=history.error?[]:history.data||[];records=choices.error?null:choices.data||[];fillVersions();const requested=new URLSearchParams(location.search).get('version');const selected=versions.find(v=>v.id===requested)||versions.find(v=>v.report_path===task.report_path);if(selected)$('report-version').value=selected.id;await display(selected);
   if(history.error)message(status,'当前报告已打开；历史版本暂未读取，请刷新核对。');
  }catch(e){frame.hidden=true;message(status,'报告未能打开：'+e.message);}finally{loading=false;}
 }
 try{if(!await session())return;$('reload-report').onclick=()=>{if(pending.size)return message(status,'处理记录正在保存，请完成后再刷新。');if(discardDrafts())load();};$('report-version').onchange=async()=>{if(pending.size){if(context?.versionId)$('report-version').value=context.versionId;return message(status,'处理记录正在保存，请完成后再切换。');}if(!discardDrafts()){if(context?.versionId)$('report-version').value=context.versionId;return;}try{await display(versions.find(v=>v.id===$('report-version').value));}catch(e){message(status,'版本未能打开：'+e.message);}};await load();}catch(e){message(status,'加载失败：'+e.message);}
}());
