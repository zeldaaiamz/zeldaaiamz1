(async function () {
  'use strict';
  const { client, session, el, message, reportPath } = window.VOC;
  const $ = id => document.getElementById(id);
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
  function updateSelection() { $('selection-count').textContent = `${selected.size}/${asins.length} 已选择`; $('select-all').checked = selected.size === asins.length; $('select-all').indeterminate = selected.size > 0 && selected.size < asins.length; }
  function renderProducts() {
    $('products').replaceChildren(...asins.map(asin => {
      const card = el('label', undefined, 'product-card'); const check = el('input'); check.type = 'checkbox'; check.value = asin; check.checked = selected.has(asin); check.onchange = () => { check.checked ? selected.add(asin) : selected.delete(asin); updateSelection(); };
      card.append(check, el('span', '▧', 'product-placeholder'), el('strong', asin), el('small', '美国站 · 商品信息待抓取')); return card;
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
  function taskCard(task) {
    const card = el('article', undefined, 'task-card'); card.dataset.taskId = task.id;
    card.append(el('div', '▧', 'task-placeholder')); const body = el('div', undefined, 'task-body');
    const heading = el('div', undefined, 'task-heading'); heading.append(el('strong', task.asins));
    const kind = task.status === '完成' ? 'done' : task.status === '失败' ? 'failed' : task.status === '排队中' ? 'queued' : 'running';
    heading.append(el('span', task.status, `badge ${kind}`)); body.append(heading);
    body.append(el('p', `站点：US · ${task.review_scope === 'asin_only' ? '仅本 ASIN' : '含变体评论'}`));
    body.append(el('p', `每个 ASIN 目标：${task.reviews_per_asin} 条`));
    body.append(el('p', `已标注：${task.annotated_count} 条`));
    body.append(el('time', new Intl.DateTimeFormat('zh-CN', { month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' }).format(new Date(task.created_at))));
    if (task.status === '失败') body.append(el('p', task.failure_reason || '任务失败，请联系管理员', 'failure'));
    else if (task.status === '完成') {
      if (reportPath(task)) { const link = el('a', '点击查看报告 →', 'report-link'); link.href = `report/?task=${encodeURIComponent(task.id)}`; body.append(link); }
      else body.append(el('p', '空跑完成，暂无报告', 'empty-report'));
    } else { const progress = el('progress'); progress.max = 4; progress.value = Math.max(0, steps.indexOf(task.status)); progress.setAttribute('aria-label', '任务阶段进度'); body.append(progress); }
    card.append(body); return card;
  }
  async function loadTasks() {
    if (loading || document.hidden) return; loading = true;
    try {
      const { data, error } = await client.from('voc_tasks').select('id,asins,marketplace,reviews_per_asin,review_scope,status,annotated_count,failure_reason,report_path,created_at').order('created_at', { ascending: false }).limit(50);
      if (error) throw error;
      $('task-list').replaceChildren(...(data.length ? data.map(taskCard) : [el('p','还没有分析任务，输入 ASIN 开始。','empty-state')])); message($('tasks-error'), '');
    } catch (e) { message($('tasks-error'), `任务列表读取失败：${e.message}`); }
    finally { loading = false; }
  }
  $('asin-input').addEventListener('keydown', event => { if ((event.key === 'Enter' || event.key === ' ') && !event.isComposing) { event.preventDefault(); addInput(); } });
  $('asin-form').onsubmit = event => { event.preventDefault(); openDialog(); };
  $('close-dialog').onclick = closeDialog; $('cancel-dialog').onclick = closeDialog;
  $('configure-dialog').addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  $('select-all').onchange = () => { selected = $('select-all').checked ? new Set(asins) : new Set(); renderProducts(); };
  $('clear-selection').onclick = () => { selected.clear(); renderProducts(); };
  $('refresh').onclick = loadTasks;
  $('submit-form').onsubmit = async event => {
    event.preventDefault(); if (busy) return;
    if (!selected.size) return message($('submit-error'), '请至少选择一个商品。');
    const count = Number(new FormData(event.target).get('review-count'));
    if (![100,200,300,500].includes(count)) return message($('submit-error'), '请选择每个 ASIN 的目标评论条数。');
    const payload = { user_id: currentSession.user.id, asins: asins.filter(a => selected.has(a)).join('+'), marketplace: 'US', reviews_per_asin: count, review_scope: new FormData(event.target).get('review-scope') };
    const signature = JSON.stringify(payload);
    if (!pendingSubmission || pendingSubmission.signature !== signature) pendingSubmission = { id: crypto.randomUUID(), signature };
    busy = true; $('start-analysis').disabled = true; $('start-analysis').textContent = '正在提交…'; message($('submit-error'),'');
    try {
      const { error } = await client.from('voc_tasks').insert({ id: pendingSubmission.id, ...payload });
      if (error) {
        // An uncertain response may have committed. Read this exact UUID before offering retry.
        const { data: existing, error: readError } = await client.from('voc_tasks').select('id').eq('id',pendingSubmission.id).maybeSingle();
        if (readError || !existing) throw error;
      }
      pendingSubmission = null; $('configure-dialog').close(); message($('page-message'),'任务已提交，正在排队空跑。'); await loadTasks();
    } catch (e) { message($('submit-error'),`提交未确认：${e.message}。可重试，相同配置会复用任务号防止重复提交。`); }
    finally { busy = false; $('start-analysis').disabled = false; $('start-analysis').textContent = 'ϟ 开始分析'; }
  };
  try { currentSession = await session(); if (!currentSession) return; $('workspace').hidden = false; $('account-name').textContent = currentSession.user.email || '已登录'; await loadTasks(); setInterval(loadTasks, 2000); }
  catch (e) { message($('boot-error'), `加载失败：${e.message}`); }
}());
