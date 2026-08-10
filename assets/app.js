(function () {
  'use strict';

  const page = document.body.dataset.page;
  const config = window.APP_CONFIG || {};
  const rootUrl = new URL(page === 'auth' ? './' : '../', window.location.href);
  const route = (path) => new URL(path, rootUrl).href;
  const recoveryRequested = new URLSearchParams(window.location.hash.slice(1)).get('type') === 'recovery'
    || new URLSearchParams(window.location.search).get('type') === 'recovery';
  const client = window.supabase?.createClient?.(config.supabaseUrl, config.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });

  function showMessage(element, text, type = 'error') {
    if (!element) return;
    element.textContent = text;
    element.className = `message ${type}`;
    element.hidden = false;
  }

  function hideMessage(element) {
    if (element) element.hidden = true;
  }

  function humanError(error) {
    const message = String(error?.message || error || '发生未知错误');
    if (/invalid login credentials/i.test(message)) return '邮箱或密码不正确；已有账号再次注册不会覆盖旧密码，可以使用“忘记密码”重置。';
    if (/email not confirmed/i.test(message)) return '邮箱尚未确认，请先打开确认邮件。';
    if (/user already registered/i.test(message)) return '这个邮箱已经注册，请直接登录。';
    if (/password should be at least/i.test(message)) return '密码至少需要 8 位。';
    if (/failed to fetch|network/i.test(message)) return '网络连接失败，请稍后重试。';
    if (/row-level security|permission/i.test(message)) return '当前账户没有执行此操作的权限。';
    return `操作失败：${message}`;
  }

  function splitProfileItems(value) {
    return String(value || '')
      .split(/[\n；;]+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  async function getSession() {
    if (!client) throw new Error('前台配置未完成');
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    return data.session;
  }

  async function requireSession() {
    const session = await getSession();
    if (!session) {
      window.location.replace(route('./'));
      return null;
    }
    return session;
  }

  function setButtonBusy(button, busy, idleText, busyText) {
    button.disabled = busy;
    button.textContent = busy ? busyText : idleText;
  }

  async function initAuth() {
    let mode = recoveryRequested ? 'recovery' : 'login';
    const form = document.querySelector('#auth-form');
    const submit = document.querySelector('#auth-submit');
    const message = document.querySelector('#auth-message');
    const title = document.querySelector('#auth-title');
    const description = document.querySelector('#auth-description');
    const tabs = document.querySelector('#auth-tabs');
    const emailGroup = document.querySelector('#email-group');
    const emailInput = document.querySelector('#email');
    const confirmGroup = document.querySelector('#confirm-group');
    const password = document.querySelector('#password');
    const passwordLabel = document.querySelector('#password-label');
    const confirmPassword = document.querySelector('#confirm-password');
    const forgotPassword = document.querySelector('#forgot-password');

    function renderMode(nextMode) {
      mode = nextMode;
      const registering = mode === 'register';
      const recovering = mode === 'recovery';
      tabs.hidden = recovering;
      emailGroup.hidden = recovering;
      emailInput.required = !recovering;
      title.textContent = recovering ? '设置新密码' : registering ? '创建账户' : '登录你的工作台';
      description.textContent = recovering
        ? '输入两次新密码，保存后即可继续使用。'
        : registering ? '注册后请按邮件提示完成邮箱确认。' : '使用邮箱和密码继续。';
      submit.textContent = recovering ? '保存新密码' : registering ? '注册' : '登录';
      passwordLabel.textContent = recovering ? '新密码' : '密码';
      password.autocomplete = registering || recovering ? 'new-password' : 'current-password';
      confirmGroup.hidden = !registering && !recovering;
      confirmPassword.required = registering || recovering;
      forgotPassword.hidden = mode !== 'login';
      hideMessage(message);
    }

    client.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') renderMode('recovery');
    });

    const session = await getSession();
    if (session && mode !== 'recovery') {
      window.location.replace(route('tool/'));
      return;
    }

    renderMode(mode);

    document.querySelectorAll('[data-auth-mode]').forEach((button) => {
      button.addEventListener('click', () => {
        renderMode(button.dataset.authMode);
        document.querySelectorAll('[data-auth-mode]').forEach((item) => {
          const active = item === button;
          item.classList.toggle('active', active);
          item.setAttribute('aria-selected', String(active));
        });
      });
    });

    forgotPassword.addEventListener('click', async () => {
      hideMessage(message);
      const email = emailInput.value.trim();
      if (!email) return showMessage(message, '请先填写需要重置密码的邮箱。');
      forgotPassword.disabled = true;
      forgotPassword.textContent = '正在发送…';
      try {
        const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: route('') });
        if (error) throw error;
        showMessage(message, '重置邮件已发送，请检查收件箱和垃圾邮件。', 'success');
      } catch (error) {
        showMessage(message, humanError(error));
      } finally {
        forgotPassword.disabled = false;
        forgotPassword.textContent = '忘记密码？发送重置邮件';
      }
    });

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      hideMessage(message);
      const email = emailInput.value.trim();
      const passwordValue = password.value;
      if (mode !== 'recovery' && (!email || !passwordValue)) return showMessage(message, '请填写邮箱和密码。');
      if (mode === 'recovery' && !passwordValue) return showMessage(message, '请填写新密码。');
      if (passwordValue.length < 8) return showMessage(message, '密码至少需要 8 位。');
      if ((mode === 'register' || mode === 'recovery') && passwordValue !== confirmPassword.value) return showMessage(message, '两次输入的密码不一致。');

      const idleText = mode === 'recovery' ? '保存新密码' : mode === 'register' ? '注册' : '登录';
      const busyText = mode === 'recovery' ? '正在保存…' : mode === 'register' ? '正在注册…' : '正在登录…';
      setButtonBusy(submit, true, idleText, busyText);
      try {
        if (mode === 'recovery') {
          const { error } = await client.auth.updateUser({ password: passwordValue });
          if (error) throw error;
          showMessage(message, '密码修改成功，正在进入工具台。', 'success');
          window.setTimeout(() => window.location.assign(route('tool/')), 800);
        } else if (mode === 'register') {
          const { data, error } = await client.auth.signUp({
            email,
            password: passwordValue,
            options: { emailRedirectTo: route('') },
          });
          if (error) throw error;
          if (data.session) window.location.assign(route('tool/'));
          else showMessage(message, '注册成功，请打开确认邮件后再登录。', 'success');
        } else {
          const { error } = await client.auth.signInWithPassword({ email, password: passwordValue });
          if (error) throw error;
          window.location.assign(route('tool/'));
        }
      } catch (error) {
        showMessage(message, humanError(error));
      } finally {
        setButtonBusy(submit, false, idleText, '');
      }
    });
  }

  function statusClass(status) {
    return ({ '待处理': 'waiting', '进行中': 'running', '已完成': 'done', '失败': 'failed' })[status] || 'neutral';
  }

  function formatTime(value) {
    if (!value) return '—';
    return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
  }

  function taskRow(task) {
    const row = document.createElement('tr');
    const values = [formatTime(task.created_at), task.asin, task.status, task.failure_reason || '—'];
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
    } else {
      actionCell.textContent = '—';
    }
    row.append(actionCell);
    return row;
  }

  async function initTool() {
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
    const profileStatus = document.querySelector('#profile-status');
    const productNameInput = document.querySelector('#product-name');
    const productTitleInput = document.querySelector('#product-title');
    const productFeaturesInput = document.querySelector('#product-features');
    const productScenesInput = document.querySelector('#product-scenes');
    let lookupTimer;
    let lookupSequence = 0;
    document.querySelector('#user-email').textContent = user.email || '已登录';

    document.querySelector('#logout').addEventListener('click', async () => {
      await client.auth.signOut();
      window.location.replace(route('./'));
    });

    fileInput.addEventListener('change', () => {
      fileName.textContent = fileInput.files?.[0]?.name || '尚未选择文件';
    });

    function setProfileStatus(text, state = '') {
      profileStatus.textContent = text;
      profileStatus.className = `profile-status${state ? ` ${state}` : ''}`;
    }

    function clearProfileFields() {
      productNameInput.value = '';
      productTitleInput.value = '';
      productFeaturesInput.value = '';
      productScenesInput.value = '';
    }

    async function loadProductProfile() {
      const asin = asinInput.value.trim().toUpperCase();
      asinInput.value = asin;
      const sequence = ++lookupSequence;
      if (!/^B0[A-Z0-9]{8}$/.test(asin)) {
        clearProfileFields();
        setProfileStatus('输入完整 ASIN 后查询已绑定资料。');
        return;
      }

      setProfileStatus('正在查询已绑定资料…');
      try {
        const { data, error } = await client.from('product_profiles')
          .select('product_name,product_title,product_features,product_scenes')
          .eq('user_id', user.id)
          .eq('asin', asin)
          .maybeSingle();
        if (error) throw error;
        if (sequence !== lookupSequence) return;
        if (!data) {
          clearProfileFields();
          setProfileStatus('这是新的 ASIN，请填写四项资料；提交后会保存绑定。', 'new');
          return;
        }
        productNameInput.value = data.product_name || '';
        productTitleInput.value = data.product_title || '';
        productFeaturesInput.value = (data.product_features || []).join('\n');
        productScenesInput.value = (data.product_scenes || []).join('\n');
        setProfileStatus('已自动带出绑定资料；本次修改会在提交任务时保存。', 'found');
      } catch (error) {
        if (sequence === lookupSequence) setProfileStatus(humanError(error));
      }
    }

    asinInput.addEventListener('input', () => {
      asinInput.value = asinInput.value.toUpperCase();
      window.clearTimeout(lookupTimer);
      lookupTimer = window.setTimeout(loadProductProfile, 350);
    });
    asinInput.addEventListener('blur', () => {
      window.clearTimeout(lookupTimer);
      loadProductProfile();
    });

    async function loadTasks() {
      hideMessage(taskMessage);
      refreshButton.disabled = true;
      try {
        const { data, error } = await client.from('keyword_tasks')
          .select('id,asin,status,created_at,report_url,failure_reason')
          .order('created_at', { ascending: false })
          .limit(config.taskLimit || 10);
        if (error) throw error;
        taskBody.replaceChildren();
        if (!data?.length) {
          const empty = document.createElement('tr');
          empty.innerHTML = '<td colspan="5" class="empty-cell">还没有任务，先提交第一份报表。</td>';
          taskBody.append(empty);
        } else {
          data.forEach((task) => taskBody.append(taskRow(task)));
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
      hideMessage(submitMessage);
      const asin = asinInput.value.trim().toUpperCase();
      const file = fileInput.files?.[0];
      const productName = productNameInput.value.trim();
      const productTitle = productTitleInput.value.trim();
      const features = splitProfileItems(productFeaturesInput.value);
      const scenes = splitProfileItems(productScenesInput.value);
      if (!/^B0[A-Z0-9]{8}$/.test(asin)) return showMessage(submitMessage, 'ASIN 必须是 10 位，并以 B0 开头，例如 B09V366BDY。');
      if (!productName) return showMessage(submitMessage, '请填写产品名称。');
      if (!productTitle) return showMessage(submitMessage, '请填写产品标题。');
      if (!features.length) return showMessage(submitMessage, '请至少填写一项产品功能。');
      if (!scenes.length) return showMessage(submitMessage, '请至少填写一个产品场景。');
      if (!file) return showMessage(submitMessage, '请选择广告搜索词报表。');
      const extension = file.name.split('.').pop().toLowerCase();
      if (!['xlsx', 'csv'].includes(extension)) return showMessage(submitMessage, '只支持 .xlsx 或 .csv 文件。');
      if (file.size > config.maxUploadBytes) return showMessage(submitMessage, '文件超过 10 MB，请压缩数据范围后重新上传。');

      setButtonBusy(submitButton, true, '提交任务', '正在上传…');
      const taskId = crypto.randomUUID();
      const uploadPath = `${user.id}/${taskId}.${extension}`;
      try {
        const savedProfile = await client.from('product_profiles').upsert({
          user_id: user.id,
          asin,
          product_name: productName,
          product_title: productTitle,
          product_features: features,
          product_scenes: scenes,
        }, { onConflict: 'user_id,asin' });
        if (savedProfile.error) throw savedProfile.error;

        const contentType = extension === 'csv' ? 'text/csv' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        const upload = await client.storage.from(config.storageBucket).upload(uploadPath, file, { contentType, upsert: false });
        if (upload.error) throw upload.error;
        const inserted = await client.from('keyword_tasks').insert({
          id: taskId,
          user_id: user.id,
          asin,
          upload_path: uploadPath,
          product_profile: {
            productName,
            productTitle,
            features,
            scenes,
          },
        });
        if (inserted.error) {
          await client.storage.from(config.storageBucket).remove([uploadPath]);
          throw inserted.error;
        }
        form.reset();
        fileName.textContent = '尚未选择文件';
        setProfileStatus('输入完整 ASIN 后查询已绑定资料。');
        showMessage(submitMessage, '提交成功，工人将在 30 秒内领取任务。', 'success');
        await loadTasks();
      } catch (error) {
        showMessage(submitMessage, humanError(error));
      } finally {
        setButtonBusy(submitButton, false, '提交任务', '');
      }
    });

    await loadTasks();
    window.setInterval(loadTasks, config.refreshIntervalMs || 30000);
  }

  async function initReport() {
    const session = await requireSession();
    if (!session) return;
    const taskId = new URLSearchParams(window.location.search).get('task');
    const message = document.querySelector('#report-message');
    const loading = document.querySelector('#report-loading');
    const view = document.querySelector('#report-view');
    const frame = document.querySelector('#report-frame');
    const status = document.querySelector('#report-status');
    const meta = document.querySelector('#report-meta');
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
          .select('id,asin,status,created_at,report_url,failure_reason')
          .eq('id', taskId)
          .maybeSingle();
        if (error) throw error;
        if (!task) throw new Error('找不到这个任务，或它不属于当前账户');
        document.querySelector('#report-title').textContent = `${task.asin} · 关键词作战总表`;
        meta.textContent = `提交于 ${formatTime(task.created_at)}`;
        status.className = `status-badge ${statusClass(task.status)}`;
        status.innerHTML = `<i></i>${task.status}`;

        if (task.status === '失败') {
          loading.hidden = true;
          showMessage(message, task.failure_reason ? `任务失败：${task.failure_reason}` : '任务失败，请返回工具页查看原因。');
          return;
        }
        if (task.status !== '已完成' || !task.report_url) {
          loading.hidden = false;
          return;
        }

        const response = await fetch(task.report_url, { cache: 'no-store' });
        if (!response.ok) throw new Error(`报告读取失败（HTTP ${response.status}）`);
        frame.srcdoc = await response.text();
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

  async function start() {
    try {
      if (!client || /__SUPABASE_/.test(config.supabaseUrl || '') || /__SUPABASE_/.test(config.supabaseAnonKey || '')) {
        throw new Error('前台尚未写入 Supabase 公共配置');
      }
      if (page === 'auth') await initAuth();
      else if (page === 'tool') await initTool();
      else if (page === 'report') await initReport();
    } catch (error) {
      const target = document.querySelector('.message') || document.body;
      showMessage(target, humanError(error));
    }
  }

  start();
}());
