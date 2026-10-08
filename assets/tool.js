(function () {
  'use strict';

  const app = window.KeywordBattle;
  if (!app) return;
  const {
    client, config, route, showMessage, hideMessage, humanError,
    requireSession, setButtonBusy, statusClass, formatTime,
  } = app;

  function taskRow(task, onReuse, onReview) {
    const row = document.createElement('tr');
    const phaseLabel = task.status === '失败' ? task.status : window.KeywordComparison.phaseLabels[task.comparison_phase] || task.status;
    const values = [formatTime(task.created_at), task.asin, phaseLabel, task.failure_reason || '—'];
    values.forEach((value, index) => {
      const cell = document.createElement('td');
      if (index === 2) {
        const chip = document.createElement('span');
        chip.className = `status-chip ${statusClass(task.status)}`;
        chip.textContent = value;
        cell.append(chip);
      } else {
        cell.textContent = value;
      }
      row.append(cell);
    });
    const actionCell = document.createElement('td');
    if (task.status === '已完成' && task.report_url) {
      const link = document.createElement('a');
      link.className = 'table-action';
      link.href = route(`report/?task=${encodeURIComponent(task.id)}`);
      link.textContent = '查看报告';
      actionCell.append(link);
      const reuse = document.createElement('button');
      reuse.type = 'button';
      reuse.className = 'text-button';
      reuse.textContent = '用原数据重新分析';
      reuse.addEventListener('click', () => onReuse(task));
      actionCell.append(reuse);
      const compare = document.createElement('button');
      compare.type = 'button'; compare.className = 'text-button'; compare.textContent = '查看候选并发起竞对对比';
      compare.addEventListener('click', () => onReuse(task, true));
      actionCell.append(compare);
    } else if (task.status === '进行中' && ['awaiting_selection','awaiting_review','needs_evidence'].includes(task.comparison_phase)) {
      const review = document.createElement('button'); review.type = 'button'; review.className = 'table-action';
      review.textContent = phaseLabel; review.addEventListener('click', () => onReview(task)); actionCell.append(review);
    } else {
      actionCell.textContent = '—';
    }
    row.append(actionCell);
    return row;
  }

  async function start() {
    const session = await requireSession();
    if (!session) return;
    const user = session.user;
    const taskBody = document.querySelector('#tasks-body');
    const taskMessage = document.querySelector('#tasks-message');
    const submitMessage = document.querySelector('#submit-message');
    const refreshButton = document.querySelector('#refresh-tasks');
    const form = document.querySelector('#task-form');
    const submitButton = document.querySelector('#task-submit');
    const asinInput = document.querySelector('#asin');
    const fileInput = document.querySelector('#report-file');
    const fileName = document.querySelector('#file-name');
    const comparisonEnabled = document.querySelector('#comparison-enabled');
    const comparisonFields = document.querySelector('#comparison-fields');
    const competitorAsins = document.querySelector('#competitor-asins');
    const coreKeyword = document.querySelector('#core-keyword');
    const addCompetitor = document.querySelector('#add-competitor');
    function addAsinRow(value = '') {
      if (competitorAsins.children.length >= 5) return;
      const row=document.createElement('label');row.className='product-row';
      const label=document.createElement('span');label.textContent='竞对';
      const input=document.createElement('input');input.type='text';input.maxLength=10;input.value=value;input.placeholder='10 位 ASIN';input.setAttribute('aria-label','竞对 ASIN');input.spellcheck=false;
      input.oninput=()=>{input.value=input.value.toUpperCase();};
      const remove=document.createElement('button');remove.type='button';remove.className='text-button';remove.textContent='移除';remove.onclick=()=>{row.remove();addCompetitor.disabled=false;};
      row.append(label,input,remove);competitorAsins.append(row);addCompetitor.disabled=competitorAsins.children.length>=5;
    }
    function fillAsins(asins=[]) { competitorAsins.replaceChildren();addCompetitor.disabled=false;(asins.length?asins:['','','']).forEach(addAsinRow); }
    addCompetitor.onclick=()=>addAsinRow();fillAsins();
    const syncComparison = () => { comparisonFields.hidden = !comparisonEnabled.checked; };
    comparisonEnabled.addEventListener('change', syncComparison);
    let reuseSource = null;
    let candidateTaskId = null;
    let submitting = false;
    function selectSource(task, compare = false, selected = [], candidateId = null) {
      if (submitting) return;
      reuseSource = task;
      candidateTaskId = candidateId;
      comparisonEnabled.checked = compare;
      fillAsins(compare ? selected : []);
      coreKeyword.value = compare ? task?.core_keyword || '' : '';
      syncComparison();
      document.getElementById('reuse-summary').hidden = !task;
      asinInput.readOnly = Boolean(task);
      fileInput.disabled = Boolean(task);
      fileInput.required = !task;
      fileInput.value = '';
      if (task) {
        asinInput.value = task.asin;
        document.getElementById('reuse-description').textContent = `${task.asin} · 来源任务 ${task.id} · 提交于 ${formatTime(task.created_at)}`;
        fileName.textContent = '使用来源任务的数据，无需重新上传';
        submitButton.textContent = '使用原数据生成新报告';
      } else {
        fileName.textContent = '尚未选择文件';
        submitButton.textContent = '提交任务';
      }
      hideMessage(submitMessage);
      if (task) { form.scrollIntoView({ behavior: 'smooth', block: 'start' }); document.getElementById('open-rule-settings').focus({ preventScroll: true }); }
    }
    document.getElementById('cancel-reuse').addEventListener('click', () => selectSource(null));
    document.querySelector('#user-email').textContent = user.email || '已登录';

    document.querySelector('#logout').addEventListener('click', async () => {
      await client.auth.signOut();
      window.location.replace(route('./'));
    });

    fileInput.addEventListener('change', () => {
      fileName.textContent = fileInput.files?.[0]?.name || '尚未选择文件';
    });

    asinInput.addEventListener('input', () => {
      asinInput.value = asinInput.value.toUpperCase();
    });

    async function loadTasks() {
      hideMessage(taskMessage);
      refreshButton.disabled = true;
      try {
        const { data, error } = await client.from('keyword_tasks')
          .select('id,asin,status,created_at,report_url,failure_reason,upload_path,comparison_phase,comparison_request,core_keyword')
          .order('created_at', { ascending: false })
          .limit(config.taskLimit || 10);
        if (error) throw error;
        taskBody.replaceChildren();
        if (!data?.length) {
          const empty = document.createElement('tr');
          const cell = document.createElement('td');
          cell.colSpan = 5;
          cell.className = 'empty-cell';
          cell.textContent = '还没有任务，先提交第一份报表。';
          empty.append(cell);
          taskBody.append(empty);
        } else {
          data.forEach((task) => taskBody.append(taskRow(task, async (t,compare) => {
            if(!compare)return selectSource(t);
            if(submitting)return;
            submitting=true;
            try {
              const {error}=await client.rpc('create_keyword_comparison',{p_task_id:crypto.randomUUID(),p_source_id:t.id,p_core_keyword:'',p_site:'US'});
              if(error)throw error;
              showMessage(submitMessage,'正在根据原留底整理候选，无外部取数。刷新后点击“待选择／确认竞对”。','success');
              await loadTasks();
            }catch(error){showMessage(submitMessage,humanError(error));}finally{submitting=false;}
          }, t => window.KeywordComparison.open(t, app, loadTasks, (source,asins,id)=>selectSource(source,true,asins,id)))));
        }
      } catch (error) {
        showMessage(taskMessage, humanError(error));
      } finally {
        refreshButton.disabled = false;
      }
    }

    refreshButton.addEventListener('click', loadTasks);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (submitting) return;
      hideMessage(submitMessage);
      const analysisRules = window.KeywordRuleSettings.snapshot();
      const asin = asinInput.value.trim().toUpperCase();
      const file = fileInput.files?.[0];
      const source = reuseSource;
      if (!/^B0[A-Z0-9]{8}$/.test(asin)) return showMessage(submitMessage, 'ASIN 必须是 10 位，并以 B0 开头，例如 B09V366BDY。');
      let comparison = null;
      try { if (comparisonEnabled.checked) comparison = window.KeywordComparison.request(asin, [...competitorAsins.querySelectorAll('input')].map(i=>i.value).join('\n'), coreKeyword.value); }
      catch (error) { return showMessage(submitMessage, error.message); }
      if (comparison && (!source || !candidateTaskId)) return showMessage(submitMessage,'请先从已完成任务“查看候选并发起竞对对比”，选择 3–5 家；本次将复用原西柚留底。');
      if (!source && !file) return showMessage(submitMessage, '请选择广告搜索词报表。');
      const extension = (source?.upload_path || file.name).split('.').pop().toLowerCase();
      if (!['xlsx', 'csv'].includes(extension)) return showMessage(submitMessage, '只支持 .xlsx 或 .csv 文件。');
      if (!source && file.size > config.maxUploadBytes) return showMessage(submitMessage, '文件超过 10 MB，请压缩数据范围后重新上传。');

      submitting = true;
      setButtonBusy(submitButton, true, '提交任务', source ? '正在提交重算任务…' : '正在上传…');
      const taskId = crypto.randomUUID();
      const uploadPath = source ? source.upload_path : `${user.id}/${taskId}.${extension}`;
      try {
        if (!source) {
          const contentType = extension === 'csv' ? 'text/csv' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
          const upload = await client.storage.from(config.storageBucket).upload(uploadPath, file, { contentType, upsert: false });
          if (upload.error) throw upload.error;
        }
        const inserted = comparison ? await client.rpc('create_keyword_comparison_request', {
          p_task_id:taskId, p_source_id:source?.id || null, p_asin:asin, p_upload_path:uploadPath,
          p_analysis_rules:analysisRules, p_core_keyword:comparison.coreKeyword, p_site:'US', p_asins:comparison.competitorAsins, p_candidate_task_id:candidateTaskId,
        }) : await client.from('keyword_tasks').insert({
          id: taskId,
          user_id: user.id,
          asin,
          upload_path: uploadPath,
          analysis_rules: analysisRules,
          source_task_id: source?.id || null,
        });
        if (inserted.error) {
          if (!source) await client.storage.from(config.storageBucket).remove([uploadPath]);
          throw inserted.error;
        }
        form.reset();
        window.KeywordRuleSettings.reset();
        submitting = false;
        selectSource(null);
        fileName.textContent = '尚未选择文件';
        showMessage(submitMessage, comparison ? '竞对任务已提交，名单和核心词已保存。关键词阶段完成后，请在最近任务中确认取数费用与特征清洗。' : source ? '重算任务已提交：将复用原数据生成新报告，旧报告保留，不新增外部取数。' : '提交成功，工人将在 30 秒内领取任务。', 'success');
        await loadTasks();
      } catch (error) {
        showMessage(submitMessage, humanError(error));
      } finally {
        submitting = false;
        setButtonBusy(submitButton, false, reuseSource ? '使用原数据生成新报告' : '提交任务', '');
      }
    });

    await loadTasks();
    window.setInterval(loadTasks, config.refreshIntervalMs || 30000);
  }

  start().catch((error) => showMessage(document.querySelector('#submit-message'), humanError(error)));
}());
