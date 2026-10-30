// node root-finder/tests/ai-verify.test.js
const fs=require('fs'),path=require('path');
eval(fs.readFileSync(path.join(__dirname,'..','quality.js'),'utf8').split('\n').slice(0,6).join('\n')+';globalThis.A=assessQuality');
const mk=(price,ai,extra={})=>({price,title:'Cute Journal',monthlyPurchases:'100+',aiVerify:ai,...extra});
const ok=(n,c)=>{if(!c)throw Error(n);};
const nb=n=>({count:n,type:'notebook',spec:'a5',by:'title'});
// 1) AI pack count turns a "high" price into normal unit price -> excluded
let ps=[mk(60,nb(6)),...Array(9).fill(0).map(()=>mk(10,nb(1)))];let r=A(ps,0,50);
ok('excluded by ai',r.status==='excluded'&&r.reason.startsWith('豆包核实')&&r.comparableCount===9&&r.packQuantity===6);
// 2) still high -> confirmed
ps=[mk(60,nb(1)),...Array(9).fill(0).map(()=>mk(10,nb(1)))];r=A(ps,0,50);ok('confirmed by ai',r.status==='confirmed'&&r.aiVerified);
// 3) relax: different spec -> falls back to same type
ps=[mk(60,nb(1)),...Array(9).fill(0).map(()=>mk(10,{...nb(1),spec:'b5'}))];r=A(ps,0,50);ok('same type tier',r.status==='confirmed'&&r.reason.includes('同类9'));
// 4) other types -> top-10 average
ps=[mk(60,nb(1)),...Array(9).fill(0).map(()=>mk(10,{count:1,type:'pen',spec:''}))];r=A(ps,0,50);ok('top10 tier',r.reason.includes('前10其他商品'));
// 5) no AI yet -> stays pending; missing purchases stays pending
ps=[mk(60,undefined),...Array(9).fill(0).map(()=>mk(10,undefined))];ok('no ai pending',A(ps,0,50).status==='pending');
ps=[mk(60,nb(1),{monthlyPurchases:null}),...Array(9).fill(0).map(()=>mk(10,nb(1)))];ok('missing purchases',A(ps,0,50).reason==='缺少过去一个月购买量');
// 6) AI unsure (no count) -> pending with 豆包 reason
ps=[mk(60,{count:null,type:'',note:'看不出'}),...Array(9).fill(0).map(()=>mk(10,nb(1)))];r=A(ps,0,50);ok('ai unsure',r.status==='pending'&&r.reason.includes('豆包'));
// 7) title parser still wins when it works
ps=Array(10).fill(0).map((_,i)=>({price:i?10:100,title:'Notebook 2 Pack 8.5 x 11 inch',monthlyPurchases:'100+',aiVerify:nb(20)}));ok('parser first',A(ps,0,50).reason==='单位价格仍异常');
console.log('ai verify ok');
