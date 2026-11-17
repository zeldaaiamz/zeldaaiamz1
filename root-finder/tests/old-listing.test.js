// node root-finder/tests/old-listing.test.js — 老品赛道排除（高价品全部早于近12个月上架）；v3.1 上架日缺失 → 待人工
const fs=require('fs'),path=require('path'),dir=path.join(__dirname,'..');
const a=fs.readFileSync(path.join(dir,'app.js'),'utf8');
const H=require('./_screening-harness.js')({laneRules:false,cutoff:JSON.parse(fs.readFileSync(path.join(__dirname,'old-listing-cases.json'),'utf8')).testCutoff});const S=H.S,ANOMALY_OLD_REASON=H.ANOMALY_OLD_REASON,listingDay=H.listingDay;// 只测原有规则（赛道级门槛在 lane-rules.test.js）
const spec=JSON.parse(fs.readFileSync(path.join(__dirname,'old-listing-cases.json'),'utf8'));
let fails=0;const check=(name,ok,info)=>{if(!ok){fails++;console.error('FAIL',name,info||'');}else console.log('ok',name);};
check('rolling threshold (no fixed date constant)',spec.threshold==='rolling-12m'&&!/ANOMALY_NEW_LISTING_FROM/.test(a));
check('reason text',ANOMALY_OLD_REASON===spec.reason,ANOMALY_OLD_REASON);
const build=c=>({queried:true,products:[...Array(10)].map((_,i)=>{const h=c.hi.indexOf(i);return {asin:'A'+i,price:h>=0?100:10,title:'Notebook 2 Pack 8.5 x 11 inch',monthlyPurchases:'100+',ratingCount:h>=0&&c.reviews?c.reviews[h]:300,firstAvailableDate:h>=0?c.dates[h]:(c.others||'2024-05-01')};})});
for(const c of spec.cases){const m=S(build(c),5,0,50),e=c.expect;const ok=m.anomalies.length===e.anomalies&&!!m.anomalyOldExcluded===e.old&&(e.unknown==null||(m.anomalyListingUnknown||0)===e.unknown)&&(m.anomaliesDateUnknown||[]).length===(e.dateUnknown||0)&&(e.priceFloor==null||m.priceFloor===e.priceFloor)&&(!e.review||!!m.anomalyReviewExcluded)&&(!e.top10||!!m.reviewExcluded);check(c.name,ok,JSON.stringify({a:m.anomalies.length,old:m.anomalyOldExcluded,unk:m.anomalyListingUnknown,rev:m.anomalyReviewExcluded,top:m.reviewExcluded,pf:m.priceFloor}));if(e.old)check(c.name+' → excluded reason',m.excludedAnomalies.length===c.hi.length&&m.excludedAnomalies.every(x=>x.reason===ANOMALY_OLD_REASON&&x.status==='excluded'));}
// pending anomalies are untouched (no monthlyPurchases → pending)
const pend=build({hi:[0],dates:['2020-01-01']});pend.products[0].monthlyPurchases=null;const pm=S(pend,5,0,50);check('pending old (2020) → v3.1 注定排除，移出待核实',pm.pendingAnomalies.length===0&&!pm.anomalyOldExcluded&&pm.pendingDoomedExcluded===H.PENDING_DOOMED_REASON);
const pnew=build({hi:[0],dates:['2026-03-01']});pnew.products[0].monthlyPurchases=null;const pn=S(pnew,5,0,50);check('pending new untouched',pn.pendingAnomalies.length===1&&!pn.pendingDoomedExcluded);
{const du=S(build({hi:[0],dates:[null]}),20,0,50);check('date-unknown anomaly only → 待人工 Q7',!du.anomalies.length&&du.anomaliesDateUnknown.length===1&&JSON.stringify(du.manualReview.map(x=>x.code))==='["anomaly_date_unknown"]');}
// empty / short / unqueried rows never crash or flag
for(const [n,r] of [['empty',{queried:true,products:[]}],['short',{queried:true,products:[{asin:'X',price:9,firstAvailableDate:'2020-01-01'}]}],['unqueried',{queried:false,products:[]}],['no products key',{queried:true}]]){const m=S(r,5,0,50);check('edge '+n,!m.anomalyOldExcluded&&!m.anomalies.length);}
check('listingDay null for boolean',listingDay(true)===null&&listingDay(undefined)===null&&listingDay(0)===null);
// 2026-11-17 Hongyan：「已排除的不用显示给我」——不显示老品面板/计数，被排除的赛道直接不出现；visibleRecordOps 与后端 curatable 保持原逻辑（不含老品行）
{const i=a.indexOf('visibleRecordOps(record){'),body=a.slice(i,a.indexOf('});',i));check('visibleRecordOps does not keep anomalyOldExcluded rows',i>=0&&!/anomalyOldExcluded/.test(body));}
{const q=fs.readFileSync(path.join(dir,'quality.js'),'utf8'),h=fs.readFileSync(path.join(dir,'index.html'),'utf8');check('no 老品赛道 panel/count in UI',!/oldListing|老品赛道|个老品/.test(q+h)&&!/oldListingHint|oldListingRows/.test(a));}
if(fails){console.error(fails+' failing');process.exit(1);}console.log('old-listing ok');
