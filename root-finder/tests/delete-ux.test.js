// node root-finder/tests/delete-ux.test.js
'use strict';
const fs=require('fs'),path=require('path');
const {parseHTML}=require('/tmp/ld/node_modules/linkedom');
const app=fs.readFileSync(path.join(__dirname,'..','app.js'),'utf8');
const quality=fs.readFileSync(path.join(__dirname,'..','quality.js'),'utf8');
const cloud=fs.readFileSync(path.join(__dirname,'..','cloud.js'),'utf8');
const index=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const be=path.join('/workspace/shot/rf-delete-fix/backend');
const server=fs.readFileSync(path.join(be,'server.py'),'utf8');
const lanes=fs.readFileSync(path.join(be,'lanes.py'),'utf8');
const jobq=fs.readFileSync(path.join(be,'job_queue.py'),'utf8');

global.window=global;
function assert(cond,msg){if(!cond)throw Error(msg||'assert');}
function eq(a,b,msg){if(JSON.stringify(a)!==JSON.stringify(b))throw Error((msg||'eq')+' '+JSON.stringify(a)+' !== '+JSON.stringify(b));}
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// --- FE/BE gate alignment ---
(function gateAlign(){
  assert(server.includes('def curatable'),'server curatable');
  assert(server.includes("result['pendingAnomalies']") && server.indexOf('def curatable') < server.indexOf("result['pendingAnomalies']"),'curatable includes pending');
  assert(lanes.includes('core.curatable'),'lanes uses curatable');
  assert(lanes.includes('含待核实'),'lanes message');
  assert(!lanes.match(/if not all\(core\.qualifies\(r,record\) for _,r in removed\)/),'lanes no longer qualifies-only for delete');
  assert(jobq.includes('core.curatable'),'job_queue uses curatable');
  // FE visibleRecordOps mirrors curatable fields
  assert(app.includes('m.pendingAnomalies.length'),'FE visible includes pending');
  assert(app.includes('m.youngMarket.length'),'FE visible includes young');
  assert(quality.includes('data-delete-row'),'pending panel delete');
  assert(app.includes('data-record-id="${esc(rowRecord(row).id)}"'),'result card delete attrs');
  assert(index.includes('delpend-2'),'cache bust delpend-2');
  console.log('ok FE/BE gate alignment');
})();

// --- DOM roundtrip ---
(function domRoundtrip(){
  const cases=[['rec1','banana'],['rec1','banana squishy'],['rec1','slushie squishy'],['rec1','a&b'],['rec1',"it's"],['rec1','  spaced  '.trim()]];
  for(const [id,kw] of cases){
    const key=JSON.stringify([id,kw]);
    const html=`<button data-delete-row data-record-id="${esc(id)}" data-keyword="${esc(kw)}" data-delete-key="${esc(key)}">删除</button>`;
    const {document}=parseHTML(html);
    const b=document.querySelector('[data-delete-row]');
    assert(b.dataset.recordId===id,'recordId '+kw);
    assert(b.dataset.keyword===kw,'keyword '+kw+' got '+JSON.stringify(b.dataset.keyword));
    assert(b.dataset.deleteKey===key,'deleteKey '+kw);
  }
  console.log('ok dom roundtrip');
})();

// --- findResultRow ---
(function findRows(){
  const resultKey=row=>JSON.stringify([row._source.id,row.keyword]);
  let current={id:'all-results',data:{opportunities:[
    {keyword:'banana squishy',_source:{id:'r1'}},
    {keyword:'slushie squishy',_source:{id:'r1'}},
    {keyword:'solo',_source:{id:'r2'}},
  ]}};
  function rowRecord(row){return row._source||current;}
  function findResultRow(recordId,keyword){return current.data.opportunities.find(r=>rowRecord(r).id===recordId&&r.keyword===keyword);}
  function rowsFromDeleteButton(b){
    const id=b.dataset.recordId,kw=b.dataset.keyword;
    if(id&&kw!=null&&kw!==''){const row=findResultRow(id,kw);return row?[row]:[];}
    const key=b.dataset.deleteKey||b.dataset.deleteKeyword;if(!key)return[];
    return current.data.opportunities.filter(r=>resultKey(r)===key);
  }
  const html=`<button data-delete-row data-record-id="${esc('r1')}" data-keyword="${esc('banana squishy')}" data-delete-key="${esc(JSON.stringify(['r1','banana squishy']))}">删除</button>`;
  const {document}=parseHTML(html);
  eq(rowsFromDeleteButton(document.querySelector('[data-delete-row]')).map(r=>r.keyword),['banana squishy'],'find');
  current.data.opportunities=[];
  eq(rowsFromDeleteButton(document.querySelector('[data-delete-row]')).map(r=>r.keyword),[],'empty list');
  console.log('ok find + empty');
})();

