(function (root) {
  'use strict';
  const DEFAULTS = Object.freeze({ version: 3, minOrders: 2, maxAcos: 0.30, costAcos: 0.50, costClicks: 15 });
  function normalize(input = DEFAULTS) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('分析规则格式不正确');
    const result = { version: input.version, minOrders: input.minOrders, maxConversionRank: input.maxConversionRank, maxAcos: input.maxAcos, costClicksExclusive: input.costClicksExclusive };
    if (input.version === 3) {
      const r = { version: 3, minOrders: input.minOrders, maxAcos: input.maxAcos, costAcos: input.costAcos, costClicks: input.costClicks };
      if (!Number.isInteger(r.minOrders) || r.minOrders < 1 || r.minOrders > 1000000) throw new Error('最低订单数须为 1–1000000 的整数');
      if (![r.maxAcos, r.costAcos].every(v => typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= 10)) throw new Error('ACOS 阈值须大于 0% 且不超过 1000%');
      if (r.costAcos < r.maxAcos) throw new Error('控成本 ACOS 起点不能低于放量 ACOS 上限，避免分类重叠');
      if (!Number.isInteger(r.costClicks) || r.costClicks < 1 || r.costClicks > 1000000) throw new Error('零订单点击门槛须为 1–1000000 的整数');
      return r;
    }
    if (![1, 2].includes(result.version)) throw new Error('不支持的规则版本');
    if (!Number.isInteger(result.minOrders) || result.minOrders < 1 || result.minOrders > 1000000) throw new Error('最低订单数须为 1–1000000 的整数');
    if (result.version === 1 && (!Number.isInteger(result.maxConversionRank) || result.maxConversionRank < 1 || result.maxConversionRank > 3)) throw new Error('ABA 排名范围须为前 1–3 名');
    if (typeof result.maxAcos !== 'number' || !Number.isFinite(result.maxAcos) || result.maxAcos <= 0 || result.maxAcos > 10) throw new Error('ACOS 上限须大于 0% 且不超过 1000%');
    if (!Number.isInteger(result.costClicksExclusive) || result.costClicksExclusive < 0 || result.costClicksExclusive > 1000000) throw new Error('点击门槛须为 0–1000000 的整数');
    if (result.version === 2) delete result.maxConversionRank;
    return result;
  }
  function summary(input) {
    const r = normalize(input);
    if (r.version === 3) {
      const low = Number((r.maxAcos * 100).toFixed(6)), high = Number((r.costAcos * 100).toFixed(6));
      const observe = [`0 单且点击 < ${r.costClicks}`];
      if (r.minOrders > 1) observe.push(`订单 1–${r.minOrders - 1} 单且 ACOS < ${high}%`);
      if (r.costAcos > r.maxAcos) observe.push(`订单 ≥ ${r.minOrders} 单且 ${low}% ≤ ACOS < ${high}%`);
      return [
        `优先放量：订单 ≥ ${r.minOrders}｜ACOS < ${low}%（同时满足）`,
        `控制成本：订单 ≥ 1 且 ACOS ≥ ${high}%；或订单 = 0 且点击 ≥ ${r.costClicks}`,
        '数据不足：必要字段缺失（判断所需的订单、点击或 ACOS）；零订单时 ACOS 不适用，不算缺失',
        '继续观察：' + observe.join('；或'),
      ];
    }
    return [
      `优先放量：订单 ≥ ${r.minOrders}｜${r.version === 1 ? `ABA 转化份额排名前 ${r.maxConversionRank}｜` : ''}ACOS < ${Number((r.maxAcos * 100).toFixed(6))}%（同时满足）`,
      `控制成本：点击 > ${r.costClicksExclusive}｜订单 = 0`,
      '数据不足：必要字段缺失，且现有数据无法确定打法；零订单不等于缺失',
      '继续观察：已能判断不满足放量与控成本条件的其余词；不设最低点击门槛',
    ];
  }
  const api = { DEFAULTS, normalize, summary };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KeywordAnalysisRules = api;
}(typeof globalThis === 'undefined' ? this : globalThis));
