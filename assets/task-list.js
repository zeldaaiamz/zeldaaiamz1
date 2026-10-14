(function(){
'use strict';
const groups={attention:'待我处理',running:'处理中',done:'已完成',failed:'异常',paused:'已暂停'};
function group(t){
 if(t.status==='已完成')return 'done';
 if(t.status==='失败')return 'failed';
 if(t.control_state==='paused')return 'paused';
 if(t.control_state!=='pausing'&&['awaiting_selection','awaiting_review'].includes(t.comparison_phase))return 'attention';
 return 'running';
}
function node(tag,text,cls){const n=document.createElement(tag);n.textContent=text;if(cls)n.className=cls;return n;}
function enhance(row,t){
 row.dataset.group=group(t);row.dataset.asin=t.asin;row.dataset.created=t.created_at;
 const cells=[...row.cells];['提交时间','产品 / 分析类型','任务状态','实际处理','进度 / 说明','操作'].forEach((x,i)=>cells[i].dataset.label=x);
 const status=cells[2].querySelector('.status-chip');const phase=status.textContent;
 status.textContent=groups[group(t)];status.className='status-chip '+({done:'done',failed:'failed',running:'running',attention:'waiting',paused:'waiting'}[group(t)]);
 if(phase!==status.textContent)cells[2].append(node('small',phase,'task-stage'));
 const actions=cells[5];actions.classList.add('task-actions');
 [...actions.querySelectorAll('button')].forEach(b=>{if(b.textContent===phase)b.textContent=({awaiting_selection:'查看名单并继续',awaiting_review:'确认特征清单',needs_evidence:'查看补齐进度'}[t.comparison_phase]||'查看进度');});
 if(t.failure_reason){
 cells[4].replaceChildren(node('span','任务中断，查看详情了解原因','task-note'));
 const d=node('details','');d.className='task-details';d.append(node('summary','查看详情'),node('p',t.failure_reason));
 if(!actions.children.length)actions.textContent='';actions.prepend(d);
 }else cells[4].textContent=group(t)==='done'?'报告已生成':group(t)==='attention'?'需要你确认后继续':group(t)==='paused'?'已保存的数据保留':t.control_state==='pausing'?'当前请求结束并保存后暂停':'后台处理中，可稍后查看';
 return row;
}
function mount(){
 const body=document.querySelector('#tasks-body'),bar=document.querySelector('#task-filters');if(!bar)return()=>{};
 let selected='all';const search=document.querySelector('#task-search');
 function render(){
 const rows=[...body.rows].filter(r=>r.dataset.group);const query=search.value.trim().toUpperCase();
 bar.replaceChildren();Object.entries({all:'全部',...groups}).forEach(([key,label])=>{
 const count=rows.filter(r=>key==='all'||r.dataset.group===key).length;
 const b=node('button',`${label} ${count}`,'task-filter'+(selected===key?' active':''));b.type='button';b.setAttribute('aria-pressed',String(selected===key));b.onclick=()=>{selected=key;render();};bar.append(b);
 });
 const order={attention:0,failed:1,running:2,paused:3,done:4};rows.sort((a,b)=>order[a.dataset.group]-order[b.dataset.group]||b.dataset.created.localeCompare(a.dataset.created)).forEach(r=>body.append(r));
 let count=0;rows.forEach(r=>{r.hidden=!(selected==='all'||r.dataset.group===selected)||!r.dataset.asin.includes(query);if(!r.hidden)count++;});
 body.querySelector('.task-filter-empty')?.remove();if(rows.length&&!count){const r=body.insertRow();r.className='task-filter-empty';const c=r.insertCell();c.colSpan=6;c.className='empty-cell';c.textContent='没有匹配任务，请更换 ASIN 或筛选条件。';}
 document.querySelector('#task-count').textContent=`显示 ${count} / ${rows.length} 条 · 仅当前已加载的最近任务`;
 }
 search.addEventListener('input',render);document.querySelector('#task-clear').onclick=()=>{search.value='';selected='all';render();search.focus();};return render;
}
window.KeywordTaskList={group,enhance,mount};
})();
