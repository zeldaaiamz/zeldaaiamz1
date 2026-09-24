(function () {
  'use strict';
  async function start() {
    if (!window.KeywordBattle) throw new Error('前台配置加载失败，请返回工具页重试。');
    const session = await window.KeywordBattle.requireSession();
    if (!session) return;
    document.body.style.visibility = 'visible';
  }
  start().catch(() => {
    document.body.replaceChildren();
    const message = document.createElement('p');
    message.textContent = '页面加载失败，请返回工具页重试。';
    const link = document.createElement('a');
    link.href = '../tool/'; link.textContent = '返回工具页';
    document.body.append(message, link);
    document.body.style.visibility = 'visible';
  });
}());
