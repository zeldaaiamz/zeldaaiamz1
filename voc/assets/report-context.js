(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.VOCReportContext=api;}(typeof window==='object'?window:this,function(){
 'use strict';
 function validateSave(event,source,context){const m=event?.data;if(!context?.canSave||event.source!==source||m?.type!=='voc:save'||m.nonce!==context.nonce||m.taskId!==context.taskId||m.versionId!==context.versionId||!context.keys.includes(m.key)||!['待核对','已采纳','暂不采纳'].includes(m.decision)||typeof m.note!=='string'||m.note.length>1000||!Number.isSafeInteger(m.revision)||m.revision<0||typeof m.requestId!=='string'||m.requestId.length>80)return null;return {p_task:m.taskId,p_version:m.versionId,p_key:m.key,p_decision:m.decision,p_note:m.note,p_revision:m.revision};}
 function versionPath(version,task){return !!version&&version.task_id===task.id&&new RegExp('^voc/'+task.id+'-[A-Za-z0-9_-]{8,64}\\.html$').test(version.report_path)&&/^[a-f0-9]{64}$/.test(version.sha256)&&Number(version.bytes)>0;}
 return {validateSave,versionPath};
}));
