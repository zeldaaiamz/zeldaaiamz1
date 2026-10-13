(function () {
  'use strict';
  async function upgrade(html) {
    const report = new DOMParser().parseFromString(html, 'text/html');
    const panel = report.querySelector('[data-module-panel="05"]');
    const menu = report.querySelector('[data-module="05"]');
    if (!panel || !menu || (!panel.querySelector('.placeholder') && panel.dataset.imageModule !== 'design-v1')) return html;
    const section = report.createElement('div');
    section.style.cssText = 'padding:28px;margin:20px;background:white;border:1px solid #d7e4db;border-radius:10px;color:#294438;font:14px/1.8 sans-serif';
    const title = report.createElement('h2'); title.textContent = '图片诊断尚未运行';
    const description = report.createElement('p'); description.textContent = '当前任务尚无已保存的真实图片诊断结果。请打开 04 的“图片诊断准备”，查看图片并提交已确认的买家清单，系统将自动完成图片分析。';
    const status = report.createElement('p'); status.textContent = '未调用视觉模型；这里不展示模拟数据。04 竞对对比已完成；05 将在清单提交后自动分析我方与竞对图片，无需再次确认费用或逐家验收。';
    section.append(title, description, status); panel.replaceChildren(section);
    panel.dataset.imageModule = 'awaiting-real-data';
    menu.classList.remove('upcoming');
    menu.querySelectorAll('small').forEach(el => el.remove());
    const label = report.createElement('small'); label.textContent = '尚未运行'; menu.append(label);
    return '<!doctype html>\n' + report.documentElement.outerHTML;
  }
  window.KeywordBattleImageModule = Object.freeze({ upgrade });
}());
