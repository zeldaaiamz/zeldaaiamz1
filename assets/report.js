(function () {
  'use strict';

  const app = window.KeywordBattle;
  if (!app) return;
  const { client, config, showMessage, hideMessage, humanError, requireSession, statusClass, formatTime } = app;

  async function start() {
    const session = await requireSession();
    if (!session) return;
    const taskId = new URLSearchParams(window.location.search).get('task');
    const message = document.querySelector('#report-message');
    const loading = document.querySelector('#report-loading');
    const view = document.querySelector('#report-view');
    const frame = document.querySelector('#report-frame');
    const status = document.querySelector('#report-status');
    const meta = document.querySelector('#report-meta');
    let currentTask = null;

    window.addEventListener('message', async (event) => {
      if (event.source !== frame.contentWindow || event.data?.type !== 'keyword-battle-download-source') return;
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
    if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(taskId || '')) {
      loading.hidden = true;
      showMessage(message, '任务号格式不正确，请返回工具页重新进入报告。');
      return;
    }

    let reportLoaded = false;
    async function loadReport() {
      if (reportLoaded) return;
      hideMessage(message);
      try {
        const { data: task, error } = await client.from('keyword_tasks')
          .select('id,asin,status,created_at,upload_path,report_url,failure_reason')
          .eq('id', taskId)
          .maybeSingle();
        if (error) throw error;
        if (!task) throw new Error('找不到这个任务，或它不属于当前账户');
        currentTask = task;
        document.querySelector('#report-title').textContent = `${task.asin} · 关键词作战总表`;
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
        frame.srcdoc = await data.text();
        loading.hidden = true;
        view.hidden = false;
        reportLoaded = true;
      } catch (error) {
        loading.hidden = true;
        showMessage(message, humanError(error));
      }
    }

    await loadReport();
    window.setInterval(loadReport, config.refreshIntervalMs || 30000);
  }

  start().catch((error) => showMessage(document.querySelector('#report-message'), humanError(error)));
}());
