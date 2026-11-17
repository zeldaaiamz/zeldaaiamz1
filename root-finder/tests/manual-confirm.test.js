// node root-finder/tests/manual-confirm.test.js — 待人工赛道「人工确认入库」（Hongyan 2026-11-17 20:28）。纯本地，不联网。
const fs=require('fs'),path=require('path'),dir=path.join(__dirname,'..');
const a=fs.readFileSync(path.join(dir,'app.js'),'utf8'),q=fs.readFileSync(path.join(dir,'quality.js'),'utf8'),h=fs.readFileSync(path.join(dir,'index.html'),'utf8');
const BE=process.env.RF_BACKEND||'/workspace/rf-abovefloor/backend',lanesPy=fs.existsSync(path.join(BE,'lanes.py'))?fs.readFileSync(path.join(BE,'lanes.py'),'utf8'):null;   // 后端不在本机时跳过对照项
let fails=0;const check=(n,ok,info='')=>{console.log((ok?'ok ':'FAIL ')+n,ok?'':info);if(!ok)fails++;};
const grab=(src,n)=>{const i=src.search(new RegExp('(async )?function '+n+'\\('));if(i<0)throw Error('missing '+n);let d=0;for(let k=src.indexOf('{',i);;k++){if(src[k]=='{')d++;if(src[k]=='}'&&--d==0)return src.slice(i,k+1);}};
// 1) 面板：按钮（带来源任务 id + 关键词），已入库的不再显示，忙时禁用
check('panel button data-manual-save with record id + keyword',/data-manual-save data-record-id="\$\{esc\(rowRecord\(r\)\.id\)\}" data-keyword="\$\{esc\(r\.keyword\)\}"/.test(q));
check('panel button text 人工确认入库',/>人工确认入库<\/button>/.test(q));
check('panel hides saved lanes',/filter\(r=>rowReview\(r\)&&!isSavedLane\(r\)\)/.test(q));
check('button disabled while busy / library not loaded',/manualSaveBlocked\(\)\?'disabled':''/.test(q)&&/function manualSaveBlocked\(\)\{return busy\|\|curationBusy\|\|!libraryLoaded;\}/.test(a));
check('click handler bound in pending panel',/closest\('\[data-manual-save\]'\)/.test(q)&&/manualSaveLane\(/.test(q));
check('setBusy also toggles manual buttons',/\[data-manual-save\]'\)\.forEach\(b=>b\.disabled=manualSaveBlocked\(\)\)/.test(a));
// 2) manualSaveLane：发 manual:true，只发这一条；连点只发一次；成功刷新赛道库；没入库时报错
async function run(out,opts={}){const calls=[],notes=[],errs=[];let refreshed=0,rendered=0;
 const env={busy:false,curationBusy:false,libraryLoaded:true,current:{},api:async(p,b)=>{calls.push([p,b]);if(opts.fail)throw Error('boom');await new Promise(r=>setTimeout(r,5));return out;},refreshSavedLanes:async()=>{refreshed++;},renderCards:()=>{rendered++;},curationNotice:t=>notes.push(t),showError:t=>t&&errs.push(t)};
 const src='let busy=env.busy,curationBusy=env.curationBusy,libraryLoaded=env.libraryLoaded,current=env.current;const {api,refreshSavedLanes,renderCards,curationNotice,showError}=env;'+grab(a,'manualSaveBlocked')+grab(a,'manualSaveLane')+'return manualSaveLane;';
 const f=new Function('env',src)(env);await Promise.all([f('rec-1','  spaced  Key ','零商品'),f('rec-1','  spaced  Key ','零商品')]);return {calls,notes,errs,refreshed,rendered};}
(async()=>{
 let r=await run({added:1,updated:0,skipped:0});
 check('posts /api/lanes/save manual:true for exactly one keyword (spaces kept)',r.calls.length===1&&r.calls[0][0]==='/api/lanes/save'&&JSON.stringify(r.calls[0][1])==JSON.stringify({recordId:'rec-1',keywords:['  spaced  Key '],manual:true}),JSON.stringify(r.calls));
 check('double click → one request',r.calls.length===1);
 check('refreshes library + notice mentions 人工确认 and reason',r.refreshed===1&&/已人工确认入库/.test(r.notes[0]||'')&&/零商品/.test(r.notes[0]||''),r.notes);
 r=await run({added:0,updated:0,skipped:1});
 check('not saved → error, no success notice',r.errs.some(e=>/未入库/.test(e))&&!r.notes.some(n=>/已人工确认入库/.test(n)),JSON.stringify(r));
 r=await run(null,{fail:true});
 check('request fails → error shown, busy released',r.errs.some(e=>/boom/.test(e))&&r.rendered>=1,JSON.stringify(r));
 // 3) 前后端同口径：后端认 manual is True；前端发 manual:true
 if(lanesPy===null)console.log('skip backend parity (RF_BACKEND not found)');else check('backend accepts only manual is True',/body\.get\('manual'\) is True/.test(lanesPy)&&/manual_confirmable\(row,record\)/.test(lanesPy));
 check('notice no longer says 待人工 不会入库',/人工确认入库/.test(h)&&!/不计入入选，也不会入库/.test(h));
 if(fails){console.error(fails+' failing');process.exit(1);}console.log('manual confirm ok');})();
