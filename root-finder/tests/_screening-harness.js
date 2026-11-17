// 测试共用：从 app.js / quality.js 抽出筛选相关代码（不加载 DOM），供各 *.test.js 使用。
// 规则 v3.1（2026-11-17）：opts.laneRules=false 时清空 LANE_RULES，只测原有规则；opts.cutoff 固定「近12个月」截止日。
const fs=require('fs'),path=require('path'),dir=path.join(__dirname,'..');
const a=fs.readFileSync(path.join(dir,'app.js'),'utf8');
const grab=n=>{const i=a.indexOf('function '+n+'(');if(i<0)throw Error('missing function '+n);let d=0;for(let k=a.indexOf('{',i);;k++){if(a[k]=='{')d++;if(a[k]=='}'&&--d==0)return a.slice(i,k+1);}};
const line=re=>{const m=a.match(re);if(!m)throw Error('missing '+re);return m[0];};
module.exports=function load(opts={}){
 // v3.1：app.js 里 screeningRaw … youngMarketReasons 是一整段筛选代码（含待人工、LANE_RULES），整段取出
 const i=a.indexOf('function screeningRaw('),j=a.indexOf('const screeningCache');if(i<0||j<i)throw Error('missing screening block');
 const src=fs.readFileSync(path.join(dir,'quality.js'),'utf8').split('\n').slice(0,6).join('\n')+';\n'+line(/const hasPrice=[^\n;]*;/)+'\n'+a.slice(i,j)+
  ';if(opts.cutoff){const fixed=opts.cutoff;beijingCutoff=()=>fixed;}if(opts.laneRules===false)LANE_RULES.length=0;'+
  'return {S:screeningRaw,LANE_RULES,ANOMALY_OLD_REASON,listingDay,beijingCutoff:(...x)=>beijingCutoff(...x),youngMarketReasons,MEDIAN_PRICE_MAX,SALES_MAX_LIMIT,NEW_MARKET_MIN_COUNT,TOP10_REVIEW_MIN,DARK_HORSE_REVIEW_MAX,DARK_HORSE_SALES,IMPROVABLE_STAR_BELOW,MANUAL_REASONS,NEW_MARKET_REASON,PENDING_DOOMED_REASON,laneCandidate,sureReason};';
 return new Function('opts',src)(opts);
};
module.exports.appSource=a;
