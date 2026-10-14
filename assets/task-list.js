(function(){
'use strict';
const groups={attention:'待我处理',running:'处理中',done:'已完成',failed:'异常',paused:'已暂停',blocked:'资料受阻',partial:'部分完成'};
function group(t){
 if(t.status==='已完成')return t.comparison_phase&&t.image_session?.image_status!=='complete'?'partial':'done';
 if(t.status==='失败')return 'failed';
 if(t.control_state==='paused')return 'paused';
 if(t.control_state!=='pausing'&&t.comparison_phase==='needs_evidence'&&(t.comparison_state?.autoEvidenceAttempted||t.comparison_state?.evidenceBlock!=='product'))return 'blocked';
 if(t.control_state!=='pausing'&&['awaiting_selection','awaiting_review'].includes(t.comparison_phase))return 'attention';
 return 'running';
}
function node(tag,text,cls){const n=document.createElement(tag);n.textContent=text;if(cls)n.className=cls;return n;}
function enhance(row,t){
 row.dataset.task=t.id;row.dataset.group=group(t);row.dataset.asin=t.asin;row.dataset.created=t.created_at;
 const cells=[...row.cells];const product=t.display_product;const identity=node('div','','task-product');if(product?.image_url){const image=document.createElement('img');image.src=product.image_url;image.alt=t.asin+' 商品图片';image.loading='lazy';image.referrerPolicy='no-referrer';image.onerror=()=>image.replaceWith(node('span','暂无图片','task-photo-empty'));identity.append(image);}else identity.append(node('span','暂无图片','task-photo-empty'));const words=node('div','');words.append(...cells[1].childNodes);if(product?.title){const title=node('small',product.title,'task-product-title');title.title=product.title;words.append(title);}words.append(node('small','任务 '+t.id.slice(0,8),'task-short-id'));identity.append(words);cells[1].append(identity);['提交时间','产品 / 分析类型','任务状态','实际处理','进度 / 说明','操作'].forEach((x,i)=>cells[i].dataset.label=x);
 const status=cells[2].querySelector('.status-chip');const phase=status.textContent;
 status.textContent=groups[group(t)];status.className='status-chip '+({done:'done',failed:'failed',running:'running',attention:'waiting',paused:'waiting',blocked:'failed',partial:'waiting'}[group(t)]);
 if(phase!==status.textContent)cells[2].append(node('small',phase,'task-stage'));
 const actions=cells[5];actions.classList.add('task-actions');if(group(t)==='partial'&&t.report_url){const next=node('a',t.image_session?.status==='error'?'查看05异常与图片资料':'处理05图片资料','table-action');next.href=window.KeywordNavigation.reportURL(window.KeywordBattle,t,'05');actions.append(next);}
 [...actions.querySelectorAll('button')].forEach(b=>{if(b.textContent===phase)b.textContent=({awaiting_selection:'查看名单并继续',awaiting_review:'确认特征清单',needs_evidence:'查看原因与资料'}[t.comparison_phase]||'查看进度');});
 const g=group(t),reason=t.failure_reason||t.comparison_state?.health?.reason||t.comparison_state?.notice||t.image_session?.error;
 const notes={partial:t.image_session?.status==='error'?'04 可查看；05 异常，查看图片资料处理':'04 可查看；05 待完成，处理图片资料',blocked:'资料不完整，查看原因并补齐或登记核查',failed:'任务中断，处理异常或移入回收站',done:'报告已生成',attention:'待你确认，打开确认资料后继续',paused:'数据已保存；需要继续时重新启动',running:t.control_state==='pausing'?'当前请求保存完成后暂停':'后台处理中，可稍后查看'};
 cells[4].replaceChildren(node('span',notes[g],'task-note'));if(reason){const details=node('details','');details.className='task-details';details.append(node('summary','查看完整原因'),node('p',reason));cells[4].append(details);}window.KeywordTaskCosts?.append(cells[4],t);
 return row;
}
function mount(){
 const body=document.querySelector('#tasks-body'),bar=document.querySelector('#task-filters');if(!bar)return()=>{};let selected='all',tasks=[],builder;const search=document.querySelector('#task-search');
 function render(data,build){if(data){tasks=data;builder=build;}if(!builder)return;const query=search.value.trim().toUpperCase(),matched=[...tasks].sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at))||String(b.id).localeCompare(String(a.id))).filter(t=>(selected==='all'||group(t)===selected)&&t.asin.includes(query)),visible=matched.slice(0,15);
 bar.replaceChildren();Object.entries({all:'全部',...groups}).forEach(([key,label])=>{const count=tasks.filter(t=>key==='all'||group(t)===key).length,b=node('button',`${label} ${count}`,'task-filter'+(selected===key?' active':''));b.type='button';b.setAttribute('aria-pressed',String(selected===key));b.onclick=()=>{selected=key;render();};bar.append(b);});body.replaceChildren(...visible.map(builder));if(!visible.length){const row=body.insertRow(),c=row.insertCell();c.colSpan=6;c.className='empty-cell';c.textContent=tasks.length?'没有匹配任务，请更换 ASIN 或筛选条件。':'暂无未删除任务，可查看回收站或历史报告。';}
 document.querySelector('#task-count').textContent=`显示 ${visible.length} / ${matched.length} 条匹配任务 · 每页最多15条 · 标签统计全部未删除任务`;window.KeywordTaskManager?.current?.visible(visible);
 }
 window.addEventListener('keyword-products-ready',()=>render());search.addEventListener('input',()=>render());document.querySelector('#task-clear').onclick=()=>{search.value='';selected='all';render();search.focus();};return render;
}
window.KeywordTaskList={group,enhance,mount};
})();
