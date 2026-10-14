(function () {
  'use strict';

  const app = window.KeywordBattle;
  if (!app) return;
  const { client, config, showMessage, hideMessage, humanError, requireSession, statusClass, formatTime } = app;

  async function start() {
    const session = await requireSession();
    if (!session) return;
    const profileName=document.querySelector('#workspace-user-name'),profileEmail=document.querySelector('#workspace-user-email');
    if(profileName)profileName.textContent=session.user?.user_metadata?.name||'当前账户';
    if(profileEmail&&session.user?.email){const [name,domain]=session.user.email.split('@');profileEmail.textContent=`${name.slice(0,3)}…@${domain||''}`;}
    const params=new URLSearchParams(window.location.search);const taskId=params.get('task');const returnURL=window.KeywordNavigation.safeReturn(app,params.get('returnTo'));const back=document.querySelector('#report-history-return');if(returnURL)back.href=returnURL;
    const message = document.querySelector('#report-message');
    const loading = document.querySelector('#report-loading');
    const view = document.querySelector('#report-view');
    const frame = document.querySelector('#report-frame');
    const status = document.querySelector('#report-status');
    const meta = document.querySelector('#report-meta');
    let currentTask = null;
    let imageSetup = null;
    let imageWorkspace = null;

    window.addEventListener('message', async (event) => {
      if (event.source !== frame.contentWindow) return;
      if (event.data?.type !== 'keyword-battle-download-source') return;
      if (!currentTask) return;const sourcePath=currentTask.recovered_source?.upload_path||currentTask.upload_path;if(!sourcePath)return;
      try {
        const { data, error } = await client.storage.from(config.storageBucket).download(sourcePath);
        if (error) throw error;
        const extension = sourcePath.toLowerCase().endsWith('.csv') ? 'csv' : 'xlsx';
        const url = URL.createObjectURL(data);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${currentTask.asin}-原始广告报表-${currentTask.id}.${extension}`;
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      } catch (error) {
        showMessage(message,/not found|does not exist/i.test(error?.message||'')?'原始广告报表已缺失，请在历史报告中补齐对应 ASIN 的原文件；现有报告仍可查看。':`下载原始报表失败：${humanError(error)}`);message.scrollIntoView({block:'start'});
      }
    });
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(taskId || '')) {
      loading.hidden = true;
      status.textContent='链接无效';status.className='status-badge failed';
      meta.textContent='请从任务列表重新进入报告。';
      showMessage(message, '任务号格式不正确，请返回工具页重新进入报告。');
      return;
    }

    if(window.KeywordReportDrafts)window.KeywordReportDrafts.mount({frame,taskId,userId:session.user.id});
    async function refreshImageStatus(){
      if(!currentTask?.comparison_phase||currentTask.status!=='已完成')return;
      const r=await client.from('keyword_image_sessions').select('status,error,image_status:state->workflow->status').eq('task_id',taskId).maybeSingle();
      if(r.error){status.textContent='04 已完成 · 05 状态暂无法读取';return;}
      status.textContent=r.data?.image_status==='complete'?'04 / 05 已完成':r.data?.status==='error'?'04 已完成 · 05 图片分析异常':r.data?.status==='running'||r.data?.status==='queued'?'04 已完成 · 05 分析中':'04 已完成 · 05 待继续';
      status.className='status-badge '+(r.data?.image_status==='complete'?'done':r.data?.status==='error'?'failed':'waiting');
    }
    let imageResources;
    function loadImageResources(){return imageResources ||= ['image-module.js?v=20261013-image-setup','product-identity.js?v=20261013-image-identity','image-setup.js?v=20261013-ai-checklist','image-workspace.js?v=20261013-workbench-v2'].reduce((chain,src)=>chain.then(()=>new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='../assets/'+src;script.onload=resolve;script.onerror=()=>reject(new Error('图片模块资源加载失败'));document.head.append(script);})),Promise.resolve());}
    let reportLoaded = false;
    let inFlight=false;
    async function loadReport() {
      if(inFlight)return;
      if (reportLoaded) {await refreshImageStatus();return;}
      inFlight=true;
      hideMessage(message);
      try {
        const { data: task, error } = await client.from('keyword_tasks')
          .select('id,asin,status,created_at,upload_path,report_url,failure_reason,comparison_phase,comparison_state')
          .eq('id', taskId)
          .maybeSingle();
        if (error) throw error;
        if (!task) throw new Error('找不到这个任务，或它不属于当前账户');
        currentTask = task;try{const source=await client.from('keyword_task_report_sources').select('upload_path,revision').eq('task_id',taskId).maybeSingle();if(source.error)throw source.error;currentTask.recovered_source=source.data;}catch{showMessage(message,'补齐报表记录暂时无法读取，请刷新后再下载原报表。');}
        frame.title = task.comparison_phase ? '竞对与图片对比报告' : '关键词与广告分析报告';
        document.querySelector('#report-title').textContent = `${task.asin} · ${task.comparison_phase ? '竞对与图片对比' : '关键词与广告分析'}`;
        meta.textContent = `提交于 ${formatTime(task.created_at)} · 仅当前登录账户可查看`;
        status.className = `status-badge ${statusClass(task.status)}`;
        status.replaceChildren(document.createElement('i'), document.createTextNode(task.status));

        if (task.status === '失败') {
          loading.hidden = true;
          showMessage(message, task.failure_reason ? `任务失败：${task.failure_reason}` : '任务失败，请返回工具页查看原因。');
          return;
        }
        if (task.status !== '已完成' || !task.report_url) {
          loading.hidden = false;
          return;
        }
        if (/^https?:\/\//i.test(task.report_url)) {
          throw new Error('这份旧报告正在迁移到私有存储，请稍后刷新');
        }

        const { data, error: downloadError } = await client.storage
          .from(config.reportBucket)
          .download(task.report_url);
        if (downloadError) throw downloadError;
        const originalHtml = await data.text();
        let reportHtml = originalHtml;
        const reportDocument=new DOMParser().parseFromString(originalHtml,'text/html');
        const unavailable = [];
        if(task.comparison_phase){try{await loadImageResources();}catch{unavailable.push('图片工作台');}}
        for (const [name, module] of [['自然位标杆',window.KeywordBattleOrganicModule],...(task.comparison_phase?[['图片',window.KeywordBattleImageModule]]:[]),['广告',window.KeywordBattleAdModule]]) {
          try {
            if (!module) throw new Error('模块加载器不可用');
            await module.upgrade(reportDocument);
          } catch { unavailable.push(name); }
        }
        if(task.comparison_phase)reportHtml='<!doctype html>\n'+reportDocument.documentElement.outerHTML;
        if(task.comparison_phase && window.KeywordImageSetup){
          reportHtml=window.KeywordImageSetup.upgrade(reportHtml);
          if(!imageSetup) imageSetup=window.KeywordImageSetup.mount({app,taskId,frame,onUpdated:async()=>{reportLoaded=false;await loadReport();}});
        }
        if(window.KeywordImageWorkspace && !imageWorkspace){
          imageWorkspace=window.KeywordImageWorkspace.mount({app,taskId,frame});
        }
        let finalDocument=reportDocument;
        if(task.comparison_phase){
          const doc=new DOMParser().parseFromString(reportHtml,'text/html');
          const table=doc.querySelector('.cc-business-table');
          const row=[...doc.querySelectorAll('.cc-root tr')].find(r=>r.querySelector('th')?.textContent.trim()==='图片张数');
          const workflow=doc.querySelector('[data-image-workspace-model]');
          if(row){try{const model=workflow?JSON.parse(workflow.textContent):currentTask.comparison_state||{};let unknown=0;const cells=row.querySelectorAll('td');(model.products||[]).forEach((p,i)=>{if(!Array.isArray(p.photos)||p.missingFields?.includes('main_image')||!p.photos.length){if(cells[i])cells[i].textContent='未返回';unknown++;}});if(unknown&&cells.length)cells[cells.length-1].textContent='部分产品图片资料未取得，暂不比较图片数量；未返回不等于没有图片。';}catch{}}
          finalDocument=doc;
        }
        const exportDoc=finalDocument;
        window.KeywordReportPerformance.upgradeDocument(exportDoc,taskId);
        const emptyScript=exportDoc.createElement('script');emptyScript.textContent="if(!window.ZeldaReportPerformance)['exportTxt','exportCsv'].forEach(id=>document.getElementById(id)?.addEventListener('click',e=>{const n=document.getElementById('visibleCount');if(n&&n.textContent.startsWith('显示 0 / ')){e.stopImmediatePropagation();n.textContent='当前筛选结果没有可导出的关键词';}},true));";exportDoc.body.append(emptyScript);
        if(task.comparison_phase&&params.get('module')==='05'){const jump=exportDoc.createElement('script');jump.textContent="document.querySelector('[data-module=\"05\"]')?.click();";exportDoc.body.append(jump);}
        frame.srcdoc='<!doctype html>\n'+exportDoc.documentElement.outerHTML;
        if (unavailable.length) showMessage(message, `报告已加载，但${unavailable.join('、')}模块资源暂时不可用，请刷新页面重试。`);
        loading.hidden = true;
        view.hidden = false;
        reportLoaded = true;
        await refreshImageStatus();
      } catch (error) {
        loading.hidden = true;
        status.textContent='报告读取失败';status.className='status-badge failed';
        meta.textContent='请返回任务列表核对，或刷新后重试。';
        showMessage(message, humanError(error));
      } finally {inFlight=false;}
    }

    await loadReport();
    window.setInterval(loadReport, config.refreshIntervalMs || 30000);
  }

  start().catch((error) => {document.querySelector('#report-loading').hidden=true;document.querySelector('#report-status').textContent='报告读取失败';document.querySelector('#report-meta').textContent='请返回任务列表核对，或刷新后重试。';showMessage(document.querySelector('#report-message'), humanError(error));});
}());
