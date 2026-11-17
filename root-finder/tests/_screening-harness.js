// 测试共用：从 app.js / quality.js 抽出筛选相关代码（不加载 DOM），供各 *.test.js 使用。
// 规则 v2（2026-11-17）：opts.laneRules=false 时清空 LANE_RULES，只测原有规则；opts.cutoff 固定「近12个月」截止日。
const fs=require('fs'),path=require('path'),dir=path.join(__dirname,'..');
const a=fs.readFileSync(path.join(dir,'app.js'),'utf8');
const grab=n=>{const i=a.indexOf('function '+n+'(');if(i<0)throw Error('missing function '+n);let d=0;for(let k=a.indexOf('{',i);;k++){if(a[k]=='{')d++;if(a[k]=='}'&&--d==0)return a.slice(i,k+1);}};
const line=re=>{const m=a.match(re);if(!m)throw Error('missing '+re);return m[0];};
module.exports=function load(opts={}){
 const src=fs.readFileSync(path.join(dir,'quality.js'),'utf8').split('\n').slice(0,6).join('\n')+';\n'+line(/const hasPrice=[^\n;]*;/)+grab('screeningRaw')+';\n'+line(/const REVIEW_LIMIT[^\n]*/)+';\n'+line(/const ANOMALY_OLD_REASON[^\n]*/)+';\n'+line(/const MEDIAN_PRICE_MAX[^\n]*/)+';\n'+grab('reviewCount')+';\n'+grab('applyReviewRules')+';\n'+line(/const YOUNG_REVIEW_LIMIT[^\n]*/)+grab('beijingCutoff')+grab('listingDate')+grab('youngMarketReasons')+
  ';if(opts.cutoff){const fixed=opts.cutoff;beijingCutoff=()=>fixed;}if(opts.laneRules===false)LANE_RULES.length=0;'+
  'return {S:screeningRaw,LANE_RULES,ANOMALY_OLD_REASON,listingDay,beijingCutoff:(...x)=>beijingCutoff(...x),youngMarketReasons,MEDIAN_PRICE_MAX,MEDIAN_PRICE_MIN,REVIEW_MEDIAN_MAX,SALES_MAX_LIMIT,TOP3_SHARE_MAX,NEW_MARKET_MIN_COUNT,NEW_MARKET_MIN_SHARE,DARK_HORSE_REVIEW_MAX,DARK_HORSE_SALES,DARK_HORSE_TOP,IMPROVABLE_STAR_BELOW};';
 return new Function('opts',src)(opts);
};
module.exports.appSource=a;
