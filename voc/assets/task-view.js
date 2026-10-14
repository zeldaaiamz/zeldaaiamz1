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
  function feeText(task, budget, money) {
    if (!budget) return '费用数据尚未返回';
    const owner = task.duplicate_of || task.id;
    const cost = money(budget.taskCosts?.[owner] ?? 0);
    return (task.duplicate_of ? '本记录新增费用 ¥0；主任务核算费用（含预占，仅计一次）：' : '本任务核算费用（含预占）：') + cost + ' / ¥5；今日合计 ' + money(budget.dayUsed) + ' / ¥50';
  }
  return {mainTask, waitingText, feeText};
}));
