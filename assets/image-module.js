(function () {
  'use strict';
  const root = new URL('../', document.currentScript.src);
  let assets;
  async function loadAssets() {
    if (!assets) assets = Promise.all(['index.html', 'styles.css', 'app.js'].map(async name => {
      const response = await fetch(new URL(`image-diagnosis/${name}`, root));
      if (!response.ok) throw new Error('图片模块资源加载失败');
      return response.text();
    })).catch(error => { assets = null; throw error; });
    return assets;
  }
  async function upgrade(html) {
    const report = new DOMParser().parseFromString(html, 'text/html');
    const panel = report.querySelector('[data-module-panel="05"]');
    const menu = report.querySelector('[data-module="05"]');
    // Preserve any real diagnosis already present in a report.
    if (!panel || !menu || !panel.querySelector('.placeholder')) return html;
    const [markup, css, script] = await loadAssets();
    const view = new DOMParser().parseFromString(markup, 'text/html');
    view.querySelectorAll('script, link[rel="stylesheet"], .sidebar, .top, .modules, noscript').forEach(el => el.remove());
    view.body.removeAttribute('style');
    view.body.removeAttribute('data-page');
    const style = view.createElement('style');
    style.textContent = css + '\nmain{margin:0;max-width:none;padding:16px}body{background:#f3f6f3}#notice{bottom:12px}.page-foot{margin-bottom:15px}';
    view.head.append(style);
    const controls = view.createElement('script');
    controls.textContent = script.replace(/<\/script/gi, '<\\/script');
    view.body.append(controls);
    const frame = report.createElement('iframe');
    frame.title = '05 图片与卖点诊断 · 交互示例';
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.style.cssText = 'display:block;width:100%;height:calc(100vh - 110px);min-height:740px;border:0;background:#f3f6f3';
    frame.srcdoc = '<!doctype html>\n' + view.documentElement.outerHTML;
    const note = report.createElement('div');
    note.style.cssText = 'padding:12px 20px;background:#fff8e8;border-bottom:1px solid #eadfbe;color:#80652e;font:12px/1.7 sans-serif';
    note.textContent = '05 界面已接入报告。本任务尚未运行真实图片诊断；下面是交互示例，确认操作仅用于演示，不写入任务、不调用模型。';
    panel.replaceChildren(note, frame);
    panel.dataset.imageModule = 'design-v1';
    menu.classList.remove('upcoming');
    const label = menu.querySelector('small') || report.createElement('small');
    label.textContent = '界面已接入 · 待真实诊断';
    if (!label.parentNode) menu.append(label);
    return '<!doctype html>\n' + report.documentElement.outerHTML;
  }
  window.KeywordBattleImageModule = Object.freeze({ upgrade });
}());
