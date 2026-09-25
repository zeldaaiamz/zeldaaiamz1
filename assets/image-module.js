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
    const description = report.createElement('p'); description.textContent = '当前任务尚无已保存的真实图片诊断结果。请先完成 04 图片资料准备，再在对话内确认买家清单与调用费用。';
    const status = report.createElement('p'); status.textContent = '未调用视觉模型；这里不展示模拟数据。顶部“已完成”仅表示原关键词任务完成。';
    section.append(title, description, status); panel.replaceChildren(section);
    panel.dataset.imageModule = 'awaiting-real-data';
    menu.classList.remove('upcoming');
    menu.querySelectorAll('small').forEach(el => el.remove());
    const label = report.createElement('small'); label.textContent = '尚未运行'; menu.append(label);
    return '<!doctype html>\n' + report.documentElement.outerHTML;
  }
  window.KeywordBattleImageModule = Object.freeze({ upgrade });
}());
