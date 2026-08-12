(function () {
  'use strict';

  const page = document.body.dataset.page;
  const config = window.APP_CONFIG || {};
  const rootUrl = new URL(page === 'auth' ? './' : '../', window.location.href);
  const route = (path) => new URL(path, rootUrl).href;
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
    if (/row-level security|permission|not authorized/i.test(message)) return '当前账户没有执行此操作的权限。';
    return `操作失败：${message}`;
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
      const returnTo = `${window.location.pathname}${window.location.search}`;
      window.location.replace(`${route('./')}?returnTo=${encodeURIComponent(returnTo)}`);
      return null;
    }
    return session;
  }

  function safeReturnTo() {
    const value = new URLSearchParams(window.location.search).get('returnTo');
    const basePath = new URL('./', rootUrl).pathname;
    if (!value || !value.startsWith(basePath) || value.startsWith('//')) return route('tool/');
    return new URL(value, window.location.origin).href;
  }

  function setButtonBusy(button, busy, idleText, busyText) {
    button.disabled = busy;
    button.textContent = busy ? busyText : idleText;
  }

  function statusClass(status) {
    return ({ '待处理': 'waiting', '进行中': 'running', '已完成': 'done', '失败': 'failed' })[status] || 'neutral';
  }

  function formatTime(value) {
    if (!value) return '—';
    return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
  }

  if (!client || /__SUPABASE_/.test(config.supabaseUrl || '') || /__SUPABASE_/.test(config.supabaseAnonKey || '')) {
    showMessage(document.querySelector('.message') || document.body, '操作失败：前台尚未写入 Supabase 公共配置');
    return;
  }

  window.KeywordBattle = Object.freeze({
    client,
    config,
    route,
    showMessage,
    hideMessage,
    humanError,
    getSession,
    requireSession,
    safeReturnTo,
    setButtonBusy,
    statusClass,
    formatTime,
  });
}());
