// node root-finder/tests/delete-ux.test.js
'use strict';
const fs=require('fs'),path=require('path');
const {parseHTML}=require('/tmp/ld/node_modules/linkedom');
const app=fs.readFileSync(path.join(__dirname,'..','app.js'),'utf8');
const quality=fs.readFileSync(path.join(__dirname,'..','quality.js'),'utf8');
const cloud=fs.readFileSync(path.join(__dirname,'..','cloud.js'),'utf8');

global.window=global;
function assert(cond,msg){if(!cond)throw Error(msg||'assert');}
function eq(a,b,msg){if(JSON.stringify(a)!==JSON.stringify(b))throw Error((msg||'eq')+' '+JSON.stringify(a)+' !== '+JSON.stringify(b));}
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// --- 1) DOM roundtrip for multi-word / special keys ---
(function domRoundtrip(){
  const cases=[['rec1','banana'],['rec1','banana squishy'],['rec1','slushie squishy'],['rec1','a&b'],['rec1',"it's"]];
  for(const [id,kw] of cases){
    const key=JSON.stringify([id,kw]);
    const html=`<button data-delete-row data-record-id="${esc(id)}" data-keyword="${esc(kw)}" data-delete-key="${esc(key)}">删除</button>`;
    const {document}=parseHTML(html);
    const b=document.querySelector('[data-delete-row]');
    assert(b.dataset.recordId===id,'recordId '+kw);
    assert(b.dataset.keyword===kw,'keyword '+kw+' got '+JSON.stringify(b.dataset.keyword));
    assert(b.dataset.deleteKey===key,'deleteKey '+kw);
  }
  console.log('ok dom roundtrip multi-word');
})();

// --- 2) findResultRow / rowsFromDeleteButton ---
(function findRows(){
  const resultKey=row=>JSON.stringify([row._source.id,row.keyword]);
  let current={id:'all-results',data:{opportunities:[
    {keyword:'banana squishy',_source:{id:'r1'}},
    {keyword:'slushie squishy',_source:{id:'r1'}},
    {keyword:'solo',_source:{id:'r2'}},
  ]}};
  function rowRecord(row){return row._source||current;}
  function findResultRow(recordId,keyword){const rows=(current&&current.data&&current.data.opportunities)||[];return rows.find(r=>rowRecord(r).id===recordId&&r.keyword===keyword);}
  function rowsFromDeleteButton(b){
    const id=b.dataset.recordId,kw=b.dataset.keyword;
    if(id&&kw!=null&&kw!==''){const row=findResultRow(id,kw);return row?[row]:[];}
    const key=b.dataset.deleteKey||b.dataset.deleteKeyword;if(!key)return[];
    return ((current&&current.data&&current.data.opportunities)||[]).filter(r=>resultKey(r)===key);
  }
  const html=`<button data-delete-row data-record-id="${esc('r1')}" data-keyword="${esc('banana squishy')}" data-delete-key="${esc(JSON.stringify(['r1','banana squishy']))}">删除</button>`;
  const {document}=parseHTML(html);
  eq(rowsFromDeleteButton(document.querySelector('[data-delete-row]')).map(r=>r.keyword),['banana squishy'],'find banana');
  current.data.opportunities=current.data.opportunities.filter(r=>r.keyword!=='banana squishy');
  eq(rowsFromDeleteButton(document.querySelector('[data-delete-row]')).map(r=>r.keyword),[],'gone');
  console.log('ok findResultRow multi-word');
})();

// --- 3) Optimistic removeLocalKeywords logic (inline mirror of app.js) ---
(function optimistic(){
  // Mirror removeLocalKeywords + rebuildCurrentFromSnapshot filtering
  let snapshot={jobs:[],records:[{id:'r1',floor:20,trafficFloor:0,anomalyPercent:50,createdAt:'t',market:'US',data:{keywordRoot:'squishy',opportunities:[{keyword:'banana squishy'},{keyword:'keep me'}]}}],activeJob:null,paused:false};
  function removeLocalKeywords(recordId,keywords){
    const set=new Set(keywords);
    snapshot={...snapshot,records:snapshot.records.map(rec=>{
      if(rec.id!==recordId)return rec;
      return {...rec,data:{...rec.data,opportunities:(rec.data.opportunities||[]).filter(r=>!set.has(r.keyword))}};
    }).filter(rec=>(rec.data.opportunities||[]).length>0)};
  }
  function patchSnapshotRecord(record){
    const i=snapshot.records.findIndex(r=>r.id===record.id);
    if(i<0){if((record.data.opportunities||[]).length)snapshot.records=[...snapshot.records,record];return;}
    if(!(record.data.opportunities||[]).length){snapshot.records=snapshot.records.filter(r=>r.id!==record.id);return;}
    const next=[...snapshot.records];next[i]=record;snapshot.records=next;
  }
  removeLocalKeywords('r1',['banana squishy']);
  eq(snapshot.records[0].data.opportunities.map(r=>r.keyword),['keep me'],'optimistic remove');
  // API returns record without banana — UI stays deleted
  patchSnapshotRecord({id:'r1',floor:20,trafficFloor:0,anomalyPercent:50,createdAt:'t',market:'US',data:{keywordRoot:'squishy',opportunities:[{keyword:'keep me'}]}});
  eq(snapshot.records[0].data.opportunities.map(r=>r.keyword),['keep me'],'patch ok');
  // API failure rollback: re-add via full record restore
  patchSnapshotRecord({id:'r1',floor:20,trafficFloor:0,anomalyPercent:50,createdAt:'t',market:'US',data:{keywordRoot:'squishy',opportunities:[{keyword:'banana squishy'},{keyword:'keep me'}]}});
  eq(snapshot.records[0].data.opportunities.map(r=>r.keyword).sort(),['banana squishy','keep me'],'rollback restore');
  console.log('ok optimistic + patch + rollback');
})();

