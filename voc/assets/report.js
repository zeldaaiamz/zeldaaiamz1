(async function () {
  'use strict';
  const { client, config, session, message, reportPath } = window.VOC;
  const status = document.getElementById('report-message'), frame = document.getElementById('report-frame');
  let loading = false;
  async function load() {
    if (loading) return; loading = true; frame.hidden = true; frame.removeAttribute('srcdoc');
    try {
      const id = new URLSearchParams(location.search).get('task');
      if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id || '')) throw new Error('任务号无效，请返回任务列表。');
      const { data: task, error } = await client.from('voc_tasks').select('id,asins,status,report_path,failure_reason').eq('id',id).maybeSingle();
      if (error) throw error; if (!task) throw new Error('找不到任务，或当前账户无权查看。');
      document.getElementById('report-title').textContent = task.asins;
      if (task.status === '失败') throw new Error(task.failure_reason || '任务失败');
      if (task.status !== '完成') return message(status,`任务${task.status}，报告尚未生成。`);
      if (!task.report_path) return message(status,'空跑完成，暂无报告。报告将在模块 3 接入。');
      if (!reportPath(task)) throw new Error('报告文件路径不符合 VOC 规则。');
      const { data, error: downloadError } = await client.storage.from(config.reportBucket).download(task.report_path);
      if (downloadError) throw downloadError;
      frame.srcdoc = await data.text(); frame.hidden = false; message(status,'');
    } catch (e) { message(status, `报告未能打开：${e.message}`); }
    finally { loading = false; }
  }
  try { if (!await session()) return; document.getElementById('reload-report').onclick = load; await load(); }
  catch (e) { message(status,`加载失败：${e.message}`); }
}());
