(function () {
  'use strict';
  function upgrade(html) {
    const report = new DOMParser().parseFromString(html, 'text/html');
    const panel = report.querySelector('[data-module-panel="06"]');
    const menu = report.querySelector('[data-module="06"]');
    if (!panel || !menu || !panel.querySelector('.placeholder')) return html;
    const section = report.createElement('div');
    section.style.cssText = 'padding:28px;margin:20px;background:white;border:1px solid #d7e4db;border-radius:10px;color:#294438;font:14px/1.8 sans-serif';
    const title = report.createElement('h2'); title.textContent = '广告诊断与优化';
    const description = report.createElement('p'); description.textContent = '广告模块使用创建本任务时已上传的报表，无需再次上传。';
    const status = report.createElement('p'); status.textContent = '这份历史报告尚无已生成的广告诊断记录。请返回任务页，选择本任务「用原数据重新分析」生成包含 06 的新报告。';
    const note = report.createElement('p'); note.textContent = '原报告保持不变；未读取到真实结果时，不展示演示数据。';
    section.append(title, description, status, note); panel.replaceChildren(section);
    panel.dataset.adModule = 'awaiting-task-data'; menu.classList.remove('upcoming');
    menu.querySelectorAll('small').forEach(el => el.remove());
    const label = report.createElement('small'); label.textContent = '待生成'; menu.append(label);
    return '<!doctype html>\n'+report.documentElement.outerHTML;
  }
  window.KeywordBattleAdModule = Object.freeze({ upgrade });
}());