// --- 4) deletingKeys blocks only that key ---
(function perKey(){
  let busy=false,curationBusy=false,deletingKeys=new Set();
  function delBlocked(key){return busy||curationBusy||(key?deletingKeys.has(key):false);}
  assert(!delBlocked('["r1","a"]'),'idle');
  deletingKeys.add('["r1","banana squishy"]');
  assert(delBlocked('["r1","banana squishy"]'),'self blocked');
  assert(!delBlocked('["r1","slushie squishy"]'),'sibling free');
  assert(!delBlocked(),'global free during per-key delete');
  curationBusy=true;
  assert(delBlocked(),'global busy for undo/save');
  console.log('ok per-key busy');
})();

// --- 5) poll strips in-flight deletes ---
(function pollStrip(){
  const gone=new Set([JSON.stringify(['r1','banana squishy'])]);
  let state={records:[{id:'r1',data:{opportunities:[{keyword:'banana squishy'},{keyword:'keep'}]}}]};
  state={...state,records:state.records.map(rec=>({...rec,data:{...rec.data,opportunities:(rec.data.opportunities||[]).filter(r=>!gone.has(JSON.stringify([rec.id,r.keyword])))}})).filter(rec=>(rec.data.opportunities||[]).length>0)};
  eq(state.records[0].data.opportunities.map(r=>r.keyword),['keep'],'poll strip');
  assert(cloud.includes('gone.has(JSON.stringify([rec.id,r.keyword]))'),'cloud.js has strip');
  assert(app.includes('RootFinderCloud.deletingKeys=deletingKeys'),'app syncs deletingKeys to cloud');
  assert(app.includes('keys.forEach(k=>deletingKeys.delete(k));if(window.RootFinderCloud)'),'clear keys before reload on failure');
  console.log('ok poll strip in-flight');
})();

// --- 6) quality pending template has delete-row ---
(function qualityTpl(){
  assert(quality.includes('data-delete-row'),'quality has delete');
  assert(quality.includes('qualityPendingList'),'pending list');
  assert(app.includes('data-record-id="${esc(rowRecord(row).id)}"'),'app result card attrs');
  assert(app.includes('data-keyword="${esc(row.keyword)}"'),'app keyword attr');
  assert(app.includes('function rowsFromDeleteButton'),'rowsFromDeleteButton');
  console.log('ok quality pending delete UI');
})();

// --- 7) double-click: second call filtered by deletingKeys ---
(async function doubleClick(){
  const deletingKeys=new Set();
  const calls=[];
  async function deleteResults(rows){
    rows=rows.filter(r=>!deletingKeys.has(JSON.stringify([r.id,r.keyword])));
    if(!rows.length){calls.push('skip');return;}
    rows.forEach(r=>deletingKeys.add(JSON.stringify([r.id,r.keyword])));
    calls.push('run:'+rows.map(r=>r.keyword).join(','));
  }
  const row={id:'r1',keyword:'banana squishy'};
  await deleteResults([row]);
  await deleteResults([row]);
  eq(calls,['run:banana squishy','skip'],'double click');
  // concurrent different keys both run
  deletingKeys.clear();calls.length=0;
  await Promise.all([deleteResults([{id:'r1',keyword:'a'}]),deleteResults([{id:'r1',keyword:'b'}])]);
  assert(calls.includes('run:a')&&calls.includes('run:b'),'concurrent siblings '+calls);
  console.log('ok double-click + concurrent');
})().catch(e=>{console.error(e);process.exit(1);}).then(()=>{
  // --- 8) key mismatch: dataset keyword wins over stale delete-key ---
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
    // Stale delete-key but correct record-id/keyword attrs
    const html=`<button data-delete-row data-record-id="r1" data-keyword="${esc('banana squishy')}" data-delete-key="${esc(JSON.stringify(['OLD','wrong']))}">删除</button>`;
    const {document}=parseHTML(html);
    eq(rowsFromDeleteButton(document.querySelector('[data-delete-row]')).map(r=>r.keyword),['banana squishy'],'attrs beat stale key');
    console.log('ok key mismatch prefers attrs');
  })();
  console.log('delete-ux tests passed');
});
