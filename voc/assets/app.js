(async function () {
  'use strict';
  const { client, session, el, message, reportPath } = window.VOC;
  const taskView = window.VOCTaskView;
  const $ = id => document.getElementById(id);
  let budgetSummary=null;
  const money=n=>'¥'+(Number(n||0)/1000000).toFixed(3);
  let productCatalog = {}, tasks = [], lastTaskRender = "", loadedLimit = 50, hasMore = false;
  let relatedTasks = new Map();
  const expandedReuse = new Set();
  const mainTask = task => taskView.mainTask(task, id => tasks.find(t => t.id === id) || relatedTasks.get(id));
  function reportLink(task) {
    const main = mainTask(task);
    if (!main || main.status !== '完成' || !reportPath(main)) return null;
    const link = el('a', task.duplicate_of ? '打开主报告 →' : '打开报告 →', 'report-link');
    link.href = `report/?task=${encodeURIComponent(main.id)}`;
    return link;
  }
  let asins = [], selected = new Set(), currentSession, busy = false, loading = false, pendingSubmission = null;
  function addInput() {
    const values = $('asin-input').value.toUpperCase().trim().split(/[\s,+]+/).filter(Boolean);
    if (!values.length) return true;
    if (values.some(value => !/^[A-Z0-9]{10}$/.test(value))) { message($('page-message'), 'ASIN 必须为 10 位字母或数字，请检查输入。'); return false; }
    const next = [...new Set([...asins, ...values])];
    if (next.length > 10) { message($('page-message'), '每次最多添加 10 个 ASIN。'); return false; }
    asins = next; $('asin-input').value = ''; message($('page-message'), ''); renderTags(); return true;
  }
  function renderTags() {
    $('asin-tags').replaceChildren(...asins.map(asin => { const chip = el('span', undefined, 'asin-chip'); chip.append(el('span', asin)); const remove = el('button', '×'); remove.type = 'button'; remove.setAttribute('aria-label', `删除 ${asin}`); remove.onclick = () => { asins = asins.filter(a => a !== asin); renderTags(); }; chip.append(remove); return chip; }));
    $('asin-count').textContent = `${asins.length}/10`;
  }
  function updateSelection() { $('selection-count').textContent = `${selected.size}/${asins.length} 已选择`; $('select-all').checked = selected.size === asins.length; $('select-all').indeterminate = selected.size > 0 && selected.size < asins.length; updateSummary(); }
  function renderProducts() {
    $('products').replaceChildren(...asins.map(asin => {
      const card = el('label', undefined, 'product-card'); const check = el('input'); check.type = 'checkbox'; check.value = asin; check.checked = selected.has(asin); check.onchange = () => { check.checked ? selected.add(asin) : selected.delete(asin); updateSelection(); };
      card.append(check, taskThumbnail(asin), el('strong', asin), el('small', productCatalog[asin]?.title || '美国站 · 商品名称尚未核实'));  return card;
    })); updateSelection();
  }
  function openDialog() {
    if (!addInput()) return;
    if (!asins.length) { message($('page-message'), '请先添加至少一个 ASIN。'); $('asin-input').focus(); return; }
    $('submit-form').reset(); selected = new Set(asins); pendingSubmission = null;
    $('product-count').textContent = asins.length; message($('submit-error'), ''); renderProducts(); $('configure-dialog').showModal();
  }
  function closeDialog() { if (!busy) $('configure-dialog').close(); }
  const steps = ['排队中', '抓评论', '标注中', '生成报告', '完成'];
  async function loadProductCatalog() {
    try {
      const response = await fetch(new URL('assets/product-catalog.json', window.VOC.vocRoot));
      if (!response.ok) return;
      const data = await response.json();
      if (data && typeof data === 'object' && !Array.isArray(data)) productCatalog = data;
    } catch { /* Missing catalog never blocks task status or reports. */ }
  }
  function taskThumbnail(asins) {
    const values = [...new Set(asins.split('+'))];
    const box = el('div', undefined, 'task-thumbnail');
    if (values.length > 1) box.classList.add('multi');
    for (const asin of values) {
      const item = productCatalog[asin];
      const slot = el('div', undefined, 'thumbnail-slot');
      const valid = item && new RegExp('^products/' + asin + '\\.(jpg|webp)$').test(item.image);
      if (valid) {
        const image = el('img'); image.src = new URL('assets/' + item.image, window.VOC.vocRoot).href;
        image.alt = asin + ' 商品主图'; image.title = item.title || asin;
        image.loading = 'lazy'; image.decoding = 'async';
        image.onerror = () => { image.hidden = true; if (!slot.querySelector('span')) slot.append(el('span', '图片暂缺', 'thumbnail-empty')); };
        slot.append(image);
      } else slot.append(el('span', '暂无图片', 'thumbnail-empty'));
      box.append(slot);
    }
    return box;
  }
  function normalized(value) { return value.split('+').sort().join('+'); }
  function duplicateTask(count, scope) {
    const value = [...selected].sort().join('+');
    return tasks.find(t => !t.duplicate_of && normalized(t.asins) === value && t.reviews_per_asin === count && t.review_scope === scope);
  }
  function updateSummary() {
    const form = new FormData($('submit-form')), count = Number(form.get('review-count')), scope = form.get('review-scope');
    $('submission-summary').textContent = `${selected.size} 个 ASIN · ${scope === 'asin_only' ? '仅本 ASIN' : '含变体评论'} · ${count ? '总目标 '+selected.size*count+' 条' : '请选择采集目标'} · 每任务最多 ¥5 · 每日最多 ¥50；额度内自动处理`;
    const duplicate = duplicateTask(count,scope); $('duplicate-warning').replaceChildren();
    if (duplicate) { const link = el('button','查看已有任务'); link.type='button'; link.onclick=()=>showDetail(duplicate); $('duplicate-warning').append(el('p','已有相同配置任务；复用主任务及结果，不重复执行或扣费。'),link); const report=reportLink(duplicate);if(report)$('duplicate-warning').append(report); }
  }
  function statusOf(task) {
    if(task.duplicate_of)return '复用已有任务';
    if(task.status==='完成') return reportPath(task) ? '报告已生成' : '结束但无报告';
    if(task.status==='失败') return /评论库未收录/.test(task.failure_reason||'')?'未取得评论':'处理失败';
    if(task.control_state==='paused') return '已请求暂停';
    if(task.waiting_reason) return '等待处理';
    if(task.status==='排队中') return '尚未开始';
    return task.execution_phase || task.status;
  }
  function waitingText(task) {
    return taskView.waitingText(task, budgetSummary, reportPath(task));
  }
  function date(value) { return value ? new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(value)) : '未返回'; }
  async function manage(task,action,name) {
    try { const {error}=await client.rpc('voc_manage_task',{p_id:task.id,p_action:action,p_name:name??null}); if(error)throw error; $('task-dialog').close(); message($('page-message'),({pause:'已请求暂停；正在进行的调用完成后停止后续调用。',resume:'已请求继续；复用留底，仍受原费用授权限制。',archive:'已归档，可从已归档列表恢复；归档不会暂停执行。',restore:'已恢复到任务列表。',rename:'任务名称已保存。',recover:'已请求按原授权核对留底并恢复；结果未知的调用不会自动重扣。'})[action]||'操作已保存。'); await loadTasks(); }
    catch(e){message($('page-message'),'操作未确认：'+e.message+'。请刷新核对状态后再操作。');}
  }
  function actions(task) {
    const box=el('div',undefined,'task-actions');
    const add=(text,fn)=>{const b=el('button',text);b.type='button';b.onclick=fn;box.append(b)};
    add('任务详情',()=>showDetail(task));
    if(task.duplicate_of){const main=mainTask(task);if(main)add('查看主任务',()=>showDetail(main));}
    if(!task.duplicate_of&&!['完成','失败'].includes(task.status)) add(task.control_state==='paused'?'继续任务':'暂停任务',()=>manage(task,task.control_state==='paused'?'resume':'pause'));
    if(!task.duplicate_of&&task.status==='失败'&&['采集','标注','归集','生成旅程','生成报告'].includes(task.execution_phase)&&!/评论库未收录/.test(task.failure_reason||''))add('复用留底恢复',()=>manage(task,'recover'));
    add(task.archived?'恢复到列表':'归档',()=>manage(task,task.archived?'restore':'archive'));
    return box;
  }
  function showDetail(task) {
    const host=$('task-detail');host.replaceChildren();
    const main=mainTask(task),sampleTask=main||task,report=reportLink(task);if(report)host.append(report);host.append(el('p',taskView.productName(task,productCatalog),'task-title'));
    for(const text of [task.task_name||task.asins,'任务编号：'+task.id,'状态：'+statusOf(task),task.duplicate_of&&main?'主任务状态：'+statusOf(main):'',waitingText(task),'创建：'+date(task.created_at),'记录更新：'+date(task.updated_at),!task.duplicate_of&&['抓评论','标注中','生成报告'].includes(task.status)?'执行心跳：'+date(task.heartbeat_at):'','站点：US；评论范围：'+(task.review_scope==='asin_only'?'仅本 ASIN':'含变体评论'),'采集目标：'+task.reviews_per_asin+' 条 / ASIN；'+(task.duplicate_of?'主任务样本：':'')+'实际采集：'+(sampleTask.collected_count??'未返回')+'；已标注：'+sampleTask.annotated_count,taskView.feeText(task,budgetSummary,money),
      '费用：每任务上限 ¥5、每日上限 ¥50（北京时间）。额度内自动跑完整流程，超额等待追加授权；结果未知的调用保留预占额度。','恢复说明：复用已有评论和标注留底；调用结果未知时需人工核对，失败任务不会自动重新执行；有明确失败阶段的任务可请求按原授权复用留底恢复。','归档只整理列表，不暂停执行；如需停止后续调用，请先暂停。']) if(text)host.append(el('p',text));
    for(const item of sampleTask.sample_summary?.perAsin||[])host.append(el('p',`${item.requestedAsin}：${item.count} 条；采集结束原因：${item.stopReason||'未返回'}`));
    const name=el('input');name.value=task.task_name||'';name.maxLength=80;name.setAttribute('aria-label','编辑任务名称');const save=el('button','保存名称');save.type='button';save.onclick=()=>manage(task,'rename',name.value);host.append(name,save,actions(task));
    if(!$('task-dialog').open)$('task-dialog').showModal();
  }
  function taskCard(task, grouped=false) {
    const main=mainTask(task),sampleTask=main||task;
    const card=el('article',undefined,'task-card');card.dataset.taskId=task.id;card.append(taskThumbnail(task.asins));
    const body=el('div',undefined,'task-body'),heading=el('div',undefined,'task-heading');heading.append(el('strong',task.task_name||(grouped?(task.review_scope==='asin_only'?'仅本 ASIN':'含变体评论')+' · 目标 '+task.reviews_per_asin+' 条 / ASIN':taskView.productName(task,productCatalog))));
    const kind=task.duplicate_of?'queued':task.status==='完成'&&reportPath(task)?'done':task.status==='失败'||task.status==='完成'?'failed':task.status==='排队中'||task.waiting_reason?'queued':'running';heading.append(el('span',statusOf(task),`badge ${kind}`));body.append(heading);
    body.append(el('p',task.asins));
    body.append(el('p','编号：'+task.id.slice(0,8)),el('p',`US · ${task.review_scope==='asin_only'?'仅本 ASIN':'含变体评论'} · 每个 ASIN 目标 ${task.reviews_per_asin} 条`),el('p',(task.duplicate_of?'主任务样本：':'')+`实际采集：${sampleTask.collected_count??'未返回'} · 已标注：${sampleTask.annotated_count} 条`),el('p','创建：'+date(task.created_at)+' · 更新：'+date(task.updated_at)));
    if(task.duplicate_of&&main)body.append(el('p','主任务状态：'+statusOf(main)));
    body.append(el('p',taskView.feeText(task,budgetSummary,money)));
    const note=waitingText(task);if(note)body.append(el('p',note,'task-status-note'));
    const report=reportLink(task);if(report)body.append(report);
    else if(!note&&task.status!=='失败'){const progress=el('progress');progress.max=4;progress.value=Math.max(0,steps.indexOf(task.status));progress.setAttribute('aria-label','执行阶段；不是完成百分比');body.append(progress)}
    if(sampleTask.collected_count!==null&&sampleTask.collected_count!==undefined&&sampleTask.collected_count<task.reviews_per_asin*task.asins.split('+').length)body.append(el('p','实际样本未达目标，原因见任务详情。'));
    body.append(actions(task));card.append(body);return card;
  }
  function renderTasks() {
    const active=document.activeElement, focusTask=active?.closest('[data-task-id]')?.dataset.taskId, focusLabel=active?.textContent;
    const q=$('task-search').value.trim().toUpperCase(),filter=$('task-filter').value;
    const groups=taskView.groupedTasks(tasks,id=>tasks.find(t=>t.id===id)||relatedTasks.get(id),{query:q,filter,catalog:productCatalog,hasReport:reportPath});
    const records=groups.flatMap(g=>g.records),duplicates=records.reduce((n,r)=>n+r.duplicates.length,0);
    $('task-total').textContent=`当前 ${groups.length} 组商品 · ${records.length} 条主任务 · ${duplicates} 条复用记录可展开；已加载 ${tasks.length} 条记录`;
    const productGroups=groups.map(group=>{
      const section=el('section',undefined,'product-task-group');section.dataset.productGroup=group.key;
      const header=el('header',undefined,'product-group-heading'),title=el('h2',group.name);title.title=group.asins.split('+').map(a=>productCatalog[a]?.title||a).join(' + ');
      header.append(title,el('p',group.asins+' · '+group.records.length+' 个任务配置 / 版本'));if(group.asins.split('+').some(a=>!productCatalog[a]?.title))header.append(el('p','未核实的商品名称保留 ASIN；可在任务详情中命名。'));section.append(header);
      const list=el('div',undefined,'group-task-list');
      for(const record of group.records){
        const owner=el('div',undefined,'task-owner');owner.append(taskCard(record.main,true));
        if(!record.mainMatched)owner.append(el('p','主任务仅作结果关联展示；本次搜索或归档筛选匹配的是复用记录。','reuse-context'));
        if(record.duplicates.length){
          const details=el('details',undefined,'reuse-records');details.dataset.reuseGroup=record.main.id;details.open=expandedReuse.has(record.main.id)||record.forceOpen;
          details.append(el('summary','复用记录（'+record.duplicates.length+' 条）· 每条新增费用 ¥0'));
          details.addEventListener('toggle',()=>{details.open?expandedReuse.add(record.main.id):expandedReuse.delete(record.main.id)});
          for(const duplicate of record.duplicates)details.append(taskCard(duplicate));owner.append(details);
        }
        list.append(owner);
      }
      section.append(list);return section;
    });
    $('task-list').replaceChildren(...(groups.length?productGroups:[el('p',tasks.length?'没有匹配的任务，请调整搜索或筛选。':'还没有分析任务，输入 ASIN 开始。','empty-state')]));
    const more=el('button','加载更早任务','outline');more.type='button';more.onclick=()=>{loadedLimit+=50;loadTasks()};if(hasMore)$('task-list').append(more);
    if(focusTask){const card=[...$('task-list').querySelectorAll('[data-task-id]')].find(c=>c.dataset.taskId===focusTask);const button=card&&[...card.querySelectorAll('button,a')].find(b=>b.textContent===focusLabel);button?.focus({preventScroll:true})}
  }
  async function loadTasks(append=false) {
    if(loading||document.hidden)return;loading=true;
    try {
      const {data,error}=await client.from('voc_tasks').select('*').order('created_at',{ascending:false}).range(0,loadedLimit-1);if(error)throw error;
      const budget=await client.rpc('voc_budget_summary');if(!budget.error)budgetSummary=budget.data;else budgetSummary=null;
      const parentIds=[...new Set(data.map(t=>t.duplicate_of).filter(id=>id&&!data.some(t=>t.id===id)))];
      if(parentIds.length){const parents=await client.from('voc_tasks').select('*').in('id',parentIds);if(parents.error)throw parents.error;relatedTasks=new Map(parents.data.map(t=>[t.id,t]));}else relatedTasks=new Map();
      const next=data;hasMore=data.length===loadedLimit;
      const signature=JSON.stringify([next,budgetSummary,[...relatedTasks.values()]]);tasks=next;if(signature!==lastTaskRender){lastTaskRender=signature;renderTasks();if($('configure-dialog').open)updateSummary()}message($('tasks-error'),'');
    }catch(e){message($('tasks-error'),'任务列表读取失败，保留上次结果：'+e.message)}finally{loading=false}
  }
  $('asin-input').addEventListener('keydown', event => { if ((event.key === 'Enter' || event.key === ' ') && !event.isComposing) { event.preventDefault(); addInput(); } });
  $('asin-form').onsubmit = event => { event.preventDefault(); openDialog(); };
  $('close-dialog').onclick = closeDialog; $('cancel-dialog').onclick = closeDialog;
  $('configure-dialog').addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  $('select-all').onchange = () => { selected = $('select-all').checked ? new Set(asins) : new Set(); renderProducts(); };
  $('clear-selection').onclick = () => { selected.clear(); renderProducts(); };
  $('refresh').onclick = () => loadTasks(); $('task-search').oninput=renderTasks; $('task-filter').onchange=renderTasks; $('close-task').onclick=()=>$('task-dialog').close(); $('submit-form').addEventListener('change',updateSummary);
  $('submit-form').onsubmit = async event => {
    event.preventDefault(); if (busy) return;
    if (!selected.size) return message($('submit-error'), '请至少选择一个商品。');
    const count = Number(new FormData(event.target).get('review-count'));
    if (![100,200,300,500].includes(count)) return message($('submit-error'), '请选择每个 ASIN 的目标评论条数。');
    const payload = { user_id: currentSession.user.id, asins: asins.filter(a => selected.has(a)).sort().join('+'), marketplace: 'US', reviews_per_asin: count, review_scope: new FormData(event.target).get('review-scope') };
    const signature = JSON.stringify(payload);
    if (!pendingSubmission || pendingSubmission.signature !== signature) pendingSubmission = { id: crypto.randomUUID(), signature };
    busy = true; $('start-analysis').disabled = true; $('start-analysis').textContent = '正在提交…'; message($('submit-error'),'');
    try {
      const requestedId=pendingSubmission.id; const {data: submitted,error}=await client.rpc('voc_submit_task',{p_id:requestedId,p_asins:payload.asins,p_count:count,p_scope:payload.review_scope,p_name:$('task-name').value});
      if (error) {
        // An uncertain response may have committed. Read this exact UUID before offering retry.
        const { data: existing, error: readError } = await client.from('voc_tasks').select('id').eq('id',pendingSubmission.id).maybeSingle();
        if (readError || !existing) throw error;
      }
      pendingSubmission = null; $('configure-dialog').close(); message($('page-message'),submitted&&submitted.id!==requestedId?'已有相同任务，已复用该任务。':'任务已创建，将核验预算；额度内自动处理，超额会等待授权。'); await loadTasks();
    } catch (e) { message($('submit-error'),`提交未确认：${e.message}。可重试，相同配置会复用任务号防止重复提交。`); }
    finally { busy = false; $('start-analysis').disabled = false; $('start-analysis').textContent = '提交并自动分析'; }
  };
  try { currentSession = await session(); if (!currentSession) return; $('workspace').hidden = false; $('account-name').textContent = currentSession.user.email || '已登录'; await loadProductCatalog(); await loadTasks(); setInterval(()=>loadTasks(), 2000); }
  catch (e) { message($('boot-error'), `加载失败：${e.message}`); }
}());
