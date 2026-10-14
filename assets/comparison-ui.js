(function (root) {
  'use strict';
  function request(ownAsin, text, keyword) {
    const asins = String(text || '').split(/\r?\n/).map(s => s.trim().toUpperCase()).filter(Boolean);
    if (asins.length < 1 || asins.some(a => !/^[A-Z0-9]{10}$/.test(a))) throw new Error('请填写至少 1 家竞对，一行一个有效 ASIN。');
    if (new Set([ownAsin, ...asins]).size !== asins.length + 1) throw new Error('竞对 ASIN 不能重复，也不能包含自己。');
    const coreKeyword = String(keyword || '').trim();
    if (coreKeyword.length > 200) throw new Error('核心关键词不能超过 200 字。');
    return { competitorAsins: asins, coreKeyword };
  }
  const phaseLabels = {keywords:'分析关键词中',prepare:'整理竞对名单中',awaiting_selection:'待选择／确认竞对',collect:'竞对取数中',awaiting_review:'待确认特征清洗',suggest:'生成清洗建议中',needs_evidence:'系统自动补齐资料',judge:'生成业务档案与特征清单中',complete:'已完成'};
  function taskLabel(task) {
    if (task.status === '失败') return task.status;
    if(task.status==='已完成'&&task.comparison_phase){const s=task.image_session;return s?.image_status==='complete'?'04 / 05 已完成':s?.status==='error'?'04 完成 · 05 异常':s?.status==='running'||s?.status==='queued'?'04 完成 · 05 分析中':'04 完成 · 05 待继续';}
    if (task.comparison_phase === 'needs_evidence' && task.comparison_state?.autoEvidenceAttempted) return '自动采集受阻';
    if(task.comparison_phase==='needs_evidence'&&task.comparison_state?.evidenceBlock!=='product')return '资料待补齐';
    if (task.comparison_phase === 'awaiting_selection') {
      const asins = task.comparison_request?.competitorAsins || task.comparison_state?.competitorAsins || task.comparison_asins || [];
      if (asins.length < 1) return '待选择竞对';
      return '名单已保存 · 待开始比对';
    }
    return phaseLabels[task.comparison_phase] || task.status;
  }
  function share(value, display) {
    if (typeof display === 'string') return display;
    return value === null || value === undefined ? '未返回' : `${value}%`;
  }
  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  const evidenceLabels={title:'标题',description:'产品描述',bullets:'五点原文',attributes:'属性原文',photos:'图片链接'};
  const hasEvidence=v=>typeof v==='string'?Boolean(v.trim()):Array.isArray(v)?v.length>0&&v.every(hasEvidence):Boolean(v&&typeof v==='object'&&Object.values(v).some(hasEvidence));
  function evidenceEditor(t,body,app,message,onDone){
    const state=t.comparison_state||{},products=Array.isArray(state.products)?state.products:[];body.append(element('p','自动采集未取得完整资料，已保存数据保留。下一步由你补齐可靠原文，或登记给管理员核查；本页不自动取数、不调用AI。'));body.append(element('p','任务编号：'+t.id));const reason=state.health?.reason||state.notice;if(reason)body.append(element('p','受阻原因：'+reason));window.KeywordTaskManager?.current?.helpActions(body,t);
    const editors=[];const editable=state.evidenceBlock!=='category'&&!state.rawFeatureResponse;
    for(const p of products){const section=element('fieldset',undefined,'evidence-product');section.append(element('legend',(p.role==='own'?'我方':'竞对')+' '+p.asin));const details=element('details');details.append(element('summary','查看已采集资料与来源'),element('pre',JSON.stringify({title:p.title,description:p.description,bullets:p.bullets,attributes:p.attributes,missingFields:p.missingFields,autoEvidence:p.autoEvidence,manualEvidence:p.manualEvidence},null,2)));section.append(details);
      if(editable){const fields={};for(const key of ['title','description','bullets','attributes']){if(hasEvidence(p[key])||hasEvidence(state.manualEvidence?.[p.asin]?.fields?.[key]))continue;const label=element('label',evidenceLabels[key]),input=element('textarea');input.setAttribute('aria-label',p.asin+' '+evidenceLabels[key]);input.placeholder=key==='bullets'?'每行一条五点原文':key==='attributes'?'每行一项：属性名称：原文':'仅填写可核对的商品原文';label.append(input);section.append(label);fields[key]=input;}if(Object.keys(fields).length){const label=element('label','资料来源（商品页或已核对文件）'),source=element('input');source.setAttribute('aria-label',p.asin+' 资料来源');label.append(source);section.append(label);editors.push({asin:p.asin,fields,source});}}
      body.append(section);}
    if(editors.length){const save=element('button','保存资料（不取数）');save.type='button';save.onclick=async()=>{app.hideMessage(message);save.disabled=true;try{const entries=editors.map(e=>{const fields={};for(const [key,input] of Object.entries(e.fields)){const text=input.value.trim();if(!text)continue;if(key==='bullets')fields[key]=text.split('\n').map(s=>s.trim()).filter(Boolean);else if(key==='attributes'){fields[key]={};for(const line of text.split('\n').filter(s=>s.trim())){const match=line.match(/^([^:：]+)[:：](.+)$/);if(!match)throw Error('属性请按“名称：原文”逐行填写');fields[key][match[1].trim()]=match[2].trim();}}else fields[key]=text;}return{asin:e.asin,source:e.source.value.trim(),fields};}).filter(e=>Object.keys(e.fields).length);if(!entries.length)throw Error('请填写至少一项缺失原文和对应来源');if(entries.some(e=>!e.source))throw Error('请填写资料来源');const result=await app.client.rpc('save_keyword_comparison_evidence',{p_task_id:t.id,p_revision:state.evidenceRevision||0,p_entries:entries,p_continue:false});if(result.error)throw result.error;app.showMessage(message,'资料已保存，未取数、未调用AI。继续分析需管理员核对已有授权与留底。','success');save.disabled=true;await onDone();}catch(e){app.showMessage(message,app.humanError(e));save.disabled=false;}};body.append(save);}
    if(!editable||!editors.length)body.append(element('p','当前为接口/品类异常或没有可补录字段，请登记核查并复制诊断交给管理员。'));
  }
  async function open(task, app, onDone) {
    const dialog = document.getElementById('comparison-review');
    const body = document.getElementById('comparison-review-body');
    const message = document.getElementById('comparison-review-message');
    app.hideMessage(message);
    body.replaceChildren(element('p', '正在加载本任务的确认资料…'));
    dialog.showModal();
    document.getElementById('close-comparison').onclick = () => dialog.close();
    try {
      const { data:t, error } = await app.client.from('keyword_tasks').select('id,asin,status,control_state,comparison_phase,comparison_state,comparison_request,comparison_selection').eq('id',task.id).single();
      if (error) throw error;
      const state = t.comparison_state || {};
      body.replaceChildren(element('p', `自己 ${t.asin} · 核心词：${state.coreKeyword || '未返回'}`));
      body.append(element('p', `阶段：${taskLabel(t)}`));
      const submit = async (button, name, args) => {
        app.hideMessage(message); button.disabled = true;
        try {
          const response = await app.client.rpc(name,args);
          if (response.error) throw response.error;
          dialog.close(); await onDone();
        } catch (e) { app.showMessage(message,app.humanError(e)); }
        finally { button.disabled = false; }
      };
      if (t.status !== '进行中') { body.append(element('p','任务状态已变化，请关闭后刷新。')); return; }
      document.getElementById('comparison-review-title').textContent=t.comparison_phase==='needs_evidence'?(t.comparison_state?.autoEvidenceAttempted?'自动采集受阻 · 原因与资料':'系统自动补齐产品资料'):'竞对对比 · 待确认';
      if(t.comparison_phase==='needs_evidence'){evidenceEditor(t,body,app,message,onDone);return;}
      if (t.comparison_phase === 'awaiting_selection') {
        if(t.control_state!=='running'){body.append(element('p','任务已暂停或正在暂停，请先在任务列表重新启动。'));return;}
        const asins = t.comparison_request?.competitorAsins || state.competitorAsins || [];
        if (asins.length < 1) {
          const candidates=(state.candidates || []).slice(0,10), selected=new Set();
          body.append(element('p',`留底共 ${state.totalCandidates ?? candidates.length} 家候选，按出现次数展示前 ${candidates.length} 家。${candidates.length<8?'不足 8 家，未补造候选。':''}至少选择 1 家，勾选几家就对比几家。同次数按 ASIN 排列，不代表推荐。`));
          const grid=element('div',undefined,'candidate-grid');
          candidates.forEach(c=>{
            const label=element('label',undefined,'candidate-item'),check=element('input');check.type='checkbox';check.value=c.asin;
            check.onchange=()=>{if(check.checked)selected.add(c.asin);else selected.delete(c.asin);};
            label.append(check,document.createTextNode(` ${c.asin} · ${c.count} 次`));
            try {if(new URL(c.imageUrl).protocol==='https:'){const img=element('img');img.src=c.imageUrl;img.alt=`${c.asin} 主图`;img.referrerPolicy='no-referrer';img.onerror=()=>{img.replaceWith(element('small','主图加载失败'));};label.append(img);}else label.append(element('small','已有留底暂无主图'));}catch{label.append(element('small','已有留底暂无主图'));}
            label.append(element('small',c.keywords.join('、')));grid.append(label);
          });
          const keywordLabel=element('label','核心关键词','field'),keyword=element('input');
          keyword.type='text';keyword.maxLength=200;keyword.value=state.coreKeyword || '';keyword.placeholder='用于竞对特征与图片对比';
          keywordLabel.append(keyword);
          const button=element('button','开始比对','primary-button');button.type='button';
          button.onclick=async()=>{
            if(selected.size<1)return app.showMessage(message,'请先选择至少 1 家竞对。');
            if(!keyword.value.trim())return app.showMessage(message,'请填写核心关键词。');
            button.disabled=true;
            try {
              const {error}=await app.client.rpc('start_keyword_comparison',{p_task_id:t.id,p_asins:[...selected],p_core_keyword:keyword.value.trim()});
              if(error)throw error;
              dialog.close();await onDone();
            }catch(e){app.showMessage(message,app.humanError(e));}finally{button.disabled=false;}
          };
          body.append(grid,keywordLabel,button);return;
        }
        body.append(element('p', `已保存的竞对名单：${asins.join('、')}`));
        const candidates = new Map((state.candidates || []).map(c => [c.asin,c]));
        const list = element('ul');
        asins.forEach(asin => { const c=candidates.get(asin); list.append(element('li', `${asin}：${c ? `出现在 ${c.count} 个词的 ABA Top3：${c.keywords.join('、')}` : '未在当前关键词留底的 ABA Top3 中出现；保留你填写的名单'}`)); });
        body.append(list);
        body.append(element('p','点击开始比对后，将按以上名单直接取数，无需单独确认报价。'));
        const button=element('button','开始比对','primary-button');button.type='button';
        button.onclick=()=>submit(button,'start_keyword_comparison',{p_task_id:t.id,p_asins:asins,p_core_keyword:state.coreKeyword || ''});
        body.append(button);
      } else if (t.comparison_phase === 'awaiting_review') {
        body.append(element('p','剔除只适用于“不属于我们这种产品”的特征。适用但自己和竞对都未做的，请保留或标记“缺口”。AI 不会替你确认。'));
        body.append(element('p',`整理后共 ${(state.features || []).length} 条；按月销量占比降序，尚未清洗。前五条：${(state.features || []).slice(0,5).map(f=>`${f.product_feature}（产品 ${f.product_count_share}% / 月销 ${f.monthly_sales_share}%）`).join('；')}`));
        body.append(element('p',`样本信息：${typeof state.sampleStats==='object' ? JSON.stringify(state.sampleStats) : state.sampleStats || '未返回'}`));
        const own=state.products?.[0];
        if(own){const evidence=element('details'),summary=element('summary',own.evidenceMode==='title-description-attributes'?'查看自己产品的标题、产品描述和已返回属性原文':'查看自己产品的标题、五点和属性原文');evidence.append(summary,element('pre',JSON.stringify({asin:own.asin,title:own.title,description:own.description,bullets:own.bullets,attributes:own.attributes,evidencePolicy:own.evidencePolicy,missingFields:own.missingFields,manualEvidence:own.manualEvidence},null,2)));body.append(evidence);}
        if(!state.cleaningSuggestions && state.cleaningQuote){
          const note=element('p',`可先生成逐条清洗建议：最多 ${state.cleaningQuote.maxCalls} 次文本调用，上限 ¥${state.cleaningQuote.maxCny}。建议仅供审核，未经确认不写入清洗结果文件。`);
          const button=element('button','批准上述费用并生成清洗建议','secondary-button');button.type='button';
          button.onclick=()=>submit(button,'request_keyword_cleaning',{p_task_id:t.id,p_source_digest:state.sourceDigest,p_max_cny:state.cleaningQuote.maxCny});body.append(note,button);
        }
        const proposalSummary=element('div',undefined,'cleaning-summary');
        for(const decision of ['剔除','缺口']){
          proposalSummary.append(element('strong',`建议${decision}清单（尚未确认）`));
          const group=(state.cleaningSuggestions || []).filter(x=>x.decision===decision);
          proposalSummary.append(element('p',group.length?group.map(x=>`${x.product_feature}：${x.reason}`).join('；'):'暂无建议'));
        }
        body.append(proposalSummary);
        const scroll=element('div',undefined,'table-scroll'),table=element('table',undefined,'comparison-cleaning');
        const header=element('tr');['特征及说明','产品占比 / 月销量占比','你的判定','理由'].forEach(s=>header.append(element('th',s)));table.append(header);
        const inputs=(state.features || []).map(f=>{
          const row=element('tr'),name=element('td',f.product_feature);name.append(element('small',f.feature_description));
          const ratio=element('td',`${share(f.product_count_share,f.product_count_share_display)} / ${share(f.monthly_sales_share,f.monthly_sales_share_display)}`);
          const decisionCell=element('td'),select=element('select');
          [['','请选择'],['保留','保留'],['剔除','剔除：不属本类型'],['缺口','缺口：适用但未做']].forEach(([value,title])=>{const option=element('option',title);option.value=value;select.append(option);});
          decisionCell.append(select);
          const reasonCell=element('td'),reason=element('textarea');reason.rows=2;reason.setAttribute('aria-label',`${f.product_feature}判定理由`);reasonCell.append(reason);
          const proposal=state.cleaningSuggestions?.find(p=>p.product_feature===f.product_feature);
          if(proposal){select.value=proposal.decision;reason.value=proposal.reason;}
          row.append(name,ratio,decisionCell,reasonCell);table.append(row);return {f,select,reason};
        });
        scroll.append(table);body.append(scroll);
        const actions=element('div',undefined,'comparison-review-actions'),approval=element('label'),approve=element('input');approve.type='checkbox';
        approval.append(approve,document.createTextNode(' 我已逐项审核并确认特征清洗结果。'));
        const button=element('button','确认特征并生成档案','primary-button');button.type='button';
        button.onclick=()=>{
          app.hideMessage(message);
          if (!inputs.length || inputs.some(x=>!x.select.value||!x.reason.value.trim())) return app.showMessage(message,'请逐条填写判定和理由。');
          if (!inputs.some(x=>x.select.value!=='剔除')) return app.showMessage(message,'至少保留一项适用特征。');
          if (!approve.checked) return app.showMessage(message,'请确认清洗结果。');
          const decisions=inputs.map(x=>({product_feature:x.f.product_feature,decision:x.select.value,reason:x.reason.value.trim(),...(x.select.value==='剔除'?{exclusionBasis:'不属于本产品类型'}:{})}));
          return submit(button,'confirm_keyword_features_without_text',{p_task_id:t.id,p_source_digest:state.sourceDigest,p_decisions:decisions});
        };
        actions.append(approval,button);body.append(actions);
      } else { body.append(element('p',state.notice || '当前阶段无需确认，请稍后刷新任务。')); if(state.rawFeatureResponse){const details=element('details'),summary=element('summary','查看接口原始返回（已留底）');details.append(summary,element('pre',JSON.stringify(state.rawFeatureResponse,null,2)));body.append(details);} }
    } catch (e) { app.showMessage(message,app.humanError(e)); }
  }
  const api={request,phaseLabels,taskLabel,share,open};
  if (typeof module !== 'undefined' && module.exports) module.exports=api;
  else root.KeywordComparison=Object.freeze(api);
}(typeof window !== 'undefined' ? window : globalThis));
