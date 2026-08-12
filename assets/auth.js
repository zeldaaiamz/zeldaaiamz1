(function () {
  'use strict';

  const app = window.KeywordBattle;
  if (!app) return;
  const { client, route, showMessage, hideMessage, humanError, getSession, safeReturnTo, setButtonBusy } = app;
  const recoveryRequested = new URLSearchParams(window.location.hash.slice(1)).get('type') === 'recovery'
    || new URLSearchParams(window.location.search).get('type') === 'recovery';

  async function start() {
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
      window.location.replace(safeReturnTo());
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
          if (data.session) window.location.assign(safeReturnTo());
          else showMessage(message, '注册成功，请打开确认邮件后再登录。', 'success');
        } else {
          const { error } = await client.auth.signInWithPassword({ email, password: passwordValue });
          if (error) throw error;
          window.location.assign(safeReturnTo());
        }
      } catch (error) {
        showMessage(message, humanError(error));
      } finally {
        setButtonBusy(submit, false, idleText, '');
      }
    });
  }

  start().catch((error) => showMessage(document.querySelector('#auth-message'), humanError(error)));
}());
