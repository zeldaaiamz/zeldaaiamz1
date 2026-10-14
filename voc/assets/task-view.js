(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.VOCTaskView = api;
}(typeof window === 'object' ? window : this, function () {
  'use strict';
  const activeStages = ['抓评论', '标注中', '生成报告'];
  function mainTask(task, lookup) {
    const seen = new Set();
    while (task?.duplicate_of) {
      if (seen.has(task.id)) return null;
      seen.add(task.id); task = lookup(task.duplicate_of);
    }
    return task || null;
  }
  function waitingText(task, budget, hasReport, now = Date.now()) {
    if (task.duplicate_of) return '相同 ASIN、相同配置只执行一次；主任务编号：' + task.duplicate_of.slice(0, 8);
    if (task.status === '完成') return hasReport ? '' : '没有可打开的报告；历史记录未提供结束原因，不能判断是否未取得评论。';
    if (task.status === '失败') return task.failure_reason || '失败原因未返回';
    if (task.control_state === 'paused') return '已请求暂停：正在进行的调用可能需完成后停止，留底保留；继续仍受原授权约束。';
    if (task.waiting_reason) return task.waiting_reason;
    if (task.status === '排队中') return budget && !budget.priceVerified ? '等待核实采集的人民币单价；未发起付费调用。' : '尚未开始。等待原因未同步，请查看详情；不要重复提交。';
    if (activeStages.includes(task.status) && task.heartbeat_at && now - Date.parse(task.heartbeat_at) > 120000) return '执行状态超过 2 分钟未更新，请核对执行服务；不能据此判断已失败。';
    return '';
  }
  function feeText(task, budget, money, includeDaily = true) {
    if (!budget) return '费用数据尚未返回';
    const owner = task.duplicate_of || task.id;
    const cost = money(budget.taskCosts?.[owner] ?? 0);
    return (task.duplicate_of ? '本记录新增费用 ¥0；主任务核算费用（含预占，仅计一次）：' : '本任务核算费用（含预占）：') + cost + ' / ¥5' + (includeDaily ? '；今日合计 ' + money(budget.dayUsed) + ' / ¥50' : '');
  }
  function shortTitle(title, fallback) {
    const text = typeof title === 'string' ? title.trim() : '';
    if (!text) return fallback;
    const first = text.split(/[,，|｜]/)[0].trim() || text;
    return first.length > 48 ? first.slice(0, 47) + '…' : first;
  }
  function productName(task, catalog) {
    return task.asins.split('+').map(asin => shortTitle(catalog[asin]?.title, asin)).join(' + ');
  }
  function groupedTasks(tasks, lookup, {query = '', filter = 'all', catalog = {}, hasReport} = {}) {
    const q = query.trim().toLocaleUpperCase(), products = new Map(), owners = new Map();
    const search = task => !q || [task.asins, task.task_name || '', task.id, ...task.asins.split('+').map(a => catalog[a]?.title || '')].join(' ').toLocaleUpperCase().includes(q);
    function matches(record, main) {
      if (filter === 'archived' ? !record.archived : record.archived) return false;
      if (!search(record)) return false;
      const t = main || record;
      if (filter === 'all' || filter === 'archived') return true;
      if (filter === 'done') return t.status === '完成' && hasReport(t);
      if (filter === 'failed') return t.status === '失败' || t.status === '完成' && !hasReport(t);
      if (filter === 'waiting') return !['完成', '失败'].includes(t.status) && (!!t.waiting_reason || t.control_state === 'paused' || t.status === '排队中');
      return filter === 'running' && !t.waiting_reason && t.control_state !== 'paused' && activeStages.includes(t.status);
    }
    for (const task of tasks) {
      const main = mainTask(task, lookup) || task;
      if (!matches(task, main)) continue;
      let owner = owners.get(main.id);
      if (!owner) {
        const key = (main.marketplace || 'US') + ':' + main.asins.split('+').sort().join('+');
        let group = products.get(key);
        if (!group) {group = {key, asins:main.asins, name:productName(main,catalog), records:[], latest:0}; products.set(key,group);}
        owner = {main, duplicates:[], mainMatched:false, forceOpen:false, matchedCount:0}; owners.set(main.id,owner); group.records.push(owner);
      }
      owner.matchedCount++;
      if (task.id === main.id) owner.mainMatched = true;
      else owner.duplicates.push(task);
    }
    for (const group of products.values()) for (const owner of group.records) {
      owner.forceOpen = !!q && !owner.mainMatched && owner.duplicates.length > 0;
      owner.duplicates.sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at));
      group.latest = Math.max(group.latest, ...[owner.main,...owner.duplicates].map(t=>Date.parse(t.created_at)||0));
    }
    return [...products.values()].sort((a,b)=>b.latest-a.latest);
  }
  return {mainTask, waitingText, feeText, shortTitle, productName, groupedTasks};
}));
