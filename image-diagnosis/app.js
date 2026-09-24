'use strict';
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const escape = v => String(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const original = [
  ['room','卧室场景适用','Bedroom ambience','示例来源：核心词意图 + 前排主图','先看到卧室里的实际装饰位置，才能判断是否适合自己的房间。'],
  ['color','调光调色效果','Adjustable colors & brightness','示例来源：核心词意图','确认灯光如何改变氛围，避免仅凭 RGB 字样想象效果。'],
  ['install','安装与粘贴方式','Peel-and-stick installation','示例来源：人工差评主题（占位，待提供原文）','先了解贴在哪里、怎么贴，以及安装需要哪些准备。'],
  ['control','控制与连接方式','Control & connection','示例来源：前排主图 + 人工差评主题（占位）','看清控制器和灯带如何连接，确认日常使用是否方便。'],
  ['music','音乐联动效果','Music sync','示例来源：前排主图表达','看到节奏与光效的对应关系，才能确认联动是否符合预期。'],
  ['durable','持续使用稳定性','Reliable everyday use','示例来源：人工差评主题（占位，待提供原文）','了解长期使用的表现，降低频繁掉落或失效的顾虑。'],
];
let items = original.map(([id,name,english,source,reason]) => ({id,name,english,source,reason}));
let maxStage = 1, currentStage = 1, ownShown = false, ownAccepted = false, competitor = 0;
let shown = [false,false], accepted = [false,false], idCounter = 0;
const titles = ['主图 / 产品与配件','卧室氛围与调色','控制方式','安装步骤','尺寸与长度','音乐联动'];
const ownEvidence = {room:[2,'direct','床头与墙沿呈现灯带安装位置，画面展示卧室使用场景。'],color:[2,'direct','同一卧室并排呈现紫色与青绿色灯光。'],install:[4,'direct','三个步骤展示清洁、撕开背胶、沿边缘按压。'],control:[3,'icon','只有 APP 与遥控器图标，没有连接关系或操作效果。'],music:[6,'icon','只有音符图标与 Music sync 字样，没有节奏和光效的对应画面。']};
const suggestions = {room:'保留卧室全景，标出灯带沿床头与墙沿的安装位置；突出真实照明效果。',color:'保留同一机位的双色效果对照，让买家直接看到调色前后的差异。',install:'保留清洁、揭背胶、按压三步近景；突出手部动作与粘贴表面。',control:'改第 3 张：左侧放控制操作，右侧放灯带亮起的结果；底部用连接线展示控制器与灯带的对应关系。',music:'改第 6 张：用连续三格展示节奏变化，配合对应的灯光变化。功能必须先验证，不能凭效果图编造。',durable:'新增稳定性证据图：使用经核验的测试条件和实拍结果，标明时长与环境；缺少测试证据时保留待补，不编造耐久承诺。'};
const eligible = item => original.some(r => r[0] === item.id && r.slice(1).join('\n') === [item.name,item.english,item.source,item.reason].join('\n'));
const fact = item => eligible(item) ? ownEvidence[item.id] : null;
const flash = message => { $('#notice').textContent = message; };
function art(n, other = false) {
  const stroke = other ? '#59c7af' : '#ac8ddd';
  let content = '';
  if(n === 1) content = `<rect x="0" y="0" width="360" height="220" fill="white"/><g fill="none" stroke="${stroke}" stroke-width="6"><ellipse cx="165" cy="108" rx="68" ry="53"/><ellipse cx="165" cy="108" rx="56" ry="42"/><ellipse cx="165" cy="108" rx="44" ry="31"/></g><path d="M233 108 Q272 114 265 158" fill="none" stroke="#6b8173" stroke-width="3"/><rect x="248" y="152" width="36" height="25" rx="5" fill="#43574d"/>`;
  if(n === 2) content = `<rect x="20" y="30" width="153" height="150" rx="5" fill="#3a2e57"/><rect x="187" y="30" width="153" height="150" rx="5" fill="#214d4d"/><g fill="#7a7892"><rect x="45" y="118" width="100" height="40" rx="4"/><rect x="212" y="118" width="100" height="40" rx="4"/></g><g fill="#b4b1bf"><rect x="53" y="108" width="83" height="27" rx="4"/><rect x="220" y="108" width="83" height="27" rx="4"/></g><path d="M30 160 V44 H164" fill="none" stroke="#d98eff" stroke-width="5"/><path d="M197 160 V44 H331" fill="none" stroke="#70e4bb" stroke-width="5"/><text x="180" y="201" text-anchor="middle">ONE ROOM · TWO COLORS</text>`;
  if(n === 3) content = other ? `<rect x="35" y="57" width="50" height="92" rx="8" fill="#f5faf6" stroke="#709a80"/><circle cx="60" cy="92" r="15" fill="#9ecfa9"/><path d="M100 102 H164 M155 94 L164 102 L155 110" stroke="#708b76" fill="none" stroke-width="2"/><rect x="170" y="88" width="46" height="28" rx="5" fill="#5a7060"/><path d="M216 102 H258 V65 H313 V150 H265" fill="none" stroke="#53bb9a" stroke-width="6"/><text x="180" y="181" text-anchor="middle">CONTROL → CONNECT → LIGHT</text>` : `<rect x="87" y="65" width="48" height="80" rx="8" fill="none" stroke="#92a397" stroke-width="2"/><rect x="221" y="67" width="28" height="74" rx="9" fill="none" stroke="#92a397" stroke-width="2"/><circle cx="235" cy="89" r="5" fill="#9baba0"/><text x="112" y="168" text-anchor="middle">APP</text><text x="236" y="168" text-anchor="middle">REMOTE</text>`;
  if(n === 4) content = `<g fill="white" stroke="#d1ddcd"><rect x="20" y="53" width="98" height="110" rx="7"/><rect x="131" y="53" width="98" height="110" rx="7"/><rect x="242" y="53" width="98" height="110" rx="7"/></g><path d="M39 126 L78 85 L97 103 L59 144Z" fill="#b9cfb5"/><path d="M148 128 H213 M152 124 Q173 78 209 84" stroke="#92b399" stroke-width="7" fill="none"/><path d="M257 131 H326" stroke="#92b399" stroke-width="7"/><path d="M291 82 V116 M283 106 L291 116 L299 106" stroke="#6f8d70" fill="none" stroke-width="4"/><text x="69" y="186" text-anchor="middle">1 CLEAN</text><text x="180" y="186" text-anchor="middle">2 PEEL</text><text x="291" y="186" text-anchor="middle">3 PRESS</text>`;
  if(n === 5) content = `<ellipse cx="180" cy="93" rx="77" ry="39" fill="none" stroke="${stroke}" stroke-width="7"/><ellipse cx="180" cy="93" rx="60" ry="26" fill="none" stroke="${stroke}" stroke-width="5"/><path d="M68 165 H292 M68 157 V173 M292 157 V173" stroke="#80957d" fill="none" stroke-width="2"/><text x="180" y="190" text-anchor="middle">LENGTH / SIZE · DEMO</text>`;
  if(n === 6) content = other ? `<g fill="#e2ebe3"><rect x="20" y="44" width="98" height="117" rx="8"/><rect x="131" y="44" width="98" height="117" rx="8"/><rect x="242" y="44" width="98" height="117" rx="8"/></g><g fill="#69aa87"><rect x="37" y="123" width="15" height="20"/><rect x="59" y="110" width="15" height="33"/><rect x="81" y="120" width="15" height="23"/><rect x="148" y="90" width="15" height="53"/><rect x="170" y="79" width="15" height="64"/><rect x="192" y="100" width="15" height="43"/><rect x="259" y="114" width="15" height="29"/><rect x="281" y="126" width="15" height="17"/><rect x="303" y="113" width="15" height="30"/></g><path d="M32 63 H106 M143 63 H217 M254 63 H328" stroke="#82ceb2" stroke-width="5"/><text x="180" y="187" text-anchor="middle">BEAT → LIGHT · THREE FRAMES</text>` : `<text x="180" y="115" text-anchor="middle" style="font-size:56px;fill:#a5b69f">♫</text><text x="180" y="158" text-anchor="middle">MUSIC SYNC</text>`;
  return `<svg class="art" viewBox="0 0 360 220" role="img" aria-label="${other?'竞对':'自己'} 第 ${n} 张：${titles[n-1]}，虚构布局示意" xmlns="http://www.w3.org/2000/svg"><rect width="360" height="220" fill="#f3f6f0"/><g font-family="Arial,sans-serif" font-size="11" fill="#7d8d78">${content}<text x="346" y="16" text-anchor="end" font-size="8" fill="#a0aea0">LAYOUT DEMO</text></g></svg>`;
}
function drawChecklist() {
  $('#checklist-rows').innerHTML = items.map((item,i) => `<tr data-id="${item.id}"><td><small>${String(i+1).padStart(2,'0')}</small><input data-field="name" aria-label="要素 ${i+1} 名称" value="${escape(item.name)}"></td>${['english','source','reason'].map(field => `<td><textarea data-field="${field}" aria-label="要素 ${i+1} ${field}">${escape(item[field])}</textarea></td>`).join('')}<td><button class="delete" data-remove="${item.id}" aria-label="删除要素 ${i+1}" ${items.length<=5?'disabled':''}>删除</button></td></tr>`).join('');
  $('#item-count').textContent = `${items.length} / 5–7 条`;
  $('#add-item').disabled = items.length >= 7;
}
function invalidate() {
  maxStage = 1; ownShown = ownAccepted = false; shown = [false,false]; accepted = [false,false]; competitor = 0;
  $('#own-result').hidden = true; $('#compare-result').hidden = true;
  $('#run-own').disabled = false; $('#run-own').textContent = '查看模拟诊断结果';
  setStage(1);
}
function setStage(n) {
  if(n > maxStage) return;
  currentStage = n;
  $$('.stage').forEach((el,i) => el.hidden = i+1 !== n);
  $$('[data-stage]').forEach(b => {b.disabled = Number(b.dataset.stage)>maxStage; b.classList.toggle('active',Number(b.dataset.stage)===n); b.setAttribute('aria-current',Number(b.dataset.stage)===n?'step':'false');});
}
function showImage(n,other=false) {
  $('#dialog-title').textContent = `${other?`竞对 ${competitor+1}`:'自己'} 第 ${n} 张 · ${titles[n-1]}`;
  const found = other ? '此图为虚构竞对布局示意；实际证据必须来自已保存的图片 URL。' : items.filter(item => fact(item)?.[0] === n).map(item => `${item.name}：${fact(item)[2]}`).join(' ') || '此示意图未确认清单中的要素；不据此推断真实产品功能。';
  $('#dialog-body').innerHTML = `${art(n,other)}<p>${escape(found)}</p>`;
  $('#image-dialog').showModal();
}
function ownResults() {
  $('#main-photo').innerHTML = `<button class="secondary" data-image="1" aria-label="查看主图示意">${art(1)}</button>`;
  $('#matrix').innerHTML = `<table class="matrix"><thead><tr><th>买家必须确认的事</th>${titles.map((_,i) => `<th>自己 第 ${i+1} 张<br><small>${titles[i]}</small></th>`).join('')}<th>整组结论</th></tr></thead><tbody>${items.map(item => {const f=fact(item);return `<tr><th scope="row">${escape(item.name)}</th>${titles.map((_,i) => f?.[0]===i+1?`<td><button class="cell ${f[1]}" data-image="${i+1}">第 ${i+1} 张确认<small>${f[1]==='direct'?'画面直给':'只靠小字图标'}</small></button></td>`:'<td class="empty">—</td>').join('')}<td>${f ? `<span class="${f[1]==='icon'?'warn':''}">${f[1]==='direct'?'画面直给':'需补直观画面'}</span>` : `<span class="muted">${eligible(item)?'0 · 整组没答':'待真实诊断'}</span>`}</td></tr>`;}).join('')}</tbody></table>`;
  $('#image-cards').innerHTML = titles.map((title,i) => {const matched=items.filter(item => fact(item)?.[0]===i+1);return `<article class="image-card"><button data-image="${i+1}" aria-label="放大自己第 ${i+1} 张">${art(i+1)}<span class="image-label">自己 第 ${i+1} 张</span></button><div class="image-content"><h3>${title}</h3><div class="pills">${matched.map(item=>`<span class="pill">${escape(item.name)}</span>`).join('')||'<span class="muted">清单内暂无已确认要素</span>'}</div><p>${matched.map(item=>escape(fact(item)[2])).join(' ')||'不强行分配卖点；保留图片顺序，供人工检查。'}</p><details><summary>改版建议 · 可人工修改</summary><label>构图与画面动作<textarea aria-label="第 ${i+1} 张构图建议">${escape(matched.map(item=>suggestions[item.id]).join('\n')||'先确认本图承担的购买疑问，再决定是否调整；不凭印象补写卖点。')}</textarea></label><label>英文图片文案<textarea aria-label="第 ${i+1} 张英文文案">${escape(matched.map(item=>item.english).join(' / ')||'待确认')}</textarea></label><label>任务状态<select aria-label="第 ${i+1} 张任务状态"><option>待处理</option><option>待美工制作</option><option>待复核</option><option>已完成</option></select></label></details></div></article>`;}).join('');
  const noAnswer = items.filter(item => !fact(item));
  if(noAnswer.length) $('#image-cards').insertAdjacentHTML('beforeend', `<article class="image-card"><div class="image-content"><h3>清单缺口 · 待补图</h3>${noAnswer.map(item=>`<p><b>${escape(item.name)}</b>：${escape(eligible(item)?suggestions[item.id]:'已修改或新增要素，演示证据不再适用；等待正式视觉诊断。')}</p>`).join('')}</div></article>`);
}
function tabs() {
  $('#competitor-tabs').innerHTML = [0,1].map(i=>`<button data-competitor="${i}" class="${i===competitor?'active':''}" ${i===1&&!accepted[0]?'disabled':''}>竞对 ${i+1} · ${accepted[i]?'已验收':shown[i]?'待验收':i===1&&!accepted[0]?'未开放':'待对比'}</button>`).join('');
  $('#compare-title').textContent = `自己 × 竞对 ${competitor+1} · 示例`;
  $('#compare-result').hidden = !shown[competitor];
  $('#run-compare').disabled = shown[competitor];
  $('#run-compare').textContent = shown[competitor]?'模拟对比已展示':'查看本家模拟对比';
  $('#accept-compare').disabled = accepted[competitor];
  $('#accept-compare').textContent = accepted[competitor]?'本家模拟结果已验收':competitor===0?'确认本家，开放下一家 →':'确认本家，结束模拟流程';
  $('#compare-stop').textContent = accepted.every(Boolean)?'两家模拟对比已验收。正式流程此时才允许汇总报告。':'本家做完先审核，再开放下一家。';
  if(shown[competitor]) comparisons();
}
function comparisons() {
  $('#comparison').innerHTML = items.map(item => {
    const f = fact(item), better = !!f && ['control','music'].includes(item.id), n = f?.[0];
    const otherEvidence = item.id==='control'?'手机操作、控制器、亮起的灯带以箭头和连线排列，连接关系直接可见。':item.id==='music'?'三个连续画格并列展示节奏柱变化与灯光条，呈现对应关系。':f?.[2];
    const evidenceCard = other => `<div class="evidence-card">${n?`<button data-image="${n}" data-other="${other}" aria-label="查看${other?'竞对':'自己'}第 ${n} 张">${art(n,other)}</button>`:''}<div><b>${other?`竞对 ${competitor+1}`:'自己'}${n?` 第 ${n} 张`:' · 未确认'}</b><p>${escape(!f?(eligible(item)?'0 · 整组没答':'清单已变更，待真实诊断'):other?otherEvidence:f[2])}</p></div></div>`;
    return `<article class="compare-row"><div class="compare-title"><h3>${escape(item.name)}</h3><span class="badge ${better?'amber':''}">${!f?'未确认':better?'竞对更直观 · 示例':'同等级 · 不判快慢'}</span></div><div class="compare-evidence">${evidenceCard(false)}${evidenceCard(true)}<div class="suggestion"><b>${better?'交给美工的改图建议':'处理建议'}</b>${escape(better?`参考竞对 ${competitor+1} 第 ${n} 张的${item.id==='control'?'控制—连接—亮灯对应构图':'三格节奏与灯光对照'}，优化我的第 ${n} 张。${suggestions[item.id]}`:!f?(eligible(item)?suggestions[item.id]:'新增或修改要素没有可复用的模拟证据，等待真实诊断。'):'两边均有直观表达；保留我方现有画面，不凭主观审美评分。')}</div></div></article>`;
  }).join('');
}
$('#checklist-rows').addEventListener('input', event => {
  const field=event.target.dataset.field;
  if(!field) return;
  items.find(item => item.id===event.target.closest('tr').dataset.id)[field]=event.target.value;
  invalidate(); flash('清单已修改：之前的模拟诊断已失效，需重新确认。');
});
$('#checklist-rows').addEventListener('click', event => {const id=event.target.dataset.remove;if(!id||items.length<=5)return;items=items.filter(item=>item.id!==id);invalidate();drawChecklist();});
$('#add-item').addEventListener('click',()=>{if(items.length>=7)return;items.push({id:`new-${++idCounter}`,name:'',english:'',source:'',reason:''});invalidate();drawChecklist();});
$('#confirm-checklist').addEventListener('click',()=>{
  if(items.length<5||items.length>7||items.some(item=>['name','english','source','reason'].some(key=>!item[key].trim())))return flash('请保持 5–7 条，并补齐每条的四项内容。');
  if(new Set(items.map(item=>item.name.trim().toLowerCase())).size!==items.length)return flash('要素名称不能重复，请合并重复项。');
  maxStage=Math.max(maxStage,2);setStage(2);flash('示例清单已在本页面确认；未写入正式 checklist.json。');
});
$$('[data-stage]').forEach(b=>b.addEventListener('click',()=>setStage(Number(b.dataset.stage))));
$('#run-own').addEventListener('click',()=>{if(maxStage<2)return;ownShown=true;ownResults();$('#own-result').hidden=false;$('#run-own').disabled=true;$('#run-own').textContent='模拟结果已展示';flash('已展示虚构示例：没有发送图片或调用模型。');});
$('#accept-own').addEventListener('click',()=>{if(!ownShown)return;ownAccepted=true;maxStage=3;setStage(3);tabs();flash('自家模拟结果已验收，现在仅开放竞对 1。');});
$('#competitor-tabs').addEventListener('click',event=>{const b=event.target.closest('[data-competitor]');if(!b)return;const i=Number(b.dataset.competitor);if(i===1&&!accepted[0])return;competitor=i;tabs();});
$('#run-compare').addEventListener('click',()=>{if(!ownAccepted||(competitor===1&&!accepted[0]))return;shown[competitor]=true;tabs();flash(`竞对 ${competitor+1} 的模拟结果已展示，请先验收本家。`);});
$('#accept-compare').addEventListener('click',()=>{if(!shown[competitor])return;accepted[competitor]=true;tabs();flash(accepted.every(Boolean)?'模拟流程已结束；未生成或发布正式报告。':'竞对 1 已验收，可以切换到竞对 2。');});
document.addEventListener('click',event=>{const b=event.target.closest('[data-image]');if(b)showImage(Number(b.dataset.image),b.dataset.other==='true');});
$('#close-dialog').addEventListener('click',()=>$('#image-dialog').close());
drawChecklist();setStage(1);
