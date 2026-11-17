// node root-finder/tests/floor-old.test.js — 高于底价老品赛道排除（10 个产品上架时间均早于 2026-01-01）；用例与后端 test_floor_old_cases.json 相同
const fs=require('fs'),path=require('path'),dir=path.join(__dirname,'..');
const a=fs.readFileSync(path.join(dir,'app.js'),'utf8');
const grab=n=>{const i=a.indexOf('function '+n+'(');if(i<0)throw Error('missing function '+n);let d=0;for(let k=a.indexOf('{',i);;k++){if(a[k]=='{')d++;if(a[k]=='}'&&--d==0)return a.slice(i,k+1);}};
const line=re=>{const m=a.match(re);if(!m)throw Error('missing '+re);return m[0];};
eval(fs.readFileSync(path.join(dir,'quality.js'),'utf8').split('\n').slice(0,6).join('\n')+';'+line(/const hasPrice=[^\n;]*;/)+grab('screeningRaw')+';'+line(/const REVIEW_LIMIT[^\n]*?;const oldListing=[^\n]*?;};/)+';'+line(/const ANOMALY_NEW_LISTING_FROM[^\n]*/)+';'+line(/const FLOOR_OLD_REASON[^\n]*/)+';'+grab('reviewCount')+';'+grab('applyReviewRules')+';'+line(/const YOUNG_REVIEW_LIMIT[^\n]*/)+grab('beijingCutoff')+grab('listingDate')+grab('youngMarketReasons')+';globalThis.S=screeningRaw;Object.assign(globalThis,{FLOOR_OLD_REASON,LANE_RULES,ANOMALY_NEW_LISTING_FROM,applyFloorOldListingRule})');
const spec=JSON.parse(fs.readFileSync(path.join(__dirname,'floor-old-cases.json'),'utf8'));
let fails=0;const check=(name,ok,info)=>{if(!ok){fails++;console.error('FAIL',name,info||'');}else console.log('ok',name);};
check('threshold reuses ANOMALY_NEW_LISTING_FROM',ANOMALY_NEW_LISTING_FROM===spec.threshold&&/FLOOR_OLD_LISTING_FROM=ANOMALY_NEW_LISTING_FROM/.test(a));
check('reason text',FLOOR_OLD_REASON===spec.reason);
check('rule registered in LANE_RULES',LANE_RULES.includes(applyFloorOldListingRule));
LANE_RULES.splice(1);// 本文件只测第 1 条（高于底价老品）；硬门槛在 lane-rules.test.js 测，组合效果见回放
const build=c=>{const pr=c.prices||Array(10).fill(10);return {queried:true,products:[...Array(10)].map((_,i)=>({asin:'FO'+i,price:pr[i],title:'Notebook 2 Pack 8.5 x 11 inch',monthlyPurchases:'100+',ratingCount:c.reviews??300,firstAvailableDate:c.dates[i]}))};};
const pass=m=>!!(m.priceFloor||m.anomalies.length||m.lowCompetition||m.youngMarket.length);
for(const c of spec.cases){const m=S(build(c),spec.floor,0,spec.anomalyPercent),e=c.expect;const ok=m.priceFloor===e.priceFloor&&!!m.floorOldExcluded===e.floorOld&&(e.unknown==null||(m.floorListingUnknown||0)===e.unknown)&&(e.young==null||!!m.youngMarket.length===e.young)&&(e.anomalies==null||m.anomalies.length===e.anomalies)&&(!e.top10||!!m.reviewExcluded)&&(e.qualifies==null||pass(m)===e.qualifies);check(c.name,ok,JSON.stringify({pf:m.priceFloor,fo:m.floorOldExcluded,unk:m.floorListingUnknown,y:m.youngMarket,top:m.reviewExcluded,a:m.anomalies.length}));if(e.floorOld)check(c.name+' → reason + latest day',m.floorOldExcluded===spec.reason&&(m.floorLatestListing||'')<spec.threshold);}
for(const [n,r] of [['empty',{queried:true,products:[]}],['short',{queried:true,products:[{asin:'X',price:9,firstAvailableDate:'2020-01-01'}]}],['unqueried',{queried:false,products:[]}],['no products key',{queried:true}]]){const m=S(r,5,0,50);check('edge '+n,!m.floorOldExcluded);}
{const calls=[];LANE_RULES.push((r,ps,ctx)=>calls.push(ctx));S(build({dates:Array(10).fill('2025-06-01')}),5,0,50);LANE_RULES.pop();check('LANE_RULES hook gets ctx',calls.length===1&&calls[0].floor===5&&calls[0].anomaly===50);}
// 不显示被排除的赛道、不显示计数（与老品规则一样）
{const q=fs.readFileSync(path.join(dir,'quality.js'),'utf8'),h=fs.readFileSync(path.join(dir,'index.html'),'utf8');check('no floor-old panel/count in UI',!/floorOld/.test(q+h)&&(a.match(/floorOldExcluded/g)||[]).length===1);}
{const i=a.indexOf('visibleRecordOps(record){'),body=a.slice(i,a.indexOf('});',i));check('visibleRecordOps unchanged (no floorOld)',i>=0&&!/floorOld/.test(body));}
if(fails){console.error(fails+' failing');process.exit(1);}console.log('floor-old ok');
