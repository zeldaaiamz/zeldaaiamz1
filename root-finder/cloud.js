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
  renderQueue(){const state=this.snapshot;if(!state)return;$('#queuePanel').hidden=false;$('#queueStatus').textContent=state.paused?'队列已暂停':state.activeJob?'队列执行中':state.jobs.some(j=>j.queuePosition)?'等待启动下一个任务':'队列空闲';$('#queuePause').disabled=state.paused;$('#queueResume').disabled=!state.paused||!!state.activeJob;const done=state.jobs.filter(j=>j.status==='complete').sort((a,b)=>String(b.updatedAt||'').localeCompare(String(a.updatedAt||''))).slice(0,2),shown=state.jobs.filter(j=>j.status!=='complete'||done.includes(j)),hidden=state.jobs.filter(j=>j.status==='complete').length-done.length;$('#queueJobs').innerHTML=(shown.map(j=>{const run=j.id===state.activeJob,btn=(k,t,c='')=>`<button class="small-button${c}" data-job-act="${k}" data-job-id="${esc(j.id)}">${t}</button>`,acts=[];if(j.status!=='complete'){if(run||j.queuePosition)acts.push(btn('pause',run?'暂停':'暂停'));else acts.push(btn('restart','重启'));}acts.push(btn('delete','删除',' danger'));return `<div class="queue-job"><div><strong>${esc(j.keywordRoot)}</strong> · ${esc(states[j.status]||j.status)}${j.queuePosition?' · 队列第 '+j.queuePosition+' 项':''}<small>底价 ${money(j.floor)} · 流量 ≥ ${j.trafficFloor||0} · 异常 ≥ ${j.anomalyPercent??'未设置'}% · 已处理 ${j.checked+j.skipped}/${j.count} · ${esc(dateText(j.createdAt))}</small>${(run||['running','discovering'].includes(j.status))?`<div style="display:flex;gap:8px;align-items:center;margin-top:4px"><progress max="${Math.max(j.count,1)}" value="${j.checked+j.skipped}" style="width:220px"></progress><small style="display:inline">${j.status==='discovering'?'正在拓展关键词…':`已处理 ${j.checked+j.skipped}/${j.count}（${j.count?Math.round((j.checked+j.skipped)*100/j.count):0}%）${j.currentKeyword?' · 当前：'+esc(j.currentKeyword):''}`}</small></div>`:''}${j.error?`<small>${esc(j.error)}</small>`:''}</div><div class="queue-job-actions" style="display:flex;gap:6px;flex-shrink:0">${acts.join(' ')}</div></div>`}).join('')+(hidden>0?`<p class="notice">已完成任务仅显示最新 2 个，另有 ${hidden} 个已隐藏（数据仍保留在历史中）。</p>`:''))||'<p>暂无任务。输入关键词后加入队列。</p>';},
  watch(){clearInterval(this.timer);this.timer=setInterval(()=>this.poll(),4000);this.poll();},
  async start(mode){
    if(this.adding||curationBusy||!form.reportValidity()||(mode==='expand'&&!$('#expandForm').reportValidity()))return;
    const keywordRoot=form.elements.namedItem('root').value.trim(),priceFloor=Number(form.elements.namedItem('floor').value),id=crypto.randomUUID();
    this.adding=true;$('#submit').disabled=true;showError('');
    try{await api('/api/jobs/start',{id,mode,keywordRoot,priceFloor,anomalyPercent:Number(form.elements.namedItem('anomalyPercent').value),trafficFloor:Number(form.elements.namedItem('trafficFloor').value),country:'US',...(mode==='expand'?{asin:$('#sourceAsin').value.trim().toUpperCase(),weekStart:$('#weekStart').value}:{})});await this.poll(true);$('#queueStatus').textContent+=' · 已加入 '+keywordRoot;scheduleHistoryHint();}catch(e){showError(e.message);}finally{this.adding=false;$('#submit').disabled=false;}
  },
  abaKey:'sif-aba-last-v1',
  abaLoad(){try{const v=JSON.parse(localStorage.getItem(this.abaKey)||'[]');return Array.isArray(v)?v.filter(x=>typeof x==='string'):[];}catch(_){return [];}},
  abaRender(){const box=$('#abaList');if(box)box.textContent=this.abaLoad().join('、');},
  async abaNext(){
    const btn=$('#abaNext');if(btn.disabled)return;btn.disabled=true;showError('');
    try{const body=await api('/api/aba/next-batch',{});const roots=(body.roots||[]).map(r=>String(r.root||'').trim()).filter(Boolean).slice(0,10);
      localStorage.setItem(this.abaKey,JSON.stringify(roots));this.abaRender();
    }catch(e){showError('获取关键词失败：'+e.message);}finally{btn.disabled=false;}
  },
  async resume(){try{await api('/api/jobs/resume-queue',{});await this.poll(true);}catch(e){showError(e.message);}},
  async pause(){try{await api('/api/jobs/pause',{});await this.poll(true);}catch(e){showError(e.message);}},
  async init(){
    $('#connectionStatus').textContent='正在连接阿里云…';
    try{
      if(!this.token)await this.login();
      try{await api('/api/health');}catch(e){if(e.status!==401)throw e;await this.login();await api('/api/health');}
      $('#connectionStatus').textContent='阿里云已连接 · 美国站';await refreshSavedLanes();
      $('#abaNext').hidden=false;$('#abaNext').onclick=()=>this.abaNext();this.abaRender();$('#queuePause').onclick=()=>this.pause();$('#queueResume').onclick=()=>this.resume();
      $('#queueJobs').onclick=async e=>{const b=e.target.closest('[data-job-act]');if(!b)return;const act=b.dataset.jobAct,id=b.dataset.jobId,job=(this.snapshot?.jobs||[]).find(j=>j.id===id);if(act==='delete'&&!confirm(`确定删除任务「${job?.keywordRoot||id}」？${id===this.snapshot?.activeJob?'任务正在执行，将先停止再删除。':''}该任务的查询结果会一并删除，无法恢复。`))return;b.disabled=true;try{await api({pause:'/api/jobs/pause-job',restart:'/api/jobs/start',delete:'/api/jobs/delete'}[act],{id});await this.poll(true);setTimeout(()=>this.poll(true),2500);}catch(err){showError(err.message);}finally{b.disabled=false;}};
      await this.poll(true);this.watch();scheduleHistoryHint();
    }catch(e){showError('连接失败：'+e.message);$('#connectionStatus').textContent='阿里云暂未连接';}
  }
};
