// node root-finder/tests/old-listing.test.js — 老品赛道排除（高价品全部早于 2026-01-01 上架）
const fs=require('fs'),path=require('path'),dir=path.join(__dirname,'..');
const a=fs.readFileSync(path.join(dir,'app.js'),'utf8');
const grab=n=>{const i=a.indexOf('function '+n+'(');if(i<0)throw Error('missing function '+n);let d=0;for(let k=a.indexOf('{',i);;k++){if(a[k]=='{')d++;if(a[k]=='}'&&--d==0)return a.slice(i,k+1);}};
const line=re=>{const m=a.match(re);if(!m)throw Error('missing '+re);return m[0];};
eval(fs.readFileSync(path.join(dir,'quality.js'),'utf8').split('\n').slice(0,6).join('\n')+';'+line(/const hasPrice=[^\n;]*;/)+grab('screeningRaw')+';'+line(/const REVIEW_LIMIT[^\n]*?;const oldListing=[^\n]*?;};/)+';'+line(/const ANOMALY_NEW_LISTING_FROM[^\n]*/)+';'+grab('reviewCount')+';'+grab('applyReviewRules')+';'+line(/const YOUNG_REVIEW_LIMIT[^\n]*/)+grab('beijingCutoff')+grab('listingDate')+grab('youngMarketReasons')+';globalThis.S=screeningRaw;Object.assign(globalThis,{ANOMALY_NEW_LISTING_FROM,ANOMALY_OLD_REASON,listingDay})');
const spec=JSON.parse(fs.readFileSync(path.join(__dirname,'old-listing-cases.json'),'utf8'));
let fails=0;const check=(name,ok,info)=>{if(!ok){fails++;console.error('FAIL',name,info||'');}else console.log('ok',name);};
check('threshold constant',ANOMALY_NEW_LISTING_FROM===spec.threshold,ANOMALY_NEW_LISTING_FROM);
check('reason text',ANOMALY_OLD_REASON===spec.reason,ANOMALY_OLD_REASON);
const build=c=>({queried:true,products:[...Array(10)].map((_,i)=>{const h=c.hi.indexOf(i);return {asin:'A'+i,price:h>=0?100:10,title:'Notebook 2 Pack 8.5 x 11 inch',monthlyPurchases:'100+',ratingCount:h>=0&&c.reviews?c.reviews[h]:300,firstAvailableDate:h>=0?c.dates[h]:(c.others||'2024-05-01')};})});
for(const c of spec.cases){const m=S(build(c),5,0,50),e=c.expect;const ok=m.anomalies.length===e.anomalies&&!!m.anomalyOldExcluded===e.old&&(e.unknown==null||(m.anomalyListingUnknown||0)===e.unknown)&&(e.priceFloor==null||m.priceFloor===e.priceFloor)&&(!e.review||!!m.anomalyReviewExcluded)&&(!e.top10||!!m.reviewExcluded);check(c.name,ok,JSON.stringify({a:m.anomalies.length,old:m.anomalyOldExcluded,unk:m.anomalyListingUnknown,rev:m.anomalyReviewExcluded,top:m.reviewExcluded,pf:m.priceFloor}));if(e.old)check(c.name+' → excluded reason',m.excludedAnomalies.length===c.hi.length&&m.excludedAnomalies.every(x=>x.reason===ANOMALY_OLD_REASON&&x.status==='excluded'));}
// pending anomalies are untouched (no monthlyPurchases → pending)
const pend=build({hi:[0],dates:['2020-01-01']});pend.products[0].monthlyPurchases=null;const pm=S(pend,5,0,50);check('pending untouched',pm.pendingAnomalies.length===1&&!pm.anomalyOldExcluded);
// empty / short / unqueried rows never crash or flag
for(const [n,r] of [['empty',{queried:true,products:[]}],['short',{queried:true,products:[{asin:'X',price:9,firstAvailableDate:'2020-01-01'}]}],['unqueried',{queried:false,products:[]}],['no products key',{queried:true}]]){const m=S(r,5,0,50);check('edge '+n,!m.anomalyOldExcluded&&!m.anomalies.length);}
check('listingDay null for boolean',listingDay(true)===null&&listingDay(undefined)===null&&listingDay(0)===null);
// FE/BE gate parity: rows in the 老品赛道 panel must be kept by the delete-guard visibility gate (BE curatable includes anomalyOldExcluded)
{const i=a.indexOf('visibleRecordOps(record){'),body=a.slice(i,a.indexOf('});',i));check('visibleRecordOps gate parity (keeps anomalyOldExcluded rows)',/m\.anomalyOldExcluded/.test(body));}
{const q=fs.readFileSync(path.join(dir,'quality.js'),'utf8'),i=q.indexOf('function renderOldListingExcluded(');check('panel offers delete button',i>=0&&/data-delete-row/.test(q.slice(i,q.indexOf('\n',i))));}
if(fails){console.error(fails+' failing');process.exit(1);}console.log('old-listing ok');