// --- optimistic / rollback / empty record drop ---
(function optimistic(){
  let snapshot={jobs:[],records:[{id:'r1',data:{opportunities:[{keyword:'banana squishy'},{keyword:'keep me'}]}}],activeJob:null,paused:false};
  function removeLocalKeywords(recordId,keywords){
    const set=new Set(keywords);
    snapshot={...snapshot,records:snapshot.records.map(rec=>{
      if(rec.id!==recordId)return rec;
      return {...rec,data:{...rec.data,opportunities:(rec.data.opportunities||[]).filter(r=>!set.has(r.keyword))}};
    }).filter(rec=>(rec.data.opportunities||[]).length>0)};
  }
  function patchSnapshotRecord(record){
    const i=snapshot.records.findIndex(r=>r.id===record.id);
    if(!(record.data.opportunities||[]).length){snapshot.records=snapshot.records.filter(r=>r.id!==record.id);return;}
    if(i<0){snapshot.records=[...snapshot.records,record];return;}
    const next=[...snapshot.records];next[i]=record;snapshot.records=next;
  }
  removeLocalKeywords('r1',['banana squishy']);
  eq(snapshot.records[0].data.opportunities.map(r=>r.keyword),['keep me'],'optimistic');
  patchSnapshotRecord({id:'r1',data:{opportunities:[{keyword:'keep me'}]}});
  eq(snapshot.records[0].data.opportunities.map(r=>r.keyword),['keep me'],'patch');
  // delete last remaining → record dropped
  removeLocalKeywords('r1',['keep me']);
  eq(snapshot.records,[],'empty record dropped');
  // rollback restore
  patchSnapshotRecord({id:'r1',data:{opportunities:[{keyword:'banana squishy'},{keyword:'keep me'}]}});
  eq(snapshot.records[0].data.opportunities.map(r=>r.keyword).sort(),['banana squishy','keep me'],'rollback');
  console.log('ok optimistic/rollback/empty');
})();

// --- per-key + global busy ---
(function perKey(){
  let busy=false,curationBusy=false,deletingKeys=new Set();
  function delBlocked(key){if(busy&&!window.RootFinderCloud?.enabled)return true;if(key!=null&&key!=='')return deletingKeys.has(key);return curationBusy||deletingKeys.size>0;}
  assert(!delBlocked('["r1","a"]'),'idle');
  deletingKeys.add('["r1","banana squishy"]');
  assert(delBlocked('["r1","banana squishy"]'),'self');
  assert(!delBlocked('["r1","slushie squishy"]'),'sibling free');
  assert(delBlocked(),'global blocked while any deleting (undo/bulk chrome)');
  deletingKeys.clear();
  curationBusy=true;
  assert(delBlocked(),'curationBusy');
  console.log('ok per-key + global');
})();

// --- poll strip ---
(function pollStrip(){
  const gone=new Set([JSON.stringify(['r1','banana squishy'])]);
  let state={records:[{id:'r1',data:{opportunities:[{keyword:'banana squishy'},{keyword:'keep'}]}}]};
  state={...state,records:state.records.map(rec=>({...rec,data:{...rec.data,opportunities:(rec.data.opportunities||[]).filter(r=>!gone.has(JSON.stringify([rec.id,r.keyword])))}})).filter(rec=>(rec.data.opportunities||[]).length>0)};
  eq(state.records[0].data.opportunities.map(r=>r.keyword),['keep'],'strip');
  assert(cloud.includes('gone.has(JSON.stringify([rec.id,r.keyword]))'),'cloud strip');
  assert(app.includes('keys.forEach(k=>deletingKeys.delete(k));if(window.RootFinderCloud)'),'clear before reload');
  assert(app.includes('部分已删除'),'partial undo toast');
  assert(app.includes('正在删除中，请稍候再撤销'),'undo while deleting msg');
  console.log('ok poll strip + polish copy');
})();

// --- double-click + concurrent ---
(async function doubleClick(){
  const deletingKeys=new Set();
  const calls=[];
  async function deleteResults(rows){
    rows=rows.filter(r=>!deletingKeys.has(JSON.stringify([r.id,r.keyword])));
    if(!rows.length){calls.push('skip');return;}
    rows.forEach(r=>deletingKeys.add(JSON.stringify([r.id,r.keyword])));
    calls.push('run:'+rows.map(r=>r.keyword).join(','));
  }
  await deleteResults([{id:'r1',keyword:'banana squishy'}]);
  await deleteResults([{id:'r1',keyword:'banana squishy'}]);
  eq(calls,['run:banana squishy','skip'],'double');
  deletingKeys.clear();calls.length=0;
  await Promise.all([deleteResults([{id:'r1',keyword:'a'}]),deleteResults([{id:'r1',keyword:'b'}])]);
  assert(calls.includes('run:a')&&calls.includes('run:b'),'concurrent '+calls);
  console.log('ok double-click + concurrent');
})().catch(e=>{console.error(e);process.exit(1);}).then(()=>{
  // key mismatch
  (function keyMismatch(){
    const resultKey=row=>JSON.stringify([row._source.id,row.keyword]);
    let current={data:{opportunities:[{keyword:'banana squishy',_source:{id:'r1'}}]}};
    function findResultRow(recordId,keyword){return current.data.opportunities.find(r=>(r._source||{}).id===recordId&&r.keyword===keyword);}
    function rowsFromDeleteButton(b){
      const id=b.dataset.recordId,kw=b.dataset.keyword;
      if(id&&kw!=null&&kw!==''){const row=findResultRow(id,kw);return row?[row]:[];}
      const key=b.dataset.deleteKey;if(!key)return[];
      return current.data.opportunities.filter(r=>resultKey(r)===key);
    }
    const html=`<button data-delete-row data-record-id="r1" data-keyword="${esc('banana squishy')}" data-delete-key="${esc(JSON.stringify(['OLD','wrong']))}">删除</button>`;
    const {document}=parseHTML(html);
    eq(rowsFromDeleteButton(document.querySelector('[data-delete-row]')).map(r=>r.keyword),['banana squishy'],'attrs win');
    console.log('ok key mismatch');
  })();
  console.log('delete-ux tests passed');
});
