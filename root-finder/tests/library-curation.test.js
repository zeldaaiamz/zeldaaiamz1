// node root-finder/tests/library-curation.test.js — 2026-11-04: only ticked rows go to 赛道库; module 3 removed; loading state.
const fs=require('fs'),path=require('path'),R=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const a=R('app.js'),c=R('cloud.js'),h=R('index.html');
const assert=(x,m)=>{if(!x)throw Error(m);};
for(const [n,s] of [['index.html',h],['app.js',a],['cloud.js',c]])for(const bad of ['补充包含匹配','expandForm','/api/expand','asin_contains'])assert(!s.includes(bad),`${n} still has ${bad}`);
console.log('ok module 3 removed');
assert(/id="saveLanes"[^>]*disabled/.test(h)&&h.includes('保存所选到赛道库（0）'),'save button default disabled');
assert(h.includes('id="resultsLoading"')&&h.includes('id="resultsRetry"'),'loading markup');
assert(!a.includes('保存全部任务'),'old save-all wording');
const grab=n=>{const i=a.indexOf('function '+n+'(');if(i<0)throw Error('missing '+n);let d=0;for(let k=a.indexOf('{',i);;k++){if(a[k]=='{')d++;if(a[k]=='}'&&--d==0)return a.slice(i,k+1);}};
// behavioural: build save payload from selection
const A={id:'recA'},B={id:'recB'};
const rows=[{keyword:'k1',_source:A},{keyword:'k2',_source:A},{keyword:'k3',_source:B},{keyword:'k4',_source:B,saved:true},{keyword:'k5',_source:B}];
let selectedResults=new Set(['k1','k3','k4']);const resultKey=r=>r.keyword,isSavedLane=r=>!!r.saved,visibleResultRows=()=>rows,rowRecord=r=>r._source;
eval(grab('selectedLaneGroups'));
const g=selectedLaneGroups();
assert(JSON.stringify([...g])===JSON.stringify([['recA',['k1']],['recB',['k3']]]),'payload '+JSON.stringify([...g]));
selectedResults=new Set();assert(selectedLaneGroups().size===0,'empty selection -> nothing');
console.log('ok only selected rows are sent');
// save handler must send keywords and never fall back to whole record
const hs=a.slice(a.indexOf("$('#saveLanes').addEventListener"));
assert(hs.includes("api('/api/lanes/save',{recordId,keywords})")&&hs.includes('if(!groups.size)'),'handler payload');
// loading state: parallel init + done/failed hooks
assert(c.includes('Promise.all([refreshSavedLanes(),this.poll(true)])'),'parallel init');
assert(c.includes("this.loading('done')")&&c.includes("this.loading('failed'"),'loading hooks');
// loading() behaviour with fake DOM
const els={};const $=s=>els[s]||(els[s]={hidden:true,textContent:'',classList:{v:new Set(),toggle(k,on){on?this.v.add(k):this.v.delete(k);}}});
const src=c.slice(c.indexOf('  loading(mode,msg)'));const body=src.slice(0,src.indexOf('\n'));
const obj=eval('({'+body.trim().replace(/,$/,'')+'})');obj.poll=()=>{obj.polled=1};
obj.loading('start');assert(!$('#resultsLoading').hidden&&$('#resultsRetry').hidden&&$('#resultsLoadingText').textContent.includes('正在加载'),'start');
obj.loading('failed','HTTP 502');assert($('#resultsLoading').classList.v.has('failed')&&!$('#resultsRetry').hidden&&$('#resultsLoadingText').textContent.includes('HTTP 502'),'failed');
obj.snapshot={};$('#resultsRetry').onclick();assert(obj.polled&&!$('#resultsLoading').classList.v.has('failed'),'retry');
obj.loading('done');assert($('#resultsLoading').hidden,'done');clearInterval(obj.loadTimer);
console.log('ok loading state');console.log('library-curation tests passed');
