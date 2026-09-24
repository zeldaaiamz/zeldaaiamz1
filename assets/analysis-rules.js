(function (root) {
  'use strict';
  const DEFAULTS = Object.freeze({ version: 1, minOrders: 2, maxConversionRank: 3, maxAcos: 0.25, costClicksExclusive: 15 });
  function normalize(input = DEFAULTS) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('分析规则格式不正确');
    const result = { version: input.version, minOrders: input.minOrders, maxConversionRank: input.maxConversionRank, maxAcos: input.maxAcos, costClicksExclusive: input.costClicksExclusive };
    if (result.version !== 1) throw new Error('不支持的规则版本');
    if (!Number.isInteger(result.minOrders) || result.minOrders < 1 || result.minOrders > 1000000) throw new Error('最低订单数须为 1–1000000 的整数');
    if (!Number.isInteger(result.maxConversionRank) || result.maxConversionRank < 1 || result.maxConversionRank > 3) throw new Error('ABA 排名范围须为前 1–3 名');
    if (typeof result.maxAcos !== 'number' || !Number.isFinite(result.maxAcos) || result.maxAcos <= 0 || result.maxAcos > 10) throw new Error('ACOS 上限须大于 0% 且不超过 1000%');
    if (!Number.isInteger(result.costClicksExclusive) || result.costClicksExclusive < 0 || result.costClicksExclusive > 1000000) throw new Error('点击门槛须为 0–1000000 的整数');
    return result;
  }
  function summary(input) {
    const r = normalize(input);
    return [
      `优先放量：订单 ≥ ${r.minOrders}｜ABA 转化份额排名前 ${r.maxConversionRank}｜ACOS < ${Number((r.maxAcos * 100).toFixed(6))}%（同时满足）`,
      `控制成本：点击 > ${r.costClicksExclusive}｜订单 = 0`,
      '数据不足：必要字段缺失，且现有数据无法确定打法；零订单不等于缺失',
      '继续观察：已能判断不满足放量与控成本条件的其余词；不设最低点击门槛',
    ];
  }
  const api = { DEFAULTS, normalize, summary };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KeywordAnalysisRules = api;
}(typeof globalThis === 'undefined' ? this : globalThis));
