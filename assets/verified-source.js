(function (root) {
  'use strict';

  const fields = 'status,sha256,size,error';
  const timeoutMs = 90000;
  const sourceError = (message, code) => Object.assign(Error(message), {code});

  async function sha256(bytes) {
    return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
      .map(value => value.toString(16).padStart(2, '0')).join('');
  }

  function requireVerified(manifest) {
    if (manifest?.status === 'missing') {
      throw sourceError(manifest.error || '原始广告报表缺失', 'SOURCE_MISSING');
    }
    if (manifest?.status === 'error') {
      throw sourceError(manifest.error || '原始广告报表来源校验失败', 'SOURCE_UNVERIFIED');
    }
    if (manifest?.status !== 'verified' || !/^[0-9a-f]{64}$/.test(manifest.sha256 || '')) {
      throw sourceError('原始广告报表尚未通过来源校验，请稍后刷新', 'SOURCE_PENDING');
    }
    return manifest;
  }

  function withSignal(request, signal) {
    return typeof request.abortSignal === 'function' ? request.abortSignal(signal) : request;
  }

  async function manifestFor(app, path, signal) {
    const result = await withSignal(
      app.client.from('keyword_upload_versions').select(fields).eq('path', path), signal
    ).maybeSingle();
    if (result.error) throw result.error;
    return result.data;
  }

  async function waitForVerification(app, path, {expected, onPending} = {}) {
    const signal = AbortSignal.timeout(timeoutMs);
    try {
      let result = await withSignal(app.client.rpc('request_keyword_upload_verification', {p_path:path}), signal);
      if (result.error) throw result.error;
      let manifest = result.data;
      if (manifest?.status === 'pending') {
        onPending?.();
        while (manifest?.status === 'pending') {
          await new Promise(resolve => setTimeout(resolve, 1200));
          signal.throwIfAborted();
          manifest = await manifestFor(app, path, signal);
        }
      }
      const verified = requireVerified(manifest);
      if (expected && (verified.sha256 !== expected.sha || Number(verified.size) !== expected.size)) {
        throw sourceError('上传文件与所选原件的来源校验不一致，请重新选择文件', 'SOURCE_MISMATCH');
      }
      return verified;
    } catch (error) {
      if (signal.aborted) throw sourceError('来源正在校验。已保留本次上传与提交资料，请稍后用同一资料重试。', 'SOURCE_PENDING');
      throw error;
    }
  }

  async function readVerifiedSource(app, path, {signal: outerSignal} = {}) {
    const deadline = AbortSignal.timeout(15000);
    const signal = outerSignal ? AbortSignal.any([outerSignal,deadline]) : deadline;
    const manifest = requireVerified(await manifestFor(app,path,signal));
    const request = app.client.storage.from(app.config.storageBucket).download(path,undefined,{signal,cache:'no-store'});
    const result = await request.asStream();
    if (result.error || !result.data) throw sourceError('已验证的原始广告报表当前无法读取', 'SOURCE_UNAVAILABLE');

    const reader = result.data.getReader();
    const chunks = [];
    let size = 0;
    try {
      while (true) {
        const {done,value} = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > app.config.maxUploadBytes) {
          await reader.cancel().catch(()=>{});
          throw sourceError('原始广告报表超过 10 MB，无法校验', 'SOURCE_MISMATCH');
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const blob = new Blob(chunks,{type:path.endsWith('.csv')?'text/csv':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
    const bytes = await blob.arrayBuffer();
    if (size !== Number(manifest.size) || await sha256(bytes) !== manifest.sha256) {
      throw sourceError('存储文件与已验证来源校验不一致，下载已停止', 'SOURCE_MISMATCH');
    }
    return {blob,bytes};
  }

  root.KeywordVerifiedSource = Object.freeze({sha256,waitForVerification,readVerifiedSource});
})(window);
