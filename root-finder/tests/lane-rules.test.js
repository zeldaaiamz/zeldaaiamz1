// node root-finder/tests/lane-rules.test.js — 赛道级硬门槛（中位价≥$100、新品赛道、最高月购买量<50）；用例与后端 test_lane_rules_cases.json 相同
const fs=require('fs'),path=require('path'),dir=path.join(__dirname,'..');
const a=fs.readFileSync(path.join(dir,'app.js'),'utf8');
const grab=n=>{const i=a.indexOf('function '+n+'(');if(i<0)throw Error('missing function '+n);let d=0;for(let k=a.indexOf('{',i);;k++){if(a[k]=='{')d++;if(a[k]=='}'&&--d==0)return a.slice(i,k+1);}};
const line=re=>{const m=a.match(re);if(!m)throw Error('missing '+re);return m[0];};
eval(fs.readFileSync(path.join(dir,'quality.js'),'utf8').split('\n').slice(0,6).join('\n')+';'+line(/const hasPrice=[^\n;]*;/)+grab('screeningRaw')+';'+line(/const REVIEW_LIMIT[^\n]*?;const oldListing=[^\n]*?;};/)+';'+line(/const ANOMALY_NEW_LISTING_FROM[^\n]*/)+';'+line(/const FLOOR_OLD_REASON[^\n]*/)+';'+grab('reviewCount')+';'+grab('applyReviewRules')+';'+line(/const YOUNG_REVIEW_LIMIT[^\n]*/)+grab('beijingCutoff')+grab('listingDate')+grab('youngMarketReasons')+';globalThis.S=screeningRaw;Object.assign(globalThis,{LANE_RULES,MEDIAN_PRICE_LIMIT,NEW_MARKET_MIN_COUNT,NEW_MARKET_MIN_SHARE,SALES_MAX_LIMIT,beijingCutoff})');
const spec=JSON.parse(fs.readFileSync(path.join(__dirname,'lane-rules-cases.json'),'utf8'));
let fails=0;const check=(name,ok,info)=>{if(!ok){fails++;console.error('FAIL',name,info||'');}else console.log('ok',name);};
const iso=t=>new Date(t).toISOString().slice(0,10),today=iso(Date.now()+8*3600e3),cut=beijingCutoff();
const day=tok=>({NEW:iso(Date.parse(today)-30*864e5),CUT:cut,'CUT-1':iso(Date.parse(cut)-864e5)})[tok]??tok;
const build=c=>({queried:true,products:c.prices.map((price,i)=>{const s=c.sales[i],p={asin:'LR'+i,price,title:c.titles||'Notebook 2 Pack 8.5 x 11 inch',ratingCount:c.reviews??300,firstAvailableDate:day(c.dates[i]),monthlyPurchases:s==='NODATA'?null:s};if(s==='NODATA')p.salesUnknown=true;return p;})});
const KEYS=['medianPriceExcluded','newMarketExcluded','salesMaxExcluded'],pass=m=>!!(m.priceFloor||m.anomalies.length||m.lowCompetition||m.youngMarket.length),cur=m=>pass(m)||!!m.pendingAnomalies.length;
check('rules registered in order',LANE_RULES.map(f=>f.name).join()==='applyFloorOldListingRule,applyMedianPriceRule,applyNewMarketRule,applySalesMaxRule');
check('constants',MEDIAN_PRICE_LIMIT===100&&NEW_MARKET_MIN_COUNT===3&&NEW_MARKET_MIN_SHARE.join('/')==='1/5'&&SALES_MAX_LIMIT===50);
for(const c of spec.cases){const floor=c.floor??spec.floor,m=S(build(c),floor,0,spec.anomalyPercent),e=c.expect,hit=KEYS.filter(k=>m[k]);let ok=JSON.stringify(hit)===JSON.stringify(e.excluded?[e.excluded]:[])&&pass(m)===e.qualifies&&(e.unknown||[]).every(k=>m[k])&&(e.curatable==null||cur(m)===e.curatable)&&(e.pending==null||m.pendingAnomalies.length===e.pending)&&(!e.noFlags||![...KEYS,'laneExcluded','newMarketUnknown','salesMaxUnknown'].some(k=>m[k]));if(e.excluded)ok=ok&&m.laneExcluded===m[e.excluded]&&!m.priceFloor&&!m.anomalies.length&&!m.pendingAnomalies.length&&!m.youngMarket.length&&!m.lowCompetition;check(c.name,ok,JSON.stringify({...m,excludedAnomalies:undefined}).slice(0,600));}
// 不显示、不计数：界面没有这些规则的面板/计数字段
{const q=fs.readFileSync(path.join(dir,'quality.js'),'utf8'),h=fs.readFileSync(path.join(dir,'index.html'),'utf8');check('no lane-rule panel/count in UI',!/laneExcluded|newMarketExcluded|medianPriceExcluded|salesMaxExcluded/.test(q+h)&&(a.match(/newMarketExcluded/g)||[]).length===1);}
if(fails){console.error(fails+' failing');process.exit(1);}console.log('lane-rules ok');
