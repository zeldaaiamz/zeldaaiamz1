/* P0/P1 workflow model: pure, testable, additive to the legacy board. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.BoardWorkflow=api;})(typeof window!=='undefined'?window:null,function(){
  'use strict';
  const copy=x=>x==null?x:JSON.parse(JSON.stringify(x));
  const list=x=>Array.isArray(x)?x:[];
  const esc=x=>String(x==null?'':x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const labels={unassessed:'旅程待定',awareness:'看到',interest:'兴趣',question:'疑问',desire:'向往'};
  function empty(asin){return {schemaVersion:1,asin:asin||'',taskId:'',evidenceRegistry:{},concerns:[],productFacts:[],needFactLinks:[],planRows:[],journeyMapping:{status:'pending',bySlot:{},revision:1},sourceSummary:{linkedReviews:0,annotatedReviews:0},nextVNumber:1,nextFNumber:1};}
  function migrate(s){
    s.schemaVersion=4;s.boxes=s.boxes&&typeof s.boxes==='object'?s.boxes:{};
    const w=s.workflowSnapshot;
    if(!w||typeof w!=='object'||String(w.asin||'').toUpperCase()!==String(s.asin||'').toUpperCase())s.workflowSnapshot=empty(s.asin);
    else{
      for(const k of ['concerns','productFacts','needFactLinks','planRows'])w[k]=list(w[k]);
      w.evidenceRegistry=w.evidenceRegistry&&typeof w.evidenceRegistry==='object'?w.evidenceRegistry:{};
      w.journeyMapping=w.journeyMapping||{status:'pending',bySlot:{},revision:1};w.journeyMapping.bySlot=w.journeyMapping.bySlot||{};
    }
    for(const b of Object.values(s.boxes)){
      if(!b||typeof b!=='object')continue;
      if(!Array.isArray(b.needs))b.needs=[];
      if(!b.matchStatus)b.matchStatus='unassessed';
      if(!b.matchDetails)b.matchDetails={matched:[],missingNeedIds:[],reasons:[]};
      if(!Array.isArray(b.reshootList))b.reshootList=[];
      if(b.chatgptPack===undefined)b.chatgptPack=null;
    }return s;
  }
  function eligible(v,w){
    const refs=list(v.evidenceIds).map(id=>(w.evidenceRegistry||{})[id]);
    const f=v.frequency||{};
    return refs.length>0&&refs.every(e=>e&&e.originalQuote&&e.sourceAsin===w.asin&&e.taskId===w.taskId&&e.reviewId&&e.rawSha256&&e.verification&&e.verification.status==='verified')&&Number(f.count)>0&&Number(f.denominator)>=Number(f.count)&&new Set(refs.map(e=>e.reviewId)).size===Number(f.count);
  }
  function top(s){const w=s.workflowSnapshot||empty(s.asin);return list(w.concerns).filter(x=>!x.archived&&eligible(x,w)).slice().sort((a,b)=>(a.priorityRank||999)-(b.priorityRank||999)).slice(0,5);}
  function merge(s,payload){
    const incoming=copy(payload&&payload.workflowSnapshot);if(!incoming)return migrate(s);
    if(incoming.asin!==s.asin)return migrate(s);
    const old=s.workflowSnapshot;
    if(old&&old.asin===incoming.asin){
      for(const [k,counter,prefix] of [['concerns','nextVNumber','V'],['productFacts','nextFNumber','F']]){
        const prior=new Map(list(old[k]).map(x=>[x.id,x]));let next=Math.max(Number(old[counter])||1,...list(old[k]).map(x=>(Number(String(x.code).slice(1))||0)+1));
        for(const row of list(incoming[k])){
          const a=prior.get(row.id);
          if(a){row.code=a.code;if(k==='productFacts'){row.verification=copy(a.verification);row.value=a.value;row.unit=a.unit;row.revision=a.revision;row.productRevision=a.productRevision||row.productRevision;row.sourceRefs=[...list(a.sourceRefs),...list(row.sourceRefs)].filter((x,i,all)=>all.findIndex(y=>JSON.stringify(y)===JSON.stringify(x))===i);row.allowedClaims=copy(a.allowedClaims||[]);}}
          else row.code=prefix+String(next++).padStart(2,'0');
        }
        for(const row of prior.values())if(!list(incoming[k]).some(x=>x.id===row.id))incoming[k].push({...copy(row),archived:true});
        incoming[counter]=next;
      }
      incoming.journeyMapping=copy(old.journeyMapping||incoming.journeyMapping);
      if(old.sourceSummary&&incoming.sourceSummary&&old.sourceSummary.sourceSha256!==incoming.sourceSummary.sourceSha256){
        for(const box of Object.values(s.boxes||{})){box.matchStatus='stale';if(box.chatgptPack)box.chatgptPack.status='stale';}
      }
    }
    s.workflowSnapshot=incoming;return migrate(s);
  }
  function snapshot(s){migrate(s);return {...copy(s.workflowSnapshot),schemaVersion:1,boxState:copy(s.boxes),preview:copy(s.preview||[]),sevenImagePlan:copy(s.sevenImagePlan||[]),sevenThemeChat:copy(s.sevenThemeChat||{})};}
  function rows(s){const w=s.workflowSnapshot||empty(s.asin);return list(w.planRows).map(x=>{
    const gold=list(s.sevenImagePlan).find(r=>r.imageIndex===x.imageIndex);
    const current=gold?JSON.stringify([gold.focusDisplay??null,gold.primaryTheme??null,gold.secondaryThemes||[],gold.vocEvidence??null,gold.visualNotes??null]):null;
    return {...copy(x),needsAuthorReview:!!(x.sourceContentKey&&current&&x.sourceContentKey!==current),journeyStage:w.journeyMapping&&w.journeyMapping.bySlot[x.slotId]||x.journeyStage||'unassessed'};
  });}
  function setStage(s,slot,stage){migrate(s);if(!Object.hasOwn(labels,stage))return false;
    const m=s.workflowSnapshot.journeyMapping;m.bySlot[slot]=stage;m.status='draft';m.revision=(m.revision||0)+1;
    for(const b of Object.values(s.boxes)){if(b.chatgptPack)b.chatgptPack.status='stale';}
    return true;
  }
  function linkStatus(l,w){
    const v=list(w.concerns).find(x=>x.id===l.concernId);if(!v||!eligible(v,w))return 'unverified';
    const facts=list(l.factIds).map(id=>list(w.productFacts).find(x=>x.id===id));
    if(!facts.length||!facts.every(f=>f&&f.asin===w.asin&&f.value!=null&&f.verification&&f.verification.status==='verified'&&f.verification.verifiedBy&&list(f.verification.evidenceRefs).length))return 'unverified';
    const q=l.requirement||{};const f=facts.find(x=>x.property===q.property);
    if(!f||q.expected==null||String(f.unit||'')!==String(q.unit||''))return 'unverified';
    let yes;
    if(q.op==='eq')yes=f.value===q.expected;
    else if(q.op==='gte'&&typeof f.value==='number'&&typeof q.expected==='number')yes=f.value>=q.expected;
    else if(q.op==='lte'&&typeof f.value==='number'&&typeof q.expected==='number')yes=f.value<=q.expected;
    else if(q.op==='includes')yes=String(f.value).includes(String(q.expected));
    else return 'unverified';
    return yes?'verified_satisfied':'not_satisfied';
  }
  function checks(s){
    const w=s.workflowSnapshot||empty(s.asin),rs=rows(s),out=[];
    const add=(ruleId,status,reason,slotIds=[],severity='warning')=>out.push({ruleId,ruleVersion:'p1-1',status,reason,slotIds,severity});
    const pending=!w.journeyMapping||w.journeyMapping.status!=='confirmed';
    add('JOURNEY_PENDING',pending?'review':'pass',pending?'旅程映射待安然/秋霜对齐；当前图号和金样未改':'作者旅程映射已确认');
    const stale=rs.filter(x=>x.needsAuthorReview);
    add('PLAN_LINKS_STALE',stale.length?'review':'pass',stale.length?'规划已修改，待复核依据：'+stale.map(x=>'图'+x.imageIndex).join('、'):'规划与证据映射版本一致',stale.map(x=>x.slotId));
    const wanted=top(s).filter(x=>eligible(x,w));
    const covered=new Set(rs.filter(x=>x.journeyStage==='question'&&!x.needsAuthorReview).flatMap(x=>list(x.answersQuestion&&x.answersQuestion.concernIds)));
    const missing=wanted.filter(x=>!covered.has(x.id));
    const journeyUnset=rs.every(x=>x.journeyStage==='unassessed');
    add('TOP_QUESTIONS_COVERED',!wanted.length?'review':missing.length?(journeyUnset?'review':'fail'):'pass',!wanted.length?'样本不足：没有可核对的有效关心点':missing.length?(journeyUnset?'旅程未对齐，暂不判定覆盖':'疑问阶段未覆盖：'+missing.map(x=>x.code+' '+x.shortZh).join('、')):'疑问阶段已覆盖前5有效关心点',rs.filter(x=>x.journeyStage==='question').map(x=>x.slotId));
    const desire=rs.filter(x=>x.journeyStage==='desire'),bad=desire.filter(x=>x.imageType!=='scene');
    add('DESIRE_IS_SCENE',bad.length?'fail':desire.length?'pass':'review',bad.length?'向往阶段必须是场景图：'+bad.map(x=>'图'+x.imageIndex).join('、'):desire.length?'向往阶段均为场景任务（终稿仍须核对）':'向往场景待配置',bad.map(x=>x.slotId));
    const order={awareness:0,interest:1,question:2,desire:3};let last=-1,back=[];
    rs.slice().sort((a,b)=>a.imageIndex-b.imageIndex).forEach(x=>{if(order[x.journeyStage]!=null){if(order[x.journeyStage]<last)back.push(x.slotId);last=order[x.journeyStage];}});
    add('JOURNEY_ORDER',back.length?'fail':pending?'review':'pass',back.length?'旅程顺序倒退；不自动重排金样':'按看到→兴趣→疑问→向往检查；待作者确认',back);
    let duplicates=[];for(let i=1;i<rs.length;i++){const a=rs[i-1].answersQuestion,b=rs[i].answersQuestion;if(a&&b&&a.questionKey&&a.questionKey===b.questionKey)duplicates.push(rs[i].slotId);}
    add('NO_ADJACENT_DUPLICATE',duplicates.length?(pending?'review':'fail'):'pass',duplicates.length?(pending?'相邻图回答同一主问题，待作者复核':'相邻图回答同一主问题，请作者复核'):'未发现同主问题相邻重复；近义信息仍需作者复核',duplicates);
    const invalid=list(w.concerns).filter(x=>!x.archived&&!eligible(x,w));
    add('EVIDENCE_ELIGIBLE',invalid.length?'review':'pass',invalid.length?invalid.map(x=>x.code).join('、')+' 缺有效依据，已排除规划采用':'已采用的买家问题均有原始评论依据');
    const unverified=list(w.productFacts).filter(x=>!x.archived&&x.verification&&x.verification.status!=='verified');
    add('FACTS_PENDING',unverified.length?'review':'pass',unverified.length?`${unverified.length} 项产品事实待 Hongyan 规格/印稿签核；仅提示，不阻塞全局`:'产品事实核查记录齐全');
    return out;
  }
  function statusText(st){return st==='verified_satisfied'?'✅ 已核实':st==='not_satisfied'?'❌ 不满足':'⚠️ 未核实';}
  function render(s){
    const w=s.workflowSnapshot||empty(s.asin),vs=top(s),rs=rows(s),findV=id=>list(w.concerns).find(x=>x.id===id),findF=id=>list(w.productFacts).find(x=>x.id===id);
    const evidenceHTML=v=>list(v.evidenceIds).map(id=>{const e=w.evidenceRegistry[id];return e?`<figure class="wf-evidence"><figcaption>原始评论 #${esc(e.reviewId)} · ASIN ${esc(e.sourceAsin)} · ${esc(e.sourceDate||'日期未提供')}</figcaption><blockquote>${esc(e.originalQuote)}</blockquote><small>来源定位 ${esc(e.taskId)} / ${esc(e.rawPointer)} · 原文件 SHA256 ${esc(e.rawSha256)}</small></figure>`:'';}).join('');
    const concerns=vs.map(v=>{const ok=eligible(v,w),count=v.frequency||{},targets=list(v.coveredBySlotIds).map(id=>rs.find(x=>x.slotId===id)).filter(x=>x&&!x.needsAuthorReview).map(x=>'图'+x.imageIndex).join(' / ');
      return `<article class="wf-concern ${ok?'':'is-missing'}" data-concern-code="${esc(v.code)}"><div class="wf-concern-line"><b>${esc(v.code)}</b><strong>${esc(v.shortZh)}</strong><span>${esc(count.count)} / ${esc(count.denominator)} 条评论</span><span class="${targets?'wf-covered':'wf-uncovered'}">${ok?(targets||'未覆盖'): '缺依据 · 不入规划'}</span></div><details class="wf-proof"><summary>依据 · ${list(v.evidenceIds).length} 条原始评论</summary><p>${esc(v.questionZh)} · ${esc(v.priorityReason||'')}；${esc(count.definition||'')}</p>${ok?evidenceHTML(v):'<p>缺少可追踪原文；仅保留假设，不纳入有效规划。</p>'}</details></article>`;
    }).join('');
    const linkLine=l=>{const v=findV(l.concernId),f=findF(list(l.factIds)[0]),row=rs.find(x=>x.slotId===l.slotId);if(!v||!f||!row)return '';
      const text=`${v.code} ${v.shortZh} → ${f.code} ${f.shortZh} → 图${row.imageIndex} ${list(s.sevenImagePlan).find(x=>x.imageIndex===row.imageIndex)?.slot||row.imageType} ${statusText(linkStatus(l,w))}`;
      return `<div class="wf-match-line" tabindex="0" title="${esc(text)}" data-match-status="${esc(linkStatus(l,w))}">${`<span class="wf-match-copy">${esc(text.replace(/ (✅ 已核实|⚠️ 未核实|❌ 不满足)$/u,''))}</span><span class="wf-match-badge">${esc(statusText(linkStatus(l,w)))}</span>`}</div>`;};
    const cards=rs.map(row=>{
      const gold=list(s.sevenImagePlan).find(x=>x.imageIndex===row.imageIndex)||{},q=row.answersQuestion||{},ids=list(q.concernIds).filter(id=>{const v=findV(id);return v&&eligible(v,w);}),ls=list(w.needFactLinks).filter(x=>!row.needsAuthorReview&&x.slotId===row.slotId&&ids.includes(x.concernId));
      const headline=gold.primaryTheme&&gold.primaryTheme.zh||gold.focusDisplay||gold.slot||'待规划';
      return `<article class="wf-plan-card" data-slot="${esc(row.slotId)}"><header><b>图${esc(row.imageIndex)}</b><span class="wf-stage">${esc(labels[row.journeyStage]||labels.unassessed)}</span><small>${esc(gold.owner||gold.who||(row.imageIndex<=3?'秋霜':'安然'))}</small></header><div class="wf-answer" title="${esc(q.textZh)}">回答：${esc(row.needsAuthorReview?'规划已修改，待复核依据':ids.length||row.imageIndex===1?q.textZh:'待补有效依据/作者确认问题')}</div><strong class="wf-headline" title="${esc(headline)}">${esc(headline)}</strong><div class="wf-en">${esc(gold.primaryTheme&&gold.primaryTheme.en||'Main image · no added text')}</div>${ls.length?linkLine(ls[0]):'<div class="wf-match-line wf-empty">需求/事实映射待核实 ⚠️</div>'}<details class="wf-card-proof"><summary>依据与映射设置</summary><p>金样图号保留；以下仅为待作者确认的旅程配置，不改金样内容。</p><label>旅程阶段<select data-wf-stage="${esc(row.slotId)}" aria-label="图${esc(row.imageIndex)}旅程阶段">${Object.entries(labels).map(([k,v])=>`<option value="${k}" ${row.journeyStage===k?'selected':''}>${v}</option>`).join('')}</select></label><p>问题：${esc(q.textZh)} · 候选关联 ${ids.map(id=>esc(findV(id).code)).join('、')||'产品身份待核'}</p>${ls.map(l=>linkLine(l)+`<p>${esc(findF(l.factIds[0]).limitations.join('；'))}</p>`).join('')}<p>禁止延伸为未经核实的性能/疗效/包含物承诺；F核实由Hongyan签核，模型不能认证。</p></details></article>`;
    }).join('');
    const results=checks(s),warn=results.filter(x=>x.status!=='pass');
    return `<section id="workflow-b" class="wf-section" aria-labelledby="workflow-b-title"><div class="wf-section-head"><div><span class="wf-eyebrow">B · BUYER VOICE</span><h2 id="workflow-b-title">买家关心点 · 前5条</h2></div><span class="wf-source-count">${esc(w.sourceSummary&&w.sourceSummary.linkedReviews||0)} 条原始评论已补链 · 小样本</span></div>${vs.length<5?'<p class="wf-insufficient">样本不足 · 不凑数</p>':''}<div class="wf-concerns">${concerns||'<p class="wf-empty">导入VOC后显示有依据的关心点；不自动编造。</p>'}</div></section><section id="workflow-c" class="wf-section"><div class="wf-section-head"><div><span class="wf-eyebrow">C + C · PLAN & FACT</span><h2>七图规划 · 需求与事实</h2></div><span class="wf-pending">旅程映射${w.journeyMapping&&w.journeyMapping.status==='confirmed'?'已确认':'待作者对齐'} · 金样图号不变</span></div><div class="wf-stage-legend">看到 → 兴趣 → 疑问 → 向往 <span>3处决策：确认图库 / 集中处理黄灯 / 最终选定</span></div><div class="wf-plan-grid">${cards||'<p>尚无规划卡，等待导入。</p>'}</div><details class="wf-summary"><summary>需求—事实匹配汇总（${list(w.needFactLinks).length} 条）</summary><div class="wf-table"><table><thead><tr><th>V编号</th><th>一句需求</th><th>F编号</th><th>状态</th><th>图号</th></tr></thead><tbody>${list(w.needFactLinks).map(l=>{const v=findV(l.concernId),f=findF(l.factIds[0]),row=rs.find(x=>x.slotId===l.slotId);return v&&f&&row?`<tr><td>${esc(v.code)}</td><td>${esc(v.shortZh)}</td><td>${esc(f.code)}</td><td>${esc(statusText(linkStatus(l,w)))}</td><td>图${esc(row.imageIndex)}</td></tr>`:'';}).join('')}</tbody></table></div></details><aside id="workflow-checks" class="wf-checks" aria-label="七图自动检查"><div class="wf-checks-head"><b>自动检查</b><span>${warn.length} 项待处理 · 不改动金样</span></div><ul>${results.map(x=>`<li data-rule="${esc(x.ruleId)}" data-status="${esc(x.status)}"><span>${x.status==='pass'?'✓':x.status==='fail'?'!':'⚠'}</span>${esc(x.reason)}</li>`).join('')}</ul></aside></section>`;
  }
  return {migrate,merge,snapshot,top,rows,setStage,eligible,checks,linkStatus,render,escape:esc};
});
