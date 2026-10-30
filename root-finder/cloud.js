'use strict';
window.RootFinderCloud={
  enabled: !['127.0.0.1','localhost'].includes(location.hostname),
  token: '',
  timer:null,
  async login(){this.token=await window.RootFinderAuth.getAccessToken();},
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
  async resume(){try{await api('/api/jobs/resume-queue',{});await this.poll(true);}catch(e){showError(e.message);}},
  async pause(){try{await api('/api/jobs/pause',{});await this.poll(true);}catch(e){showError(e.message);}},
  async init(){
    $('#connectionStatus').textContent='正在连接阿里云…';
    try{
      if(!this.token)await this.login();
      try{await api('/api/health');}catch(e){if(e.status!==401)throw e;await this.login();await api('/api/health');}
      $('#connectionStatus').textContent='阿里云已连接 · 美国站';await refreshSavedLanes();
      $('#queuePause').onclick=()=>this.pause();$('#queueResume').onclick=()=>this.resume();
      $('#queueJobs').onclick=async e=>{const cancel=e.target.closest('[data-cancel-job]'),retry=e.target.closest('[data-retry-job]');if(!cancel&&!retry)return;const b=cancel||retry;b.disabled=true;try{await api(cancel?'/api/jobs/cancel':'/api/jobs/start',{id:cancel?b.dataset.cancelJob:b.dataset.retryJob});await this.poll(true);}catch(err){showError(err.message);}finally{b.disabled=false;}};
      await this.poll(true);this.watch();scheduleHistoryHint();
    }catch(e){showError('连接失败：'+e.message);$('#connectionStatus').textContent='阿里云暂未连接';}
  }
};
