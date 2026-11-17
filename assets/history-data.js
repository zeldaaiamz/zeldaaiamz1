(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.KeywordHistoryData=api;}(typeof window==='object'?window:this,function(){
'use strict';
const typeOf=t=>t.comparison_phase?'comparison':'keyword';
const newer=(a,b)=>String(b.created_at).localeCompare(String(a.created_at))||String(b.id).localeCompare(String(a.id));
const safeImage=url=>typeof url==='string'&&/^https:\/\/(m\.media-amazon\.com|images-na\.ssl-images-amazon\.com)\/images\/[A-Za-z0-9_./+%-]+$/.test(url);
const reportCandidates=tasks=>tasks.filter(t=>t.status==='已完成'&&t.report_url);
function reportNewer(a,b,generationFor){
  const left=generationFor(a),right=generationFor(b);
  // A recorded day orders reports across days. Within the same day prefer a
  // verified instant; missing dates and exact ties fall back to stable task order.
  return (right?.generated||'').localeCompare(left?.generated||'')
    || (right?.generatedAt||'').localeCompare(left?.generatedAt||'')
    || newer(a,b);
}
function latestReports(candidates,generationFor){
  const groups=new Map();
  for(const task of [...candidates].sort((a,b)=>reportNewer(a,b,generationFor))){
    if(!groups.has(task.asin))groups.set(task.asin,{asin:task.asin,keyword:null,comparison:null});
    const group=groups.get(task.asin),type=typeOf(task);
    if(!group[type])group[type]=task;
  }
  return [...groups.values()];
}
function productFor(asin,tasks,thumbnails=[]){for(const t of [...tasks].sort(newer)){if(t.asin!==asin)continue;for(const p of Array.isArray(t.comparison_state?.products)?t.comparison_state.products:[]){if(p.asin!==asin)continue;const photo=(Array.isArray(p.photos)?p.photos:[]).find(p=>p.asin===asin&&safeImage(p.url));if(photo)return{image_url:photo.url,title:typeof p.title==='string'?p.title:'',source_task_id:t.id};}}const cached=thumbnails.find(p=>p.asin===asin&&safeImage(p.image_url));return cached||null;}
function recentTasks(tasks){return [...tasks].sort(newer).slice(0,15);}
function otherPending(tasks){const recent=new Set(recentTasks(tasks).map(t=>t.id));return [...tasks].sort(newer).filter(t=>!recent.has(t.id)&&(!['已完成','失败'].includes(t.status)||['paused','pausing'].includes(t.control_state)));}
return {typeOf,newer,safeImage,reportCandidates,reportNewer,latestReports,productFor,recentTasks,otherPending};
}));
