'use strict';
competitorControls('#view-demo .cc-root');

const tabs = [...document.querySelectorAll('[data-view]')];
function activate(button) {
  tabs.forEach(tab => {
    const active = tab === button;
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
    document.getElementById(`view-${tab.dataset.view}`).hidden = !active;
  });
}
tabs.forEach((button, index) => {
  button.addEventListener('click', () => activate(button));
  button.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    activate(tabs[next]); tabs[next].focus();
  });
});
activate(tabs[0]);
const form = document.getElementById('comparison-form');
const container = document.getElementById('asin-rows');
const add = document.getElementById('add-asin');
const message = document.getElementById('form-message');
const checks = [...document.querySelectorAll('[data-candidate]')];
const inputs = () => [...container.querySelectorAll('[name="competitorAsin"]')];
function update() {
  const values = inputs().map(input => input.value.trim().toUpperCase()).filter(Boolean);
  const distinct = new Set(values);
  document.getElementById('selected-count').textContent = `${distinct.size} / 5`;
  document.getElementById('candidate-count').textContent = distinct.size ? `已填写 ${distinct.size} 家竞对` : '尚未选择';
  document.getElementById('detail-count').textContent = distinct.size ? `${distinct.size + 1} 个 ASIN` : '待选择';
  add.disabled = inputs().length >= 5;
  checks.forEach(check => { check.checked = distinct.has(check.dataset.candidate); check.disabled = !check.checked && inputs().length >= 5 && !inputs().some(i => !i.value.trim()); });
  message.textContent = ''; message.className = '';
}
function addRow(asin = '') {
  if (inputs().length >= 5) return;
  const row = document.createElement('div'); row.className = 'asin-row';
  row.innerHTML = '<span class="role">竞对</span><label>竞对 ASIN<input name="competitorAsin" maxlength="10" placeholder="10 位 ASIN" required></label><button class="remove" type="button">移除</button>';
  const input = row.querySelector('input'); input.value = asin;
  row.querySelector('button').setAttribute('aria-label', '移除此竞对');
  row.querySelector('button').addEventListener('click', () => { row.remove(); update(); });
  container.append(row); update(); return input;
}
add.addEventListener('click', () => addRow()?.focus());
checks.forEach(check => check.addEventListener('change', () => {
  if (check.checked) {
    const empty = inputs().find(i => !i.value.trim());
    if (empty) empty.value = check.dataset.candidate;
    else addRow(check.dataset.candidate);
  } else inputs().filter(i => i.value.trim().toUpperCase() === check.dataset.candidate).forEach(i => i.closest('.asin-row').remove());
  update();
}));
container.addEventListener('input', event => { if (event.target.tagName === 'INPUT') event.target.value = event.target.value.toUpperCase(); update(); });
form.elements.coreKeyword.addEventListener('input', () => { message.textContent = ''; });
form.addEventListener('submit', event => {
  event.preventDefault();
  const own = form.elements.ownAsin.value.trim().toUpperCase();
  const competitors = inputs().map(i => i.value.trim().toUpperCase());
  const all = [own, ...competitors];
  message.className = '';
  if (competitors.length < 3 || competitors.length > 5) { message.textContent = '请选择或填写 3–5 家竞对。'; return; }
  if (all.some(asin => !/^[A-Z0-9]{10}$/.test(asin))) { message.textContent = '每个 ASIN 需要是 10 位字母或数字。'; return; }
  if (new Set(all).size !== all.length) { message.textContent = '我方与竞对 ASIN 不能重复。'; return; }
  message.className = 'success';
  message.textContent = `本地检查通过：我方 ${own}，竞对 ${competitors.length} 家；产品详情 ${all.length} 个 ASIN，品类特征 1 次。核心词：${form.elements.coreKeyword.value.trim() || '留空，使用总表流量第一的词'}。此配置未提交，尚未调用接口。`;
});
document.querySelectorAll('.candidate img').forEach(img => {
  const fallback = () => { img.hidden = true; img.nextElementSibling.hidden = false; };
  img.addEventListener('error', fallback); if (img.complete && !img.naturalWidth) fallback();
});
update();
