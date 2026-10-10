(function () {
  'use strict';
  const vocRoot = new URL('../', document.currentScript.src);
  const siteRoot = new URL('../', vocRoot);
  const config = window.APP_CONFIG;
  const client = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);
  function el(tag, text, className) { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; }
  function message(node, text) { node.textContent = text || ''; node.hidden = !text; }
  async function session() {
    const { data, error } = await client.auth.getSession(); if (error) throw error;
    if (!data.session) { const login = new URL(siteRoot); login.searchParams.set('returnTo', location.pathname + location.search); location.replace(login); return null; }
    return data.session;
  }
  const reportPath = (task) => typeof task.report_path === 'string' && new RegExp('^voc/' + task.id + '-[A-Za-z0-9_-]{8,64}\\.html$').test(task.report_path);
  window.VOC = { client, config, session, el, message, vocRoot, reportPath };
}());
