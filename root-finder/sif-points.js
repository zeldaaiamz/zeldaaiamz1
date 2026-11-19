'use strict';
// SIF 点数提示（2026-11-17）：入队预计点数、SIF 余额、两步查省下的词数；三步查（2026-11-19）排除的不做品类词数。纯文案，不发请求。
window.RootFinderPoints={
  estimateText(e){if(!e)return '';if(!e.keywords&&!e.maxPoints)return '不需要再花点数';return `预计约 ${e.expectedPoints} 点（最多 ${e.maxPoints} 点，${e.approx?`按历史平均约 ${e.keywords} 个词估算`:`待查 ${e.keywords} 个词`}）`;},
  quotaText(q){return q&&typeof q.remaining==='number'?`SIF 剩余 ${q.remaining} 点`:'';},
  skippedText(n){return n?`两步查省下 ${n} 个词的商品资料`:'';},
  categoryText(n){return n?`三步查排除不做的品类 ${n} 个词`:'';}
};
