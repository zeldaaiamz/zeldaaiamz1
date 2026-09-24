(function () {
  'use strict';
  const api = window.KeywordAnalysisRules;
  const dialog = document.getElementById('rule-settings');
  const form = document.getElementById('rule-settings-form');
  const fields = ['rule-orders', 'rule-rank', 'rule-acos', 'rule-clicks'].map(id => document.getElementById(id));
  const error = document.getElementById('rules-error');
  let applied = api.normalize();
  function fill(rules) {
    [rules.minOrders, rules.maxConversionRank, Number((rules.maxAcos * 100).toFixed(6)), rules.costClicksExclusive].forEach((value, index) => { fields[index].value = value; });
    error.hidden = true;
  }
  function render() {
    document.getElementById('rule-state').textContent = JSON.stringify(applied) === JSON.stringify(api.normalize()) ? '使用默认判定标准' : '使用本次自定义判定标准';
    document.getElementById('rule-preview').textContent = api.summary(applied).slice(0, 2).join('；');
  }
  document.getElementById('open-rule-settings').addEventListener('click', () => { fill(applied); dialog.showModal(); });
  document.getElementById('cancel-rules').addEventListener('click', () => dialog.close());
  document.getElementById('default-rules').addEventListener('click', () => fill(api.normalize()));
  form.addEventListener('submit', event => {
    event.preventDefault();
    try {
      if (fields.some(field => field.value.trim() === '') || !form.checkValidity()) throw new Error('请输入有效的阈值；订单、名次和点击数需为整数。');
      applied = api.normalize({ version: 1, minOrders: Number(fields[0].value), maxConversionRank: Number(fields[1].value), maxAcos: Number(fields[2].value) / 100, costClicksExclusive: Number(fields[3].value) });
      render(); dialog.close();
    } catch (err) { error.textContent = err.message; error.hidden = false; }
  });
  window.KeywordRuleSettings = { snapshot: () => api.normalize(applied), reset: () => { applied = api.normalize(); render(); } };
  render();
}());
