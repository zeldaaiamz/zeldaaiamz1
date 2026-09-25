(function(){
'use strict';
const app=window.KeywordBattle;if(!app)return;
const {client,requireSession,route,showMessage,humanError}=app;
const $=id=>document.getElementById(id);
const node=(tag,text,cls)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(cls)el.className=cls;return el;};
const phaseLabel={prepare:'正在读取留底',awaiting_selection:'待选择竞对并批准额度',collect:'正在补充产品资料',awaiting_review:'待确认特征清洗',needs_evidence:'资料缺失，已停止后续取数',judge:'正在核对原文与生成报告',complete:'已完成'};
let sources=[],jobs=[],activeId=null,signature='',busy=false,creationId=null;
function error(e){showMessage($('message'),humanError(e));}
async function rpc(name,args){const {data,error:err}=await client.rpc(name,args);if(err)throw err;return data;}
async function action(button,run){if(busy)return;busy=true;button.disabled=true;$('message').hidden=true;try{await run();signature='';await refresh();}catch(e){error(e);}finally{busy=false;button.disabled=false;}}
async function refresh(){
 const {data,error:err}=await client.from('keyword_tasks').select('id,asin,status,created_at,failure_reason,report_url,comparison_phase,comparison_state,comparison_selection,comparison_review').not('comparison_phase','is',null).order('created_at',{ascending:false}).limit(30);
 if(err)throw err;jobs=data||[];$('comparison-jobs').replaceChildren();
 if(!jobs.length)$('comparison-jobs').append(node('p','还没有竞对任务。','quiet'));
 jobs.forEach(task=>{const b=node('button',undefined,'job'+(task.id===activeId?' active':''));b.type='button';b.append(node('b',task.asin),node('span',task.status==='失败'?'失败':phaseLabel[task.comparison_phase]||task.status),node('small',new Date(task.created_at).toLocaleString('zh-CN')));b.addEventListener('click',()=>{activeId=task.id;signature='';render(task);});$('comparison-jobs').append(b);});
 const selected=jobs.find(t=>t.id===activeId)||jobs[0];if(selected){activeId=selected.id;render(selected);}
}
function render(task){
 const next=JSON.stringify(task);if(next===signature)return;signature=next;
 $('task-detail').hidden=false;$('detail-title').textContent=task.asin+' · 竞对对比';$('detail-phase').textContent=phaseLabel[task.comparison_phase]||task.status;$('detail-id').textContent=task.id;
 const box=$('detail-content');box.replaceChildren();
 if(task.status==='失败'){box.append(node('p',task.failure_reason||'任务失败；未自动重复取数。'));return;}
 if(task.status==='已完成'&&task.report_url){const a=node('a','打开正式报告','primary-button');a.href=route('report/?task='+encodeURIComponent(task.id));box.append(a);return;}
 if(task.comparison_phase==='awaiting_selection')return selection(task,box);
 if(task.comparison_phase==='awaiting_review')return review(task,box);
 if(task.comparison_phase==='needs_evidence'){box.append(node('p',task.comparison_state?.notice));return;}
 box.append(node('p','工人正在处理，页面会自动刷新。取数完成后会停在下一项人工确认处。','quiet'));
}
function selection(task,box){
 const state=task.comparison_state||{};const pricing=state.pricing||{};
 box.append(node('p',`核心词：${state.coreKeyword} ｜ 站点：${state.site} ｜ 来源 ${state.totalTerms} 个关键词。${state.notice||''}`,'quiet'));
 const grid=node('div',undefined,'selection-grid'),rows=node('div'),checks=[];
 const inputs=()=>[...rows.querySelectorAll('input')];
 const add=node('button','＋ 添加竞对','secondary-button');add.type='button';
 const quote=node('div',undefined,'quote-box');
 const approval=node('label',undefined,'approval');const ack=document.createElement('input');ack.type='checkbox';approval.append(ack,node('span','我已核对名单与下方额度，确认只补取这些产品详情及 1 次品类特征；此步不调用豆包。'));
 const submit=node('button','确认名单与额度，开始取数','primary-button');submit.type='button';
 function values(){return inputs().map(i=>i.value.trim().toUpperCase());}
 function update(){const asins=values();ack.checked=false;const n=asins.filter(Boolean).length;add.disabled=inputs().length>=5;const valid=n>=3&&n<=5&&asins.every(a=>/^[A-Z0-9]{10}$/.test(a))&&new Set([task.asin,...asins]).size===n+1;
  checks.forEach(c=>{c.checked=asins.includes(c.value);c.disabled=!c.checked&&inputs().length>=5&&!inputs().some(i=>!i.value.trim());});
  quote.textContent=pricing.verified?`产品详情 ${n+1} 次请求 × ${pricing.productDetail} 额度 + 品类特征 1 次请求 × ${pricing.categoryFeature} 额度 = ${(n+1)*pricing.productDetail+pricing.categoryFeature} 次额度。调用范围：我方 + ${n} 家竞对。历史核对余额 ${pricing.remainingObserved??'未知'}（${pricing.remainingObservedDate||'未核对'}，非实时余额）。不购买资源包，西柚新增调用为 0。`:'费用口径尚未核实，暂不能取数。';
  submit.disabled=!valid||!pricing.verified;}
 function addRow(value=''){if(inputs().length>=5)return;const row=node('div',undefined,'asin-row');const input=document.createElement('input');input.value=value;input.maxLength=10;input.setAttribute('aria-label','竞对 ASIN');input.placeholder='10 位 ASIN';const remove=node('button','移除','secondary-button');remove.type='button';remove.addEventListener('click',()=>{row.remove();update();});input.addEventListener('input',()=>{input.value=input.value.toUpperCase();update();});row.append(node('span','竞对'),input,remove);rows.append(row);update();return input;}
 for(const c of state.candidates||[]){const label=node('label',undefined,'candidate');const check=document.createElement('input');check.type='checkbox';check.value=c.asin;checks.push(check);const details=node('div');if(typeof c.imageUrl==='string'&&/^https:\/\//.test(c.imageUrl)){const img=document.createElement('img');img.src=c.imageUrl;img.alt=c.asin+' 主图';img.loading='lazy';img.referrerPolicy='no-referrer';img.addEventListener('error',()=>{img.replaceWith(node('small','图片未返回'));});details.append(img);}else details.append(node('small','主图未返回'));
 details.append(node('b',c.asin),node('small',`出现 ${c.count} 次`),node('small',c.keywords.join(' · ')));label.append(check,details);grid.append(label);
 check.addEventListener('change',()=>{if(check.checked){const empty=inputs().find(i=>!i.value.trim());if(empty)empty.value=c.asin;else addRow(c.asin);}else inputs().filter(i=>i.value===c.asin).forEach(i=>i.parentElement.remove());update();});}
 add.addEventListener('click',()=>addRow()?.focus());
 submit.addEventListener('click',()=>{if(!ack.checked){error(Error('请先勾选额度确认。'));return;}const asins=values();action(submit,()=>rpc('confirm_keyword_competitors',{p_task_id:task.id,p_asins:asins,p_max_calls:asins.length+2,p_max_cost:(asins.length+1)*pricing.productDetail+pricing.categoryFeature,p_unit:pricing.unit}));});
 box.append(grid,node('h3','对比产品'),node('p','自己：'+task.asin),rows,add,quote,approval,submit);update();
}
function review(task,box){
 const state=task.comparison_state;box.append(node('p',`核心词：${state.coreKeyword} ｜ 完整特征 ${state.features.length} 条。保留名称、顺序和占比；逐项确认后才生成结论。`,'quiet'));
 const evidence=node('details',undefined,'evidence');evidence.append(node('summary','查看我方原始标题、产品描述与属性'));
 const own=state.products[0];evidence.append(node('pre',JSON.stringify({title:own.title,description:own.description,attributes:own.attributes},null,2)));box.append(evidence);
 const wrap=node('div',undefined,'review-table-wrap'),table=node('table',undefined,'review-table'),head=node('thead'),hr=node('tr');['品类特征 / 占比','原始说明','判定','一句理由'].forEach(t=>hr.append(node('th',t)));head.append(hr);table.append(head);const body=node('tbody');const controls=[];
 state.features.forEach(f=>{const tr=node('tr'),title=node('td');title.append(node('b',f.product_feature),node('p',`销量 ${f.monthly_sales_share}% · 产品 ${f.product_count_share}%`,'quiet'));const select=document.createElement('select');[['','请选择'],['保留','保留'],['删除','删除'],['缺口','缺口']].forEach(([value,text])=>{const o=node('option',text);o.value=value;select.append(o);});select.setAttribute('aria-label',f.product_feature+' 判定');const reason=document.createElement('input');reason.maxLength=500;reason.placeholder='为什么保留、删除或标记缺口';reason.setAttribute('aria-label',f.product_feature+' 理由');controls.push({feature:f,select,reason});const td=node('td');td.append(select);const reasonCell=node('td');reasonCell.append(reason);tr.append(title,node('td',f.feature_description),td,reasonCell);body.append(tr);});table.append(body);wrap.append(table);box.append(wrap);
 const summary=node('div','请完成逐项判定，预览删除及缺口清单。','review-summary');
 const preview=node('button','预览清洗结果','secondary-button');preview.type='button';
 const ackWrap=node('label',undefined,'approval'),ack=document.createElement('input');ack.type='checkbox';ackWrap.append(ack,node('span',`我确认上述清洗结果，并批准豆包最多 ${state.aiQuote.maxCalls} 次判断、每次输出最多 ${state.aiQuote.maxOutputTokens} tokens；按官方标准价估算上限 ¥${state.aiQuote.maxCny}，实际账单受账户优惠/免费额度影响。`));ackWrap.hidden=true;
 const submit=node('button','确认清洗与判断费用，生成报告','primary-button');submit.type='button';submit.hidden=true;let confirmed=null;
 const decisions=()=>controls.map(c=>({product_feature:c.feature.product_feature,decision:c.select.value,reason:c.reason.value.trim()}));
 controls.forEach(c=>[c.select,c.reason].forEach(el=>el.addEventListener('input',()=>{confirmed=null;ack.checked=false;ackWrap.hidden=true;submit.hidden=true;})));
 preview.addEventListener('click',()=>{const ds=decisions();if(ds.some(d=>!d.decision||!d.reason)){error(Error('每项均须填写判定和理由。'));return;}if(ds.every(d=>d.decision==='删除')){error(Error('至少保留一项特征。'));return;}confirmed=ds;summary.textContent=['删除清单',...ds.filter(d=>d.decision==='删除').map(d=>`${d.product_feature}：${d.reason}`),'缺口清单',...ds.filter(d=>d.decision==='缺口').map(d=>`${d.product_feature}：${d.reason}`),`保留 ${ds.filter(d=>d.decision==='保留').length} 条；删除 ${ds.filter(d=>d.decision==='删除').length} 条；缺口 ${ds.filter(d=>d.decision==='缺口').length} 条。`].join('\n');ackWrap.hidden=false;submit.hidden=false;});
 submit.addEventListener('click',()=>{if(!confirmed||!ack.checked){error(Error('请先预览并确认清洗结果及费用。'));return;}action(submit,()=>rpc('confirm_keyword_features',{p_task_id:task.id,p_source_digest:state.sourceDigest,p_decisions:confirmed,p_ai_max_cny:state.aiQuote.maxCny}));});
 box.append(preview,summary,ackWrap,submit);
}
async function start(){const session=await requireSession();if(!session)return;document.body.style.visibility='visible';const result=await client.from('keyword_tasks').select('id,asin,created_at').eq('status','已完成').is('comparison_phase',null).order('created_at',{ascending:false}).limit(50);if(result.error)throw result.error;sources=result.data||[];$('source-task').replaceChildren(node('option','请选择已有任务'));$('source-task').firstChild.value='';sources.forEach(t=>{const o=node('option',`${t.asin} · ${new Date(t.created_at).toLocaleString('zh-CN')} · ${t.id.slice(0,8)}`);o.value=t.id;$('source-task').append(o);});$('source-task').addEventListener('change',()=>{$('own-asin').value=sources.find(s=>s.id===$('source-task').value)?.asin||'';creationId=null;});$('core-keyword').addEventListener('input',()=>{creationId=null;});$('create-comparison').addEventListener('submit',event=>{event.preventDefault();if(!$('source-task').value){error(Error('请选择来源任务。'));return;}creationId||=crypto.randomUUID();action($('create-button'),async()=>{activeId=await rpc('create_keyword_comparison',{p_task_id:creationId,p_source_id:$('source-task').value,p_core_keyword:$('core-keyword').value.trim(),p_site:$('site').value});creationId=null;});});$('refresh').addEventListener('click',()=>refresh().catch(error));await refresh();window.setInterval(()=>{if(!busy)refresh().catch(error);},10000);}
start().catch(e=>{document.body.style.visibility='visible';error(e);});
}());
