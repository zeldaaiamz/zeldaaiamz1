// node root-finder/tests/bulky-flag.test.js — 大件赛道排除 v2（2026-11-17）：前端只认后端下发的 row.bulky，不自己判、不显示词库/面板/计数
const fs=require('fs'),path=require('path'),dir=path.join(__dirname,'..');
const a=fs.readFileSync(path.join(dir,'app.js'),'utf8');
const grab=n=>{const i=a.indexOf('function '+n+'(');if(i<0)throw Error('missing function '+n);let d=0;for(let k=a.indexOf('{',i);;k++){if(a[k]=='{')d++;if(a[k]=='}'&&--d==0)return a.slice(i,k+1);}};
const line=re=>{const m=a.match(re);if(!m)throw Error('missing '+re);return m[0];};
eval(fs.readFileSync(path.join(dir,'quality.js'),'utf8').split('\n').slice(0,6).join('\n')+';'+line(/const hasPrice=[^\n;]*;/)+grab('screeningRaw')+';'+line(/const REVIEW_LIMIT[^\n]*?;const oldListing=[^\n]*?;};/)+';'+line(/const ANOMALY_NEW_LISTING_FROM[^\n]*/)+';'+line(/const FLOOR_OLD_REASON[^\n]*/)+';'+'/* 本文件只测原有规则：赛道级硬门槛（中位价/新品赛道/购买量）在 lane-rules.test.js 单独测，这里只保留第 1 条高于底价老品规则 */LANE_RULES.splice(1);'+grab('reviewCount')+';'+grab('applyReviewRules')+';'+line(/const YOUNG_REVIEW_LIMIT[^\n]*/)+grab('beijingCutoff')+grab('listingDate')+grab('youngMarketReasons')+';globalThis.S=screeningRaw;');
let fails=0;const check=(name,ok,info)=>{if(!ok){fails++;console.error('FAIL',name,info||'');}else console.log('ok',name);};
const build=(extra={},hi=-1)=>({queried:true,...extra,products:[...Array(10)].map((_,i)=>({asin:'A'+i,price:i===hi?300:100,title:'Cat Tree Tower',monthlyPurchases:'100+',ratingCount:i===hi?20:120,firstAvailableDate:'2026-03-01'}))});
const pass=m=>m.priceFloor||m.anomalies.length||m.lowCompetition||m.youngMarket.length||m.pendingAnomalies.length;
check('without flag passes as before',pass(S(build(),20,0,50)));
const m=S(build({bulky:true},0),20,0,50);
check('bulky flag → no rule passes, no pending',!pass(m)&&m.bulkyExcluded===true,JSON.stringify(m));
check('bulky flag false/absent unchanged',pass(S(build({bulky:false}),20,0,50)));
{const i=a.indexOf('visibleRecordOps(record){'),body=a.slice(i,a.indexOf('});',i));check('visibleRecordOps relies on screening only',i>=0&&!/bulky/.test(body));}
{const q=fs.readFileSync(path.join(dir,'quality.js'),'utf8'),h=fs.readFileSync(path.join(dir,'index.html'),'utf8'),c=fs.readFileSync(path.join(dir,'cloud.js'),'utf8');
 check('no 大件 panel/count/词库 in UI',!/大件|size_words|bulkyHint|bulkyRows/.test(q+h+c+a.replace(/\/\/[^\n]*/g,'')));}
if(fails){console.error(fails+' failing');process.exit(1);}console.log('bulky-flag ok');
