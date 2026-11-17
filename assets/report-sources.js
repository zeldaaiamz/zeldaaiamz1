(function () {
  'use strict';

  function node(tag, text) {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function open(app, task, onSaved) {
    let dialog = document.querySelector('#report-source-dialog');
    if (!dialog) {
      dialog = node('dialog');
      dialog.id = 'report-source-dialog';
      dialog.setAttribute('aria-labelledby','report-source-title');
      document.body.append(dialog);
    }
    dialog.replaceChildren();
    const head = node('div');
    head.className = 'panel-title';
    const title = node('h2', '补齐原始广告报表 · '+task.asin);
    title.id = 'report-source-title';
    const close = node('button', '关闭');
    close.type = 'button';
    close.className = 'secondary-button';
    close.onclick = () => dialog.close();
    head.append(title,close);
    dialog.append(head,node('p','搜索词报表可能没有 ASIN 字段，请核对文件归属。补齐后可从现有报告下载原文件。'));

    const form = node('form');
    const fileLabel = node('label', '选择原始广告报表（CSV / XLSX，最多10MB）');
    const file = node('input');
    file.type = 'file';
    file.accept = '.csv,.xlsx';
    file.required = true;
    fileLabel.append(file);
    const preview = node('p', '尚未选择文件');
    preview.setAttribute('role', 'status');
    const asinLabel = node('label', '输入本报告 ASIN 以确认文件归属');
    const asin = node('input');
    asin.type = 'text';
    asin.maxLength = 10;
    asin.required = true;
    asin.setAttribute('aria-label', '确认原报表 ASIN');
    asinLabel.append(asin);
    const confirmLabel = node('label');
    const confirm = node('input');
    confirm.type = 'checkbox';
    confirm.required = true;
    confirmLabel.append(confirm, document.createTextNode(' 我已核对：该文件是此 ASIN 对应的原始广告报表，日期与文件内容一致。'));
    const message = node('p');
    message.className = 'message';
    message.hidden = true;
    message.setAttribute('role', 'status');
    const save = node('button', '保存原报表（不重新分析）');
    save.type = 'submit';
    save.className = 'primary-button';
    save.disabled = true;
    form.append(fileLabel, preview, asinLabel, confirmLabel, message, save);
    dialog.append(form);

    let parsed = null;
    let busy = false;
    let version = 0;
    let pending = null;
    const pendingKey = 'keyword-pending-source:'+task.id;
    try {pending=JSON.parse(sessionStorage.getItem(pendingKey)||'null');} catch {}
    function keepPending() {
      if (pending) sessionStorage.setItem(pendingKey,JSON.stringify(pending));
      else sessionStorage.removeItem(pendingKey);
    }
    dialog.oncancel = event => {if (busy) event.preventDefault();};

    file.onchange = async () => {
      const selection = ++version;
      parsed = null;
      save.disabled = true;
      app.hideMessage(message);
      const chosen = file.files?.[0];
      if (!chosen) return;
      try {
        if (!/\.(csv|xlsx)$/i.test(chosen.name) || !chosen.size || chosen.size > app.config.maxUploadBytes) {
          throw Error('请选择非空且不超过10MB的 CSV 或 XLSX 文件');
        }
        const bytes = await chosen.arrayBuffer();
        const ranges = window.KeywordHistoryMetadata.uploadRanges(bytes,chosen.name);
        if (!ranges.length) throw Error('未读取到“开始日期 / 结束日期”或“Start Date / End Date”，请使用完整原始广告报表');
        const sha = await window.KeywordVerifiedSource.sha256(bytes);
        if (selection !== version) return;
        parsed = {file:chosen,ranges,sha};
        preview.textContent = chosen.name+' · 广告报表日期范围：'+ranges.join('；');
        save.disabled = false;
      } catch (error) {
        if (selection === version) {
          preview.textContent = '文件尚未通过核对';
          app.showMessage(message, app.humanError(error));
        }
      }
    };

    form.onsubmit = async event => {
      event.preventDefault();
      if (busy || !parsed) return;
      if (asin.value.trim().toUpperCase() !== task.asin || !confirm.checked) {
        app.showMessage(message, '请核对 ASIN 并确认文件归属');
        return;
      }
      busy = true;
      save.disabled = close.disabled = file.disabled = asin.disabled = confirm.disabled = true;
      try {
        const session = await app.requireSession();
        if (!session) throw Error('请先登录');
        const expected = {sha:parsed.sha,size:parsed.file.size};
        if (pending && (pending.sha !== expected.sha || !pending.path?.startsWith(session.user.id+'/'))) {
          throw Error('上次补齐提交仍待核实，请选择同一份文件后重试');
        }
        const isCsv = /\.csv$/i.test(parsed.file.name);
        if (!pending) {
          pending = {path:session.user.id+'/'+crypto.randomUUID()+(isCsv?'.csv':'.xlsx'),sha:expected.sha,uploaded:false};
          keepPending();
        }
        if (!pending.uploaded) {
          const result = await app.client.storage.from(app.config.storageBucket).upload(pending.path,parsed.file,{
            upsert:false,
            contentType:isCsv?'text/csv':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          });
          if (result.error && String(result.error.statusCode)!=='409' && !/already exists|duplicate/i.test(result.error.message||'')) throw result.error;
          pending.uploaded = true;
          keepPending();
        }
        await window.KeywordVerifiedSource.waitForVerification(app,pending.path,{
          expected,onPending:()=>app.showMessage(message,'正在校验补齐报表的实际文件，请稍候。','')
        });
        const result = await app.client.rpc('attach_keyword_report_source',{
          p_task_id:task.id,p_asin:task.asin,p_upload_path:pending.path,p_filename:parsed.file.name,
          p_sha256:parsed.sha,p_date_ranges:parsed.ranges,p_revision:task.recovered_source?.revision||0,p_confirm:true
        });
        if (result.error) throw result.error;
        if (!result.data?.upload_path) throw Error('保存结果未确认，请刷新核对；已上传文件保留');
        task.recovered_source = result.data;
        pending = null;
        keepPending();
        save.hidden = true;
        await onSaved();
        app.showMessage(message,'原报表和日期范围已补齐；已有报告未改动，未新增付费调用。','success');
      } catch (error) {
        if (['SOURCE_MISSING','SOURCE_UNVERIFIED','SOURCE_MISMATCH'].includes(error.code)) {
          pending = null;
          keepPending();
        }
        app.showMessage(message,app.humanError(error)+'；已上传文件保留。');
      } finally {
        busy = false;
        save.disabled = close.disabled = false;
        file.disabled = asin.disabled = confirm.disabled = save.hidden;
      }
    };
    window.KeywordDialogFlow.open(dialog);
  }

  window.KeywordReportSources = {open};
})();
