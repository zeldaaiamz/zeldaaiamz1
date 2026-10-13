(function () {
'use strict';
function organicControls() {
  const panel = document.getElementById('organicBenchmark');
  if (!panel) return;
  const body = panel.querySelector('tbody');
  const filter = panel.querySelector('select');
  const search = panel.querySelector('input');
  const button = panel.querySelector('button');
  let ascending = true;
  let sortKey = 'gap';
  const headers = [...panel.querySelectorAll('thead th')];
  const keys = ['keyword', 'volume', 'ownRank', 'adRank', 'benchmark', 'benchmarkRank', 'gap'];
  headers.forEach((header, index) => {
    header.dataset.sortKey = keys[index]; header.dataset.label = header.textContent.replace(/ [↑↓↕]$/, '');
    header.tabIndex = 0; header.style.cursor = 'pointer';
    const sort = () => { ascending = sortKey === keys[index] ? !ascending : !['volume', 'benchmark'].includes(keys[index]); sortKey = keys[index]; apply(); };
    header.addEventListener('click', sort);
    header.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); sort(); } });
  });
  function apply() {
    const rows = [...body.rows];
    rows.sort((a, b) => {
      const av = a.dataset[sortKey] ?? '', bv = b.dataset[sortKey] ?? '';
      if (av === '') return bv === '' ? 0 : 1;
      if (bv === '') return -1;
      const result = ['keyword', 'benchmark'].includes(sortKey) ? av.localeCompare(bv, 'zh-CN', {numeric:true}) : Number(av) - Number(bv);
      return result * (ascending ? 1 : -1);
    });
    for (const row of rows) {
      body.append(row);
      const gap = row.dataset.gap;
      const match = filter.value === 'all' || (filter.value === 'missing' && gap === '' && row.dataset.first !== 'true') || (filter.value === 'first' && row.dataset.first === 'true') ||
        (gap !== '' && ((filter.value === 'behind' && Number(gap) > 0) || (filter.value === 'ahead' && Number(gap) < 0) || (filter.value === 'equal' && Number(gap) === 0)));
      row.hidden = !(match && row.dataset.keyword.includes(search.value.trim().toLowerCase()));
    }
    const visible = rows.filter(row => !row.hidden).length;
    panel.querySelector('[data-count]').textContent = `显示 ${visible} / ${rows.length} 词`;
    panel.querySelector('[data-empty]').hidden = visible !== 0;
    headers.forEach(header => { const active = header.dataset.sortKey === sortKey; header.setAttribute('aria-sort', active ? (ascending ? 'ascending' : 'descending') : 'none'); header.textContent = header.dataset.label + (active ? (ascending ? ' ↑' : ' ↓') : ' ↕'); });
    button.textContent = headers.find(header => header.dataset.sortKey === sortKey).dataset.label + (ascending ? '升序 ↑' : '降序 ↓');
  }
  filter.addEventListener('change', apply); search.addEventListener('input', apply);
  button.addEventListener('click', () => { ascending = !ascending; apply(); });
  panel.querySelectorAll('img').forEach(img => img.addEventListener('error', () => {
    img.hidden = true; img.nextElementSibling.hidden = false;
  }));
  apply();
}

function upgrade(html) {
 const report = new DOMParser().parseFromString(html, 'text/html');
 const panel = report.querySelector('#organicBenchmark');
 if (!panel) return html;
 const volumes = new Map([...report.querySelectorAll('#reportTable tbody tr')].map(row => [row.querySelector('[data-key="keyword"] strong')?.textContent.trim().toLowerCase() || row.querySelector('[data-key="keyword"]')?.textContent.trim().toLowerCase(), row.querySelector('[data-key="volume"]')?.dataset.sort ?? '']));
 const headers = panel.querySelector('thead tr');
 const hasVolume = headers.children.length === 7;
 if (!hasVolume) { const th = report.createElement('th'); th.textContent = '周搜索量'; headers.children[0].after(th); }
 for (const row of panel.querySelectorAll('tbody tr')) {
  if (!hasVolume) { const cell = report.createElement('td'); const value = volumes.get(row.dataset.keyword) ?? ''; row.dataset.volume = value; cell.textContent = value === '' ? '—' : Number(value).toLocaleString('en-US'); row.children[0].after(cell); }
  const rank = index => { const match = row.children[index].textContent.match(/#(\d+)/); return match ? match[1] : ''; };
  row.dataset.ownRank = rank(2); row.dataset.adRank = rank(3); row.dataset.benchmark = row.children[4].querySelector('code')?.textContent.trim() ?? ''; row.dataset.benchmarkRank = rank(5);
 }
 for (const script of report.querySelectorAll('script')) {
  if (script.textContent.includes('function organicControls()')) {
   const start = script.textContent.indexOf('(function organicControls()');
   const end = script.textContent.indexOf('})();', start);
   if (start >= 0 && end >= 0) script.textContent = script.textContent.slice(0,start) + '(' + organicControls.toString() + ')();' + script.textContent.slice(end + 5);
  }
 }
 return '<!doctype html>\n' + report.documentElement.outerHTML;
}
window.KeywordBattleOrganicModule = Object.freeze({upgrade});
}());
