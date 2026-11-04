// node root-finder/tests/sales-fill.test.js — 缺购买量补齐：规则与状态文案（FE 与 BE 同口径）
const fs=require('fs'),path=require('path');
const src=fs.readFileSync(path.join(__dirname,'..','quality.js'),'utf8');
globalThis.window={};globalThis.document={addEventListener(){}};globalThis.esc=s=>String(s);
eval(src.split('\n').slice(0,6).join('\n')+';globalThis.A=assessQuality;globalThis.M=SALES_MISSING;globalThis.N=SALES_NODATA');
eval(src.split('\n').slice(-8).join('\n')+';globalThis.S=salesState;globalThis.B=salesBar');
const ok=(n,c)=>{if(!c)throw Error(n);console.log('ok',n);};
const base=Array(9).fill(0).map(()=>({price:10,title:'t',monthlyPurchases:100}));
ok('missing field → pending',A([{price:60,title:'t'},...base],0,50).reason===M);
ok('salesUnknown → excluded SIF 无购买量',(r=>r.status==='excluded'&&r.reason===N)(A([{price:60,title:'t',salesUnknown:true},...base],0,50)));
ok('filled 0 → excluded <50',A([{price:60,title:'t',monthlyPurchases:0},...base],0,50).reason==='过去一个月购买量低于 50');
{const be=path.join(__dirname,'../../../shot/rf-salesfill/backend/sales_fill.py');if(fs.existsSync(be))ok('BE NODATA/MISSING text identical',fs.readFileSync(be,'utf8').includes(N)&&fs.readFileSync(be,'utf8').includes(M));}
window.RootFinderCloud={salesFill:{costPerAsin:2,counts:{queued:2,done:1,nodata:1},state:{paused:'waiting_quota',quotaRemaining:1},asins:{A1:{status:'queued',attempts:0},F1:{status:'failed',error:'boom'}}}};
ok('waiting quota text',S('A1').text.includes('等待额度')&&S('A1').text.includes('剩 1 点'));
ok('failed text',S('F1').key==='failed'&&S('F1').text.includes('boom'));
ok('unseen asin → scan',S('Z9').key==='scan');
window.RootFinderCloud.salesFill.state={};ok('queued text',S('A1').text.includes('排队中'));
ok('bar counts',B(3).includes('3 个关键词待补购买量')&&B(3).includes('SIF 无数据已排除 1'));
ok('no 再次查询 hint',!src.includes('再次查询该词可补齐')&&!src.includes('重新查询该词可补齐'));
console.log('sales fill ok');
