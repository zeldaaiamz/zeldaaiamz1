// node root-finder/tests/above-floor-off.test.js — 关闭「高于底价」赛道（2026-11-19 Hongyan「那先把高于底价赛道关掉并上线」）：
// 新任务 aboveFloor=false → 底价按 null：不按高于底价入选、缺价格不进待人工；老任务（无字段）照旧；高价异常/新兴/低竞争不变；筛选/计数显示为已关闭。
const fs=require('fs'),path=require('path'),dir=path.join(__dirname,'..');
const a=fs.readFileSync(path.join(dir,'app.js'),'utf8'),h=fs.readFileSync(path.join(dir,'index.html'),'utf8'),c=fs.readFileSync(path.join(dir,'cloud.js'),'utf8');
const H=require('./_screening-harness.js')({laneRules:false}),S=H.S;
let fails=0;const check=(name,ok,info)=>{if(!ok){fails++;console.error('FAIL',name,info||'');}else console.log('ok',name);};
const grab=n=>{const i=a.indexOf('function '+n+'(');let d=0;for(let k=a.indexOf('{',i);;k++){if(a[k]=='{')d++;if(a[k]=='}'&&--d==0)return a.slice(i,k+1);}};
const screenFloor=new Function(grab('screenFloor')+';return screenFloor;')();
check('screenFloor off → null',screenFloor({floor:15,aboveFloor:false})===null);
check('screenFloor legacy → floor',screenFloor({floor:15})===15&&screenFloor({floor:15,aboveFloor:true})===15);
const build=(f=()=>({}))=>({queried:true,products:[...Array(10)].map((_,i)=>({asin:'A'+i,price:30,title:'t',monthlyPurchases:100,ratingCount:300,firstAvailableDate:i<5?'2026-03-01':'2023-01-01',...f(i)}))});
const sure=m=>m.priceFloor||m.anomalies.length||m.lowCompetition||m.youngMarket.length;
{const r=build();check('legacy floor-only passes',S(r,15,0,50).priceFloor);const m=S(r,null,0,50);check('off: floor-only not selected, not manual',!sure(m)&&!m.manualReview.length&&!m.pendingAnomalies.length,JSON.stringify(m));}
{const r=build(i=>i===3?{price:null}:{});check('legacy price_gap → 待人工',S(r,15,0,50).manualReview.some(x=>x.code==='price_gap'));const m=S(r,null,0,50);check('off: no price_gap',!m.manualReview.length&&!m.priceGapFloor,JSON.stringify(m.manualReview));}
{const r=build(i=>i===0?{price:100,ratingCount:50}:{});const x=S(r,null,0,50),y=S(r,15,0,50);check('anomaly unchanged',JSON.stringify(x.anomalies)===JSON.stringify(y.anomalies)&&(x.anomalies.length||x.pendingAnomalies.length));}
check('young unchanged',S(build(()=>({ratingCount:50})),null,0,50).youngMarket.length>0);
check('low competition unchanged',S({queried:true,products:build().products.slice(0,7)},null,0,50).lowCompetition);
check('rowMatch uses screenFloor',/function rowMatch\(row\)\{const r=rowRecord\(row\);return screening\(row,screenFloor\(r\),/.test(a));
check('visibleRecordOps uses screenFloor',/visibleRecordOps\(record\)\{[^}]*screening\(row,screenFloor\(record\),/.test(a));
check('_source carries aboveFloor (app.js + cloud.js)',/_source:\{[^}]*aboveFloor:record\.aboveFloor/.test(a)&&/_source:\{[^}]*aboveFloor:record\.aboveFloor/.test(c));
check('no screening(...record.floor / r.floor...) left',!/screening\(row,(record|r)\.floor/.test(a));
check('filter option shows closed',/<option value="price_floor">高于底价（已关闭，仅旧结果）<\/option>/.test(h));
check('chip label closed + hidden when 0',a.includes("return n||method==='price_floor'?[['price_floor','高于底价（已关闭·旧结果）',n]]:[];"));
check('script versions bumped',h.includes('app.js?v=abovefloor-off-1')&&h.includes('cloud.js?v=abovefloor-off-1'));
if(fails){console.error(fails+' failing');process.exit(1);}console.log('above-floor-off ok');
