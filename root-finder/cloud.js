'use strict';
window.RootFinderCloud={
  enabled: !['127.0.0.1','localhost'].includes(location.hostname),
  token: '',
  timer:null,
  async login(){this.token=await window.RootFinderSession.getAccessToken();},
  snapshot:null,polling:false,adding:false,
  async poll(force=false){
    if(this.polling||(!force&&curationBusy))return;this.polling=true;
    try{
      const state=await api('/api/jobs/state');const revision=JSON.stringify([state.activeJob,state.paused,state.jobs.map(j=>[j.id,j.updatedAt,j.queuePosition])]);if(!force&&revision===this.revision)return;this.revision=revision;this.snapshot=state;
      const rows=state.records.flatMap(record=>record.data.opportunities.map(row=>({...row,_source:{id:record.id,createdAt:record.createdAt,floor:record.floor,trafficFloor:record.trafficFloor,anomalyPercent:record.anomalyPercent,market:record.market,data:{keywordRoot:record.data.keywordRoot}}})));
      current={id:'all-results',floor:0,trafficFloor:0,anomalyPercent:null,market:'US',status:state.activeJob?'running':'complete',data:{keywordRoot:'全部任务',opportunities:rows}};
      setBusy(!!state.activeJob||(!state.paused&&state.jobs.some(j=>j.queuePosition)));render();this.renderQueue();
    }catch(e){showError('读取队列失败，云端任务可能仍在执行：'+e.message);}finally{this.polling=false;}
  },
  renderQueue(){const state=this.snapshot;if(!state)return;$('#queuePanel').hidden=false;$('#queueStatus').textContent=state.paused?'队列已暂停':state.activeJob?'队列执行中':state.jobs.some(j=>j.queuePosition)?'等待启动下一个任务':'队列空闲';$('#queuePause').disabled=state.paused;$('#queueResume').disabled=!state.paused||!!state.activeJob;$('#queueJobs').innerHTML=state.jobs.map(j=>`<div class="queue-job"><div><strong>${esc(j.keywordRoot)}</strong> · ${esc(states[j.status]||j.status)}${j.queuePosition?' · 队列第 '+j.queuePosition+' 项':''}<small>底价 ${money(j.floor)} · 流量 ≥ ${j.trafficFloor||0} · 异常 ≥ ${j.anomalyPercent??'未设置'}% · 已处理 ${j.checked+j.skipped}/${j.count} · ${esc(dateText(j.createdAt))}</small>${j.error?`<small>${esc(j.error)}</small>`:''}</div><div>${j.queuePosition&&j.id!==state.activeJob?`<button class="small-button" data-cancel-job="${esc(j.id)}">移出队列</button>`:!j.queuePosition&&['paused','error','interrupted','cancelled'].includes(j.status)?`<button class="small-button" data-retry-job="${esc(j.id)}">加入队列继续</button>`:''}</div></div>`).join('')||'<p>暂无任务。输入关键词后加入队列。</p>';},
  watch(){clearInterval(this.timer);this.timer=setInterval(()=>this.poll(),4000);this.poll();},
  async start(mode){
    if(this.adding||curationBusy||!form.reportValidity()||(mode==='expand'&&!$('#expandForm').reportValidity()))return;
    const keywordRoot=form.elements.namedItem('root').value.trim(),priceFloor=Number(form.elements.namedItem('floor').value),id=crypto.randomUUID();
    this.adding=true;$('#submit').disabled=true;showError('');
    try{await api('/api/jobs/start',{id,mode,keywordRoot,priceFloor,anomalyPercent:Number(form.elements.namedItem('anomalyPercent').value),trafficFloor:Number(form.elements.namedItem('trafficFloor').value),country:'US',...(mode==='expand'?{asin:$('#sourceAsin').value.trim().toUpperCase(),weekStart:$('#weekStart').value}:{})});await this.poll(true);$('#queueStatus').textContent+=' · 已加入 '+keywordRoot;scheduleHistoryHint();}catch(e){showError(e.message);}finally{this.adding=false;$('#submit').disabled=false;}
  },
  abaKey:'sif-aba-pending-v1',
  abaLoad(){try{const v=JSON.parse(localStorage.getItem(this.abaKey)||'[]');return Array.isArray(v)?v.filter(x=>x&&typeof x.root==='string'):[];}catch(_){return [];}},
  abaSave(list){localStorage.setItem(this.abaKey,JSON.stringify(list));this.abaRender();},
  abaRender(){const box=$('#abaPending');if(!box)return;const list=this.abaLoad();box.hidden=!list.length;
    box.innerHTML=list.length?`<p><strong>待发送 ABA 词根（${list.length}）</strong> · 可逐个调整条件后发送</p>`+list.map((x,i)=>`<div class="queue-job" data-aba-i="${i}"><div><strong>${esc(x.root)}</strong><small>价格底线 <input type="number" min="0" step="0.01" data-f="priceFloor" value="${esc(x.priceFloor)}" style="width:80px"> 流量底线 <input type="number" min="0" step="1" data-f="trafficFloor" value="${esc(x.trafficFloor)}" style="width:80px"> 高价异常幅度% <input type="number" min="0" step="1" data-f="anomalyPercent" value="${esc(x.anomalyPercent)}" style="width:70px"></small></div><div><button type="button" class="small-button" data-aba-send="${i}">发送</button> <button type="button" class="small-button" data-aba-skip="${i}">移除</button></div></div>`).join(''):'';},
  async abaAction(e){const send=e.target.closest('[data-aba-send]'),skip=e.target.closest('[data-aba-skip]');
    if(e.type==='change'){const row=e.target.closest('[data-aba-i]'),f=e.target.dataset.f;if(!row||!f)return;const list=this.abaLoad(),x=list[+row.dataset.abaI];if(!x)return;x[f]=e.target.value;localStorage.setItem(this.abaKey,JSON.stringify(list));return;}
    if(skip){const list=this.abaLoad(),x=list[+skip.dataset.abaSkip];if(!x||!confirm('移除词根「'+x.root+'」？移除后不会再次发放。'))return;list.splice(+skip.dataset.abaSkip,1);this.abaSave(list);return;}
    if(!send)return;const i=+send.dataset.abaSend,row=send.closest('[data-aba-i]'),list=this.abaLoad(),x=list[i];if(!x)return;
    const v=f=>row.querySelector(`[data-f="${f}"]`),inputs=['priceFloor','trafficFloor','anomalyPercent'].map(v);
    if(inputs.some(el=>el.value===''||!el.reportValidity()))return;
    const [priceFloor,trafficFloor,anomalyPercent]=inputs.map(el=>Number(el.value));
    send.disabled=true;showError('');
    try{await api('/api/jobs/start',{id:crypto.randomUUID(),mode:'discover',keywordRoot:x.root,priceFloor,anomalyPercent,trafficFloor,country:'US'});
      const cur=this.abaLoad();const k=cur.findIndex(y=>y.root===x.root);if(k>=0)cur.splice(k,1);this.abaSave(cur);
      await this.poll(true);$('#queueStatus').textContent+=' · 已加入 '+x.root;scheduleHistoryHint();
    }catch(err){showError('发送失败：'+err.message);send.disabled=false;}
  },
  async abaNext(){
    if(this.adding||curationBusy)return;const btn=$('#abaNext');
    if(!confirm('领取下一批 ABA 词根（5 个）？领取后进入待发送列表（不会自动加入队列），可逐个调整价格底线/流量底线/高价异常幅度后发送。领取后不会重复发放。'))return;
    this.adding=true;btn.disabled=true;showError('');
    try{const body=await api('/api/aba/next-batch',{});const roots=(body.roots||[]).map(r=>String(r.root||'').trim()).filter(r=>r.length>=2&&r.length<=80);
      if(!roots.length){$('#queueStatus').textContent+=' · ABA 词根已全部领取';return;}
      const d=n=>form.elements.namedItem(n).value,list=this.abaLoad();
      for(const root of roots)if(!list.some(y=>y.root===root))list.push({root,priceFloor:d('floor'),trafficFloor:d('trafficFloor'),anomalyPercent:d('anomalyPercent'),claimedAt:Date.now()});
      this.abaSave(list);
    }catch(e){showError('领取 ABA 词根失败：'+e.message);}finally{this.adding=false;btn.disabled=false;}
  },
  async resume(){try{await api('/api/jobs/resume-queue',{});await this.poll(true);}catch(e){showError(e.message);}},
  async pause(){try{await api('/api/jobs/pause',{});await this.poll(true);}catch(e){showError(e.message);}},
  async init(){
    $('#connectionStatus').textContent='正在连接阿里云…';
    try{
      if(!this.token)await this.login();
      try{await api('/api/health');}catch(e){if(e.status!==401)throw e;await this.login();await api('/api/health');}
      $('#connectionStatus').textContent='阿里云已连接 · 美国站';await refreshSavedLanes();
      $('#abaNext').hidden=false;$('#abaNext').onclick=()=>this.abaNext();this.abaRender();$('#abaPending').onclick=e=>this.abaAction(e);$('#abaPending').onchange=e=>this.abaAction(e);$('#queuePause').onclick=()=>this.pause();$('#queueResume').onclick=()=>this.resume();
      $('#queueJobs').onclick=async e=>{const cancel=e.target.closest('[data-cancel-job]'),retry=e.target.closest('[data-retry-job]');if(!cancel&&!retry)return;const b=cancel||retry;b.disabled=true;try{await api(cancel?'/api/jobs/cancel':'/api/jobs/start',{id:cancel?b.dataset.cancelJob:b.dataset.retryJob});await this.poll(true);}catch(err){showError(err.message);}finally{b.disabled=false;}};
      await this.poll(true);this.watch();scheduleHistoryHint();
    }catch(e){showError('连接失败：'+e.message);$('#connectionStatus').textContent='阿里云暂未连接';}
  }
};
