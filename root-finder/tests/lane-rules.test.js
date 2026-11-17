// node root-finder/tests/lane-rules.test.js — 规则 v3.1（MECE 16 叶子，2026-11-17 17:39 上线）；用例与后端 test_lane_rules_cases.json 相同
const fs=require('fs'),path=require('path'),dir=path.join(__dirname,'..');
const H=require('./_screening-harness.js')(),a=require('./_screening-harness.js').appSource,S=H.S;
const spec=JSON.parse(fs.readFileSync(path.join(__dirname,'lane-rules-cases.json'),'utf8'));
let fails=0;const check=(name,ok,info)=>{if(!ok){fails++;console.error('FAIL',name,info||'');}else console.log('ok',name);};
const iso=t=>new Date(t).toISOString().slice(0,10),today=iso(Date.now()+8*3600e3),cut=H.beijingCutoff();
const day=tok=>({NEW:iso(Date.parse(today)-30*864e5),CUT:cut,'CUT-1':iso(Date.parse(cut)-864e5)})[tok]??tok;
const build=c=>({queried:true,products:c.prices.map((price,i)=>{const s=c.sales[i],p={asin:'LR'+i,price,title:c.titles||'Notebook 2 Pack 8.5 x 11 inch',ratingCount:c.reviews[i],starRating:c.stars[i],firstAvailableDate:day(c.dates[i]),monthlyPurchases:s==='NODATA'?null:s};if(s==='NODATA')p.salesUnknown=true;return p;})});
const KEYS=['medianPriceHighExcluded','salesMaxExcluded','newMarketExcluded'];
const pass=m=>H.sureReason(m)&&!m.manualReview.length,cur=m=>H.laneCandidate(m);
check('v3.1 rules registered in order',H.LANE_RULES.map(f=>f.name).join()==='applyMedianPriceRule,applySalesMaxRule,applyNewMarketRule,applyTop10ReviewRule,applyLaneLabels,applyDataGapRule');
check('v3.1 constants',JSON.stringify([H.MEDIAN_PRICE_MAX,H.SALES_MAX_LIMIT,H.NEW_MARKET_MIN_COUNT,H.TOP10_REVIEW_MIN,H.DARK_HORSE_REVIEW_MAX,H.DARK_HORSE_SALES,H.IMPROVABLE_STAR_BELOW])==='[100,50,1,500,100,50,4.2]');
check('v3.1 removed: N6 / N3 share / N7 / N8',!/REVIEW_MEDIAN|NEW_MARKET_MIN_SHARE|TOP3_SHARE|MEDIAN_PRICE_MIN|N6_NEW_EXEMPT|applyReviewMedianRule/.test(a));
check('v3.1 reasons same as backend',H.NEW_MARKET_REASON==='近12个月上架的新品一个都没有（也没有黑马），不入选'&&H.MANUAL_REASONS.zero_products.startsWith('零商品'));
check('removed: N1 / D2 / fixed 2026-01-01',!/FLOOR_OLD|TOP10_OLD_REASON|OLD_DATE_LIMIT|ANOMALY_NEW_LISTING_FROM|2026-01-01/.test(a));
const outs={};
for(const c of spec.cases){const floor=c.floor??spec.floor,anom='anomaly' in c?c.anomaly:spec.anomalyPercent,m=S(build(c),floor,0,anom),e=c.expect;
 const out=pass(m)?'pass':cur(m)?'review':'exclude';outs[out]=(outs[out]||0)+1;const codes=(m.manualReview||[]).map(x=>x.code);
 let ok=out===e.outcome&&e.manual.every(k=>codes.includes(k))&&(out!=='review'||codes.length>0||m.pendingAnomalies.length>0)&&(out!=='pass'||!codes.length)&&JSON.stringify((m.darkHorses||[]).map(d=>d.asin))===JSON.stringify(e.darkHorses)&&!!m.improvable===e.improvable;
 if(e.excluded)ok=ok&&!!m[e.excluded]&&m.laneExcluded===m[e.excluded]&&!codes.length&&!m.priceFloor&&!m.anomalies.length&&!m.pendingAnomalies.length&&!m.darkHorses;
 if(out==='exclude')ok=ok&&!codes.length&&!m.pendingAnomalies.length;
 check(c.name+' ['+e.leaf+']',ok,out+' '+codes+' '+JSON.stringify({...m,excludedAnomalies:undefined}).slice(0,600));}
