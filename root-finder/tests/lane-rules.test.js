// node root-finder/tests/lane-rules.test.js — 规则 v2 赛道级门槛与标签（2026-11-17 Hongyan 14:57 定稿）；用例与后端 test_lane_rules_cases.json 相同
const fs=require('fs'),path=require('path'),dir=path.join(__dirname,'..');
const H=require('./_screening-harness.js')(),a=require('./_screening-harness.js').appSource,S=H.S;
const spec=JSON.parse(fs.readFileSync(path.join(__dirname,'lane-rules-cases.json'),'utf8'));
let fails=0;const check=(name,ok,info)=>{if(!ok){fails++;console.error('FAIL',name,info||'');}else console.log('ok',name);};
const iso=t=>new Date(t).toISOString().slice(0,10),today=iso(Date.now()+8*3600e3),cut=H.beijingCutoff();
const day=tok=>({NEW:iso(Date.parse(today)-30*864e5),CUT:cut,'CUT-1':iso(Date.parse(cut)-864e5)})[tok]??tok;
const build=c=>({queried:true,products:c.prices.map((price,i)=>{const s=c.sales[i],p={asin:'LR'+i,price,title:c.titles||'Notebook 2 Pack 8.5 x 11 inch',ratingCount:c.reviews[i],starRating:c.stars[i],firstAvailableDate:day(c.dates[i]),monthlyPurchases:s==='NODATA'?null:s};if(s==='NODATA')p.salesUnknown=true;return p;})});
const KEYS=['medianPriceHighExcluded','medianPriceLowExcluded','reviewMedianExcluded','salesMaxExcluded','top3ShareExcluded','newMarketExcluded'],FLAGS=['medianPriceUnknown','reviewMedianUnknown','salesMaxUnknown','top3ShareUnknown','newMarketUnknown'];
const pass=m=>!!(m.priceFloor||m.anomalies.length||m.lowCompetition||m.youngMarket.length),cur=m=>pass(m)||!!m.pendingAnomalies.length;
check('rules registered in order',H.LANE_RULES.map(f=>f.name).join()==='applyMedianPriceRule,applyReviewMedianRule,applySalesMaxRule,applyTop3ShareRule,applyNewMarketRule,applyLaneLabels');
check('constants',JSON.stringify([H.MEDIAN_PRICE_MAX,H.MEDIAN_PRICE_MIN,H.REVIEW_MEDIAN_MAX,H.SALES_MAX_LIMIT,H.TOP3_SHARE_MAX,H.NEW_MARKET_MIN_COUNT,H.NEW_MARKET_MIN_SHARE,H.DARK_HORSE_REVIEW_MAX,H.DARK_HORSE_SALES,H.DARK_HORSE_TOP,H.IMPROVABLE_STAR_BELOW])==='[100,15,500,50,[75,100],3,[1,5],100,300,3,4.2]');
check('v2b reason text',/REVIEW_MEDIAN_REASON='前10产品评价数中位数>500，不入选'/.test(a)&&/TOP3_SHARE_REASON='月购买量前3名合计占比>75%，不入选'/.test(a));
check('removed: N1 / D2 / fixed 2026-01-01',!/FLOOR_OLD|TOP10_OLD_REASON|OLD_DATE_LIMIT|ANOMALY_NEW_LISTING_FROM|2026-01-01/.test(a));
for(const c of spec.cases){const floor=c.floor??spec.floor,m=S(build(c),floor,0,spec.anomalyPercent),e=c.expect,hit=KEYS.filter(k=>m[k]);
 let ok=JSON.stringify(hit)===JSON.stringify(e.excluded?[e.excluded]:[])&&pass(m)===e.qualifies&&(e.unknown||[]).every(k=>m[k])&&JSON.stringify((m.darkHorses||[]).map(d=>d.asin))===JSON.stringify(e.darkHorses)&&!!m.improvable===e.improvable&&(e.curatable==null||cur(m)===e.curatable)&&(e.pending==null||m.pendingAnomalies.length===e.pending)&&(e.anomalies==null||m.anomalies.length===e.anomalies)&&(e.anomalyOld==null||!!m.anomalyOldExcluded===e.anomalyOld)&&(!e.noReviewExcluded||!m.reviewExcluded)&&(!e.noFlags||![...KEYS,...FLAGS,'laneExcluded','darkHorses','improvable'].some(k=>m[k]));
 if(e.excluded)ok=ok&&m.laneExcluded===m[e.excluded]&&!m.priceFloor&&!m.anomalies.length&&!m.pendingAnomalies.length&&!m.youngMarket.length&&!m.lowCompetition&&!m.darkHorses&&!m.improvable;
 check(c.name,ok,JSON.stringify({...m,excludedAnomalies:undefined}).slice(0,700));}
{const m=S(build(spec.cases.find(c=>c.name.startsWith('N4 dark horse ≥300'))),5,0,50);check('dark horse label carries asin/sales/reviews/date',m.darkHorses&&['asin','monthlyPurchases','ratingCount','listingDay'].every(k=>k in m.darkHorses[0]));}
for(const [n,r] of [['empty',{queried:true,products:[]}],['unqueried',{queried:false,products:[]}],['no products key',{queried:true}]]){const m=S(r,5,0,50);check('edge '+n,!KEYS.some(k=>m[k]));}
{const calls=[];H.LANE_RULES.unshift((r,ps,ctx)=>calls.push(ctx));S(build(spec.cases[0]),5,0,50);H.LANE_RULES.shift();check('LANE_RULES hook gets ctx',calls.length===1&&calls[0].floor===5&&calls[0].anomaly===50);}
// 界面：黑马/有改进空间徽章；被排除的不显示、不计数（无面板/计数）
check('dark horse + improvable badges rendered on result cards',/黑马 · /.test(a)&&/有改进空间 · /.test(a));
{const q=fs.readFileSync(path.join(dir,'quality.js'),'utf8'),h=fs.readFileSync(path.join(dir,'index.html'),'utf8');check('no exclusion panel/count in UI',!/laneExcluded|newMarketExcluded|medianPrice\w*Excluded|salesMaxExcluded|top3ShareExcluded|reviewMedianExcluded/.test(q+h)&&(a.match(/newMarketExcluded/g)||[]).length===1);}
{const i=a.indexOf('visibleRecordOps(record){'),body=a.slice(i,a.indexOf('});',i));check('visibleRecordOps unchanged (screening only)',i>=0&&!/laneExcluded|darkHorse/.test(body));}
if(fails){console.error(fails+' failing');process.exit(1);}console.log('lane-rules v2 ok');
