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
    const taskId = new URLSearchParams(window.location.search).get('task');
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
      if (!currentTask?.upload_path) return;
      try {
        const { data, error } = await client.storage.from(config.storageBucket).download(currentTask.upload_path);
        if (error) throw error;
        const extension = currentTask.upload_path.toLowerCase().endsWith('.csv') ? 'csv' : 'xlsx';
        const url = URL.createObjectURL(data);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${currentTask.asin}-原始广告报表-${currentTask.id}.${extension}`;
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      } catch (error) {
        window.alert(error?.message?.toLowerCase().includes('not found')
          ? '这是一份历史任务，原始上传报表已按旧规则清理，无法恢复。'
          : `下载原始报表失败：${humanError(error)}`);
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
    let reportLoaded = false;
    async function loadReport() {
      if (reportLoaded) {await refreshImageStatus();return;}
      hideMessage(message);
      try {
        const { data: task, error } = await client.from('keyword_tasks')
          .select('id,asin,status,created_at,upload_path,report_url,failure_reason,comparison_phase,comparison_state')
          .eq('id', taskId)
          .maybeSingle();
        if (error) throw error;
        if (!task) throw new Error('找不到这个任务，或它不属于当前账户');
        currentTask = task;
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
        const unavailable = [];
        for (const [name, module] of [['自然位标杆', window.KeywordBattleOrganicModule], ['图片', window.KeywordBattleImageModule], ['广告', window.KeywordBattleAdModule]]) {
          try {
            if (!module) throw new Error('模块加载器不可用');
            reportHtml = await module.upgrade(reportHtml);
          } catch { unavailable.push(name); }
        }
        if(task.comparison_phase && window.KeywordImageSetup){
          reportHtml=window.KeywordImageSetup.upgrade(reportHtml);
          if(!imageSetup) imageSetup=window.KeywordImageSetup.mount({app,taskId,frame,onUpdated:async()=>{reportLoaded=false;await loadReport();}});
        }
        if(window.KeywordImageWorkspace && !imageWorkspace){
          imageWorkspace=window.KeywordImageWorkspace.mount({app,taskId,frame});
        }
        if(task.comparison_phase){
          const doc=new DOMParser().parseFromString(reportHtml,'text/html');
          const table=doc.querySelector('.cc-business-table');
          const row=[...doc.querySelectorAll('.cc-root tr')].find(r=>r.querySelector('th')?.textContent.trim()==='图片张数');
          const workflow=doc.querySelector('[data-image-workspace-model]');
          if(row){try{const model=workflow?JSON.parse(workflow.textContent):currentTask.comparison_state||{};let unknown=0;const cells=row.querySelectorAll('td');(model.products||[]).forEach((p,i)=>{if(!Array.isArray(p.photos)||p.missingFields?.includes('main_image')||!p.photos.length){if(cells[i])cells[i].textContent='未返回';unknown++;}});if(unknown&&cells.length)cells[cells.length-1].textContent='部分产品图片资料未取得，暂不比较图片数量；未返回不等于没有图片。';}catch{}}
          reportHtml='<!doctype html>\n'+doc.documentElement.outerHTML;
        }
        const exportDoc=new DOMParser().parseFromString(reportHtml,'text/html');
        const emptyScript=exportDoc.createElement('script');emptyScript.textContent="['exportTxt','exportCsv'].forEach(id=>document.getElementById(id)?.addEventListener('click',e=>{const n=document.getElementById('visibleCount');if(n&&n.textContent.startsWith('显示 0 / ')){e.stopImmediatePropagation();n.textContent='当前筛选结果没有可导出的关键词';}},true));";exportDoc.body.append(emptyScript);
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
      }
    }

    await loadReport();
    window.setInterval(loadReport, config.refreshIntervalMs || 30000);
  }

  start().catch((error) => {document.querySelector('#report-loading').hidden=true;document.querySelector('#report-status').textContent='报告读取失败';document.querySelector('#report-meta').textContent='请返回任务列表核对，或刷新后重试。';showMessage(document.querySelector('#report-message'), humanError(error));});
}());