console.log('outcomes',JSON.stringify(outs));
// 人工确认入库（2026-11-17 20:28）：前端 manualConfirmable = 待人工，与后端 lanes.manual_confirmable 同口径（两边都对照这 1,708 条共用用例）
{const grab=n=>{const i=a.indexOf('function '+n+'(');if(i<0)throw Error('missing '+n);let d=0;for(let k=a.indexOf('{',i);;k++){if(a[k]=='{')d++;if(a[k]=='}'&&--d==0)return a.slice(i,k+1);}};
 const F=new Function('rowMatch','sureReason',grab('rowPass')+grab('rowReview')+grab('manualConfirmable')+'return {rowPass,rowReview,manualConfirmable};');
 const bad=[];for(const c of spec.cases){const floor=c.floor??spec.floor,anom='anomaly' in c?c.anomaly:spec.anomalyPercent,m=S(build(c),floor,0,anom),f=F(()=>m,H.sureReason);if(f.manualConfirmable({})!==(c.expect.outcome==='review')||f.rowPass({})!==(c.expect.outcome==='pass'))bad.push(c.name);}
 check('manualConfirmable == 待人工 on all shared cases (same as backend)',!bad.length,bad.slice(0,5));}
{const m=S(build(spec.cases.find(c=>c.name.startsWith('v3.1 黑马：评价18 月购51'))),5,0,50);check('dark horse label carries asin/sales/reviews/date',m.darkHorses&&['asin','monthlyPurchases','ratingCount','listingDay'].every(k=>k in m.darkHorses[0]));}
for(const [n,r] of [['empty',{queried:true,products:[]}],['no products key',{queried:true}]]){const m=S(r,5,0,50);check('edge '+n+' → 零商品待人工',!KEYS.some(k=>m[k])&&JSON.stringify(m.manualReview.map(x=>x.code))==='["zero_products"]'&&cur(m)&&!pass(m));}
{const m=S({queried:false,products:[]},5,0,50);check('edge unqueried → 排除',!m.manualReview.length&&!cur(m));}
{const m=S({queried:true,bulky:true,products:Array.from({length:11},(_,i)=>({asin:'X'+i,price:20}))},5,0,50);check('11 products → 待人工 even if bulky flag',JSON.stringify(m.manualReview.map(x=>x.code))==='["over_ten"]'&&!m.bulkyExcluded);}
{const calls=[];H.LANE_RULES.unshift((r,ps,ctx)=>calls.push(ctx));S(build(spec.cases[0]),5,0,50);H.LANE_RULES.shift();check('LANE_RULES hook gets ctx',calls.length===1&&calls[0].floor===5&&calls[0].anomaly===50);}
// 界面：黑马/有改进空间徽章；被排除的不显示、不计数（无面板/计数）
check('dark horse + improvable badges rendered on result cards',/黑马 · /.test(a)&&/有改进空间 · /.test(a)&&/\$\{horseBadge\(row\)\}/.test(a));
{const q=fs.readFileSync(path.join(dir,'quality.js'),'utf8'),h=fs.readFileSync(path.join(dir,'index.html'),'utf8');check('no exclusion panel/count in UI',!/laneExcluded|newMarketExcluded|medianPrice\w*Excluded|salesMaxExcluded|top3ShareExcluded|reviewMedianExcluded/.test(q+h)&&(a.match(/newMarketExcluded/g)||[]).length===1);}
{const i=a.indexOf('visibleRecordOps(record){'),body=a.slice(i,a.indexOf('});',i));check('visibleRecordOps = laneCandidate (入选 ∪ 待人工, same as backend curatable)',i>=0&&/laneCandidate\(m\)/.test(body)&&!/laneExcluded|darkHorse/.test(body));}
{const q=fs.readFileSync(path.join(dir,'quality.js'),'utf8');check('待人工 panel lists rowReview rows with 零商品 tag + 黑马',/filter\(r=>rowReview\(r\)&&!isSavedLane\(r\)\)/.test(q)&&/待人工 · \$\{rows\.length\}/.test(q)&&/zero_products:'零商品'/.test(q)&&/horseBadge\(r\)/.test(q));}
check('rowPass excludes 待人工',/function rowPass\(row\)\{const m=rowMatch\(row\);return sureReason\(m\)&&!m\.manualReview\.length;\}/.test(a));
// v3.1 前后端同口径：filledFields 里的补值不进「原始口径」规则（新兴赛道 / 高价品评价 / 老品 / 待核实 / 前10全>500），赛道门槛仍用补值
{const H2=require('./_screening-harness.js')({laneRules:false});const mk=(f)=>({queried:true,products:[...Array(10)].map((_,i)=>({asin:'F'+i,price:10,title:'Notebook 2 Pack 8.5 x 11 inch',monthlyPurchases:100,...f(i)}))});
 const y=H2.S(mk(()=>({ratingCount:300,firstAvailableDate:'2026-05-01',filledFields:['firstAvailableDate']})),20,0,50);check('filled dates do not make 新兴赛道',!y.youngMarket.length,JSON.stringify(y.youngMarket));
 const y2=H2.S(mk(()=>({ratingCount:300,firstAvailableDate:'2026-05-01'})),20,0,50);check('raw dates still make 新兴赛道',y2.youngMarket.length===1);
 const r=H2.S(mk(()=>({ratingCount:50,filledFields:['ratingCount'],firstAvailableDate:'2020-01-01'})),20,0,50);check('filled reviews do not make 新兴赛道 (评论<200)',!r.youngMarket.length);
 const t=H2.S(mk(()=>({ratingCount:900,filledFields:['ratingCount'],firstAvailableDate:'2026-05-01'})),5,0,50);check('filled reviews do not make top10AllHigh',!t.top10AllHigh);
 const lane=H.S(mk(i=>({ratingCount:300,firstAvailableDate:i?'2020-01-01':'2026-05-01',filledFields:i?[]:['firstAvailableDate']})),5,0,50);check('lane rules still use filled date (新品门槛过)',!lane.newMarketExcluded&&!lane.newMarketUnknown&&lane.priceFloor);}
{const h=fs.readFileSync(path.join(dir,'index.html'),'utf8');check('FE version rules-v31-2',/app\.js\?v=rules-v31-2/.test(h)&&/quality\.js\?v=rules-v31-2/.test(h));}
{const q=fs.readFileSync(path.join(dir,'quality.js'),'utf8'),h=fs.readFileSync(path.join(dir,'index.html'),'utf8');check('待人工-only rows: no 待补购买量 chip / 重新核实 button',/\$\{pend\?aiRowChip\(r\):''\}/.test(q)&&/\$\{pend\?aiRowButton\(r\):''\}/.test(q));check('待人工 panel notice explains v3.1',/待人工：/.test(h));}
if(fails){console.error(fails+' failing');process.exit(1);}console.log('lane-rules v3.1 ok');
