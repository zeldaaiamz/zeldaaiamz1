// node root-finder/tests/bulky-flag.test.js — 大件赛道排除 v2（2026-11-17）：前端只认后端下发的 row.bulky，不自己判、不显示词库/面板/计数
const fs=require('fs'),path=require('path'),dir=path.join(__dirname,'..');
const a=fs.readFileSync(path.join(dir,'app.js'),'utf8');
const H=require('./_screening-harness.js')({laneRules:false}),S=H.S;// 本文件只测大件标记（赛道级门槛在 lane-rules.test.js）
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
