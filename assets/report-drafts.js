(function(root){
'use strict';
function mount({frame,taskId,userId,storage}){
  if(!frame||!taskId||!userId)throw Error('草稿保存缺少任务或账户');
  const receive=async event=>{
    const d=event.data;
    if(event.source!==frame.contentWindow||d?.type!=='zelda-report-draft'||!['03','06'].includes(d.module)||!['get','set','copy','download'].includes(d.action)||typeof d.requestId!=='string'||d.requestId.length>100)return;
    const reply={type:'zelda-report-draft-result',requestId:d.requestId,module:d.module,ok:false};
    try{
      if(['copy','download'].includes(d.action)){
        if(typeof d.text!=='string'||!d.text.trim()||d.text.length>1000000)throw Error('内容无效');
        if(d.action==='copy'){await navigator.clipboard.writeText(d.text);}
        else {if(!['text/plain;charset=utf-8','text/csv;charset=utf-8'].includes(d.mime)||!/^03-|^广告诊断/.test(d.filename||''))throw Error('下载参数无效');const url=URL.createObjectURL(new Blob([d.text],{type:d.mime})),a=document.createElement('a');a.href=url;a.download=d.filename.replace(/[\\/]/g,'_');document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
        reply.ok=true;frame.contentWindow.postMessage(reply,'*');return;
      }
      const target=storage||window.localStorage;
      const key='zelda-report-ops:v1:'+userId+':'+taskId+':'+d.module;
      if(d.action==='get'){const raw=target.getItem(key);reply.record=raw?JSON.parse(raw):null;}
      else {if(!d.record||typeof d.record.signature!=='string'||typeof d.record.value!=='object')throw Error('草稿格式错误');const raw=JSON.stringify(d.record);if(raw.length>1000000)throw Error('草稿过大');target.setItem(key,raw);}
      reply.ok=true;
    }catch(_){reply.error=['get','set'].includes(d.action)?'本机草稿读写失败':'复制或下载不可用';}
    frame.contentWindow.postMessage(reply,'*');
  };
  window.addEventListener('message',receive);
  return ()=>window.removeEventListener('message',receive);
}
root.KeywordReportDrafts=Object.freeze({mount});
if(typeof module!=='undefined')module.exports={mount};
})(typeof window!=='undefined'?window:globalThis);
