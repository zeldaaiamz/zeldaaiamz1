'use strict';
window.RootFinderCloud={
  enabled: !['127.0.0.1','localhost'].includes(location.hostname),
  token: sessionStorage.getItem('rootFinderToken')||'',
  timer:null,
  async login(){
    const dialog=document.querySelector('#loginDialog');
    dialog.showModal();
    return new Promise(resolve=>{
      document.querySelector('#loginForm').onsubmit=async e=>{
        e.preventDefault();const button=document.querySelector('#loginSubmit');button.disabled=true;
        try{
          const r=await fetch(apiBase+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:document.querySelector('#loginPassword').value})});
          const data=await r.json();if(!r.ok)throw new Error(data.error||'登录失败');
          this.token=data.token;sessionStorage.setItem('rootFinderToken',data.token);document.querySelector('#loginPassword').value='';dialog.close();resolve();
        }catch(e){document.querySelector('#loginError').textContent=e.message==='Failed to fetch'?'无法连接阿里云服务，请稍后重试。':e.message;}
        finally{button.disabled=false;}
      };
    });
  },
  async poll(){
    if(!current)return;
    try{
      current=await api('/api/history/'+encodeURIComponent(current.id));
      const running=['running','discovering'].includes(current.status);
      setBusy(running);requestName=current.currentKeyword?'服务器正在核价：'+current.currentKeyword:running?'服务器正在拓词':'';requestStarted=Date.parse(current.requestStartedAt||current.updatedAt);
      $('#saveStatus').textContent='已保存到阿里云 · '+dateText(current.updatedAt);
      render();await refreshHistory();if(current.error)showError(current.error);
      if(!running)clearInterval(this.timer);
    }catch(e){showError('暂时无法读取进度，服务器任务可能仍在运行：'+e.message);}
  },
  watch(){clearInterval(this.timer);this.timer=setInterval(()=>this.poll(),4000);this.poll();},
  async start(mode){
    if(busy||!form.reportValidity()||(mode==='expand'&&!$('#expandForm').reportValidity()))return;
    const keywordRoot=form.elements.namedItem('root').value.trim(),priceFloor=Number(form.elements.namedItem('floor').value);
    const id=crypto.randomUUID();setBusy(true);showError('');
    try{
      await api('/api/jobs/start',{id,mode,keywordRoot,priceFloor,anomalyPercent:Number(form.elements.namedItem('anomalyPercent').value),trafficFloor:Number(form.elements.namedItem('trafficFloor').value),country:'US',...(mode==='expand'?{asin:$('#sourceAsin').value.trim().toUpperCase(),weekStart:$('#weekStart').value}:{})});
      current=await api('/api/history/'+id);switchView('results');this.watch();
    }catch(e){setBusy(false);showError(e.message);}
  },
  async resume(){if(!current||busy)return;try{await api('/api/jobs/start',{id:current.id});setBusy(true);showError('');this.watch();}catch(e){showError(e.message);}},
  async pause(){try{await api('/api/jobs/pause',{id:current.id});$('#pause').disabled=true;$('#pause').textContent='服务器完成当前词后暂停…';}catch(e){showError(e.message);}},
  async init(){
    document.querySelector('#scanPanel .notice').textContent='查询由阿里云后台执行，关闭页面或换电脑后仍继续。重新登录可查看历史和进度，每词最多 2 次商品接口调用。';
    document.querySelector('#connectionStatus').textContent='正在连接阿里云…';
    try{
      if(!this.token)await this.login();
      let health;
      try{health=await api('/api/health');}catch(e){if(e.status!==401)throw e;await this.login();health=await api('/api/health');}
      $('#connectionStatus').textContent='阿里云已连接 · 美国站';await refreshSavedLanes();await refreshHistory();
      const id=health.activeJob||historyItems[0]?.id;
      if(id){current=await api('/api/history/'+encodeURIComponent(id));form.elements.namedItem('root').value=current.data.keywordRoot;form.elements.namedItem('floor').value=current.floor;form.elements.namedItem('trafficFloor').value=current.trafficFloor||0;form.elements.namedItem('anomalyPercent').value=current.anomalyPercent??50;render();if(health.activeJob)this.watch();}
    }catch(e){showError('连接失败：'+e.message);$('#connectionStatus').textContent='阿里云暂未连接';}
  }
};
