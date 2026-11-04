// node root-finder/tests/delete-reappear.test.js — real app.js delete code, stubbed API with controllable timing.
'use strict';
const fs=require('fs'),path=require('path');
const app=fs.readFileSync(path.join(__dirname,'..','app.js'),'utf8');
const cloud=fs.readFileSync(path.join(__dirname,'..','cloud.js'),'utf8');
function grab(start){const s=app.indexOf(start);if(s<0)throw Error('missing '+start);return app.slice(s,app.indexOf('\n',s));}
function grabUntil(start,end){const s=app.indexOf(start);return app.slice(s,app.indexOf(end,s));}
const src=[grabUntil('const deleteTombs=','function delBlocked'),grab('function attachResultSource'),grab('function rebuildCurrentFromSnapshot'),grab('function patchSnapshotRecord'),grab('function removeLocalKeywords'),grabUntil('async function deleteResults','\nlist.addEventListener')].join('\n');
assert(cloud.includes('window.rfDeleteGuard.next()')&&cloud.indexOf('rfDeleteGuard.next()')<cloud.indexOf("api('/api/jobs/state')"),'poll seq taken before fetch');
function assert(c,m){if(!c)throw Error(m);}
const eq=(a,b,m)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw Error(m+' '+JSON.stringify(a)+' !== '+JSON.stringify(b));};
function world(){
  const server={records:[{id:'r1',data:{keywordRoot:'squishy',opportunities:['a','b','c','d'].map(k=>({keyword:k}))}},{id:'r2',data:{keywordRoot:'toy',opportunities:[{keyword:'x'}]}}]};
  const clone=o=>JSON.parse(JSON.stringify(o));const pending=[];let fail=new Set();const log={errors:[],notices:[]};
  const deferred=()=>{let r;const p=new Promise(x=>r=x);return {p,r};};
  const env={window:{},busy:false,current:null,curationBusy:false,deletingKeys:new Set(),selectedResults:new Set(),
    renderCards(){},showError(m){if(m)log.errors.push(m);},curationNotice(m){log.notices.push(m);},visibleRecordOps:r=>r.data.opportunities,
    resultKey:r=>JSON.stringify([r._source.id,r.keyword]),rowRecord:r=>r._source,
    async api(url,body){const d=deferred();pending.push({url,body,d});await d.p;
      if(url==='/api/jobs/state')return d.snap;
      if(fail.has(body.keywords[0]))throw Error('网络错误');
      const rec=server.records.find(r=>r.id===body.recordId);rec.data.opportunities=rec.data.opportunities.filter(r=>!body.keywords.includes(r.keyword));
      return {deleted:body.keywords.length,undoId:'u'+body.keywords[0],record:clone(rec)};}};
  env.window.RootFinderCloud={enabled:true,snapshot:clone(server),async poll(){const seq=env.window.rfDeleteGuard.next();const st=await env.api('/api/jobs/state');this.snapshot=env.window.rfDeleteGuard.apply(st,seq);env.rebuild();}};
  env.reloadResults=()=>{const p=env.window.RootFinderCloud.poll();resolve('/api/jobs/state');return p;};
  const f=new Function('env','with(env){'+src+';env.deleteResults=deleteResults;env.rebuild=rebuildCurrentFromSnapshot;rebuildCurrentFromSnapshot();env.cur=()=>current;}');f(env);
  // resolve oldest pending call matching url; jobs/state returns server snapshot taken NOW (at resolve time = server-side read)
  function resolve(url){const i=pending.findIndex(x=>x.url===url&&(!x.read));const x=pending[i];pending.splice(i,1);if(url==='/api/jobs/state')x.d.snap=x.d.snap||clone(server);x.d.r();return new Promise(r=>setImmediate(r));}
  function readPoll(){const x=pending.find(x=>x.url==='/api/jobs/state'&&!x.d.snap);x.d.snap=clone(server);} // server reads state now, response delivered later
  const shown=()=>env.cur().data.opportunities.map(r=>r.keyword);const row=k=>env.cur().data.opportunities.find(r=>r.keyword===k);
  return {env,server,resolve,readPoll,shown,row,log,fail,pending};
}
(async()=>{
  // 1) Rapid multi-delete in the same task: A's response (taken before B commits) must not resurrect B.
  {const w=world();const pa=w.env.deleteResults([w.row('a')]);const pb=w.env.deleteResults([w.row('b')]);
   eq(w.shown(),['c','d','x'],'optimistic');
   await w.resolve('/api/results/bulk-delete'); // A commits, response record still has b (b not committed yet)
   eq(w.shown(),['c','d','x'],'b must stay hidden after A response');
   await w.resolve('/api/results/bulk-delete');await pa;await pb;eq(w.shown(),['c','d','x'],'after both');console.log('ok rapid multi-delete same task');}
  // 2) Stale poll: poll reads server BEFORE delete commits, response arrives AFTER delete finished.
  {const w=world();const pp=w.env.window.RootFinderCloud.poll();w.readPoll();const pd=w.env.deleteResults([w.row('a')]);
   await w.resolve('/api/results/bulk-delete');await pd;eq(w.shown(),['b','c','d','x'],'deleted');
   await w.resolve('/api/jobs/state');await pp;eq(w.shown(),['b','c','d','x'],'stale poll must not resurrect a');
   const p2=w.env.window.RootFinderCloud.poll();await w.resolve('/api/jobs/state');await p2;eq(w.shown(),['b','c','d','x'],'fresh poll');console.log('ok stale poll after delete');}
  // 3) Poll during in-flight delete (refresh during delete).
  {const w=world();const pd=w.env.deleteResults([w.row('c')]);const pp=w.env.window.RootFinderCloud.poll();await w.resolve('/api/jobs/state');await pp;
   eq(w.shown(),['a','b','d','x'],'hidden while in flight');await w.resolve('/api/results/bulk-delete');await pd;eq(w.shown(),['a','b','d','x'],'after');console.log('ok poll during delete');}
  // 4) Failure restores only the failed row, others stay deleted, clear message.
  {const w=world();w.fail.add('b');const pa=w.env.deleteResults([w.row('a')]);const pb=w.env.deleteResults([w.row('b')]);
   await w.resolve('/api/results/bulk-delete');await w.resolve('/api/results/bulk-delete');await new Promise(r=>setImmediate(r));await pa;await pb;
   eq(w.shown(),['b','c','d','x'],'b restored, a stays gone');assert(w.log.errors.some(m=>m.includes('1 条赛道删除失败，已恢复显示')&&m.includes('网络错误')),'msg '+w.log.errors);console.log('ok failure restore');}
  // 5) Multi-task bulk delete with cross-task rows.
  {const w=world();const p=w.env.deleteResults([w.row('a'),w.row('x')]);await w.resolve('/api/results/bulk-delete');eq(w.shown(),['b','c','d'],'mid');await w.resolve('/api/results/bulk-delete');await p;eq(w.shown(),['b','c','d'],'cross task');console.log('ok cross-task bulk');}
  console.log('ALL PASS delete-reappear');
})().catch(e=>{console.error(e);process.exit(1);});
