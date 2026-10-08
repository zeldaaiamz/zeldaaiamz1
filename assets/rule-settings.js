(function () {
  'use strict';
  const api = window.KeywordAnalysisRules;
  const dialog = document.getElementById('rule-settings');
  const form = document.getElementById('rule-settings-form');
  const fields = ['rule-orders', 'rule-acos', 'rule-cost-acos', 'rule-clicks', 'rule-top-rank', 'rule-rising-acos', 'rule-observation-days'].map(id => document.getElementById(id));
  const error = document.getElementById('rules-error');
  let applied = api.normalize();
  function fill(rules) {
    [rules.minOrders, Number((rules.maxAcos * 100).toFixed(6)), Number((rules.costAcos * 100).toFixed(6)), rules.costClicks, rules.adPlan?.topRank ?? 3, (rules.adPlan?.risingAcosCap ?? 1)*100, rules.adPlan?.observationDays ?? 7].forEach((value, index) => { fields[index].value = value; });
    updateObservation();
    error.hidden = true;
  }
  function updateObservation() {
    try {
      const r = api.normalize({version:3,minOrders:Number(fields[0].value),maxAcos:Number(fields[1].value)/100,costAcos:Number(fields[2].value)/100,costClicks:Number(fields[3].value),adPlan:{topRank:Number(fields[4].value),risingAcosCap:Number(fields[5].value)/100,observationDays:Number(fields[6].value)}});
      document.getElementById('observation-preview').textContent = api.summary(r)[3] + `；广告06：自然位前 ${r.adPlan.topRank} 且满足低ACOS与订单门槛时该守；排名缺失可按广告表现该加；已出单且高ACOS的排名上涨词，ACOS≤${Number((r.adPlan.risingAcosCap*100).toFixed(4))}%可观察${r.adPlan.observationDays}天。`;
    } catch (_) { document.getElementById('observation-preview').textContent = '请填写有效且不重叠的阈值，观察范围将自动更新。'; }
  }
  fields.forEach(field => field.addEventListener('input', updateObservation));
  function render() {
    document.getElementById('rule-state').textContent = JSON.stringify(applied) === JSON.stringify(api.normalize()) ? '使用默认判定标准' : '使用本次自定义判定标准';
    document.getElementById('rule-preview').textContent = [...api.summary(applied).slice(0, 2), api.summary(applied)[3]].join('；') + `。广告06：前${applied.adPlan?.topRank ?? 3}守位；上涨容忍ACOS≤${Number(((applied.adPlan?.risingAcosCap ?? 1)*100).toFixed(4))}%，观察${applied.adPlan?.observationDays ?? 7}天。`;
  }
  document.getElementById('open-rule-settings').addEventListener('click', () => { fill(applied); dialog.showModal(); });
  document.getElementById('cancel-rules').addEventListener('click', () => dialog.close());
  document.getElementById('default-rules').addEventListener('click', () => fill(api.normalize()));
  form.addEventListener('submit', event => {
    event.preventDefault();
    try {
      if (fields.some(field => field.value.trim() === '') || !form.checkValidity()) throw new Error('请输入有效的阈值；订单和点击数需为整数。');
      applied = api.normalize({ version: 3, minOrders: Number(fields[0].value), maxAcos: Number(fields[1].value) / 100, costAcos: Number(fields[2].value) / 100, costClicks: Number(fields[3].value), adPlan:{topRank:Number(fields[4].value),risingAcosCap:Number(fields[5].value)/100,observationDays:Number(fields[6].value)} });
      render(); dialog.close();
    } catch (err) { error.textContent = err.message; error.hidden = false; }
  });
  window.KeywordRuleSettings = { snapshot: () => api.normalize(applied), reset: () => { applied = api.normalize(); render(); } };
  render();
}());
