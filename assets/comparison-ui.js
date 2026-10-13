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
  const phaseLabels = {keywords:'分析关键词中',prepare:'整理竞对名单中',awaiting_selection:'待选择／确认竞对',collect:'竞对取数中',awaiting_review:'待确认特征清洗',suggest:'生成清洗建议中',needs_evidence:'产品资料待补齐',judge:'逐条核对中',complete:'已完成'};
  function taskLabel(task) {
    if (task.status === '失败') return task.status;
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
    const state=t.comparison_state||{},products=state.products||[];
    body.append(element('p','资料不足，任务已停在这里，不会自动补齐。维护人员负责核对采集和字段读取；你也可以在下方补录对应 ASIN 的真实原文。'));
    body.append(element('p',`任务编号：${t.id}`));
    if(state.notice)body.append(element('p',state.notice));
    if(state.evidenceBlock==='category'||state.rawFeatureResponse||!products.length){
      body.append(element('p','当前需要维护人员核对接口原始返回，补录产品资料无法解决。请提供上方任务编号，不要重复创建任务。'));
      if(state.rawFeatureResponse){const details=element('details');details.append(element('summary','查看已保存的接口返回'),element('pre',JSON.stringify(state.rawFeatureResponse,null,2)));body.append(details);}
      return;
    }
    body.append(element('p','文字资料按本任务已确认的分析范围补齐。图片缺失不阻止模块 04 的文字对比，但模块 05 仍需图片完整；继续文字流程不代表图片诊断已经完成。'));
    const editors=[];
    for(const product of products){
      const entry=state.manualEvidence?.[product.asin];
      const required=product.evidenceMode==='title-description-attributes'?['title','description']:['title','bullets','attributes'];
      const missing=Object.keys(evidenceLabels).filter(k=>!hasEvidence(product[k]));
      const section=element('fieldset',undefined,'evidence-product');
      section.append(element('legend',`${product.role==='own'?'我方':'竞对'} ${product.asin}`));
      section.append(element('p',`文字必需：${required.map(k=>evidenceLabels[k]).join('、')}；缺失：${missing.map(k=>evidenceLabels[k]).join('、')||'无'}`));
      const details=element('details');details.append(element('summary','查看已采集资料（保留原文）'),element('pre',JSON.stringify({title:product.title,description:product.description,bullets:product.bullets,attributes:product.attributes,photos:product.photos},null,2)));section.append(details);
      const inputs={};
      for(const key of missing){
        const label=element('label',`${evidenceLabels[key]}${required.includes(key)?'（文字对比必需）':key==='photos'?'（图片诊断必需）':'（可选）'}`,'field');
        const input=element('textarea');input.rows=key==='photos'?3:4;input.maxLength=30000;input.setAttribute('aria-label',`${product.asin} ${evidenceLabels[key]}`);
        input.placeholder=key==='bullets'?'每行一条五点原文，不用描述代替':key==='attributes'?'每行一项，格式：属性名称：属性原文':key==='photos'?'每行一个 Amazon 图片 HTTPS 链接，按主图、附图顺序，最多 20 张':'粘贴对应字段原文，保留原始语言';
        const value=entry?.fields?.[key];input.value=Array.isArray(value)?value.join('\n'):value&&typeof value==='object'?Object.entries(value).map(([k,v])=>`${k}：${v}`).join('\n'):value||'';
        label.append(input);section.append(label);inputs[key]=input;
      }
      if(missing.length){
        const label=element('label','资料来源（必填，例如 Listing 地址或卖家后台导出文件名）','field'),source=element('input');source.type='text';source.maxLength=1000;source.value=entry?.source||'';source.setAttribute('aria-label',`${product.asin} 资料来源`);label.append(source);section.append(label);editors.push({product,inputs,source,required});
      }
      body.append(section);
    }
    const actions=element('div',undefined,'comparison-review-actions'),confirm=element('input');confirm.type='checkbox';
    const label=element('label');label.append(confirm,document.createTextNode(' 我确认补录原文及图片属于上述 ASIN，没有改写或混用其他产品资料。'));actions.append(label);
    const selection=t.comparison_selection,unbounded=['user-unbounded','selection-start'].includes(selection?.costApproval)&&Number.isInteger(selection.maxCalls)&&selection.maxCalls>0,finiteQuote=unbounded||selection&&Number.isFinite(selection.maxCost)&&selection.maxCost>=0&&Number.isInteger(selection.maxCalls)&&selection.maxCalls>0&&selection.unit;
    actions.append(element('p',unbounded?`原任务已授权按所选名单取数；原计划最多 ${selection.maxCalls} 次取数，具体费用本页未返回。继续仅处理原名单中尚未完成的取数，成功留底不重复使用额度。`:finiteQuote?`继续后仍受原取数总上限约束：${selection.maxCalls} 次、${selection.maxCost} ${selection.unit}（这是原任务总上限，不是新增费用）。已成功留底不重复采集；结果不明的请求会停止，不自动重试。`:'当前没有可展示的有限取数费用上限。可以先保存资料；请维护人员核实报价后再恢复，不能从此处直接继续。'));
    const consent=element('input');consent.type='checkbox';consent.disabled=!finiteQuote;
    const consentLabel=element('label');consentLabel.append(consent,document.createTextNode(unbounded?' 同意沿用原任务取数授权，继续原名单尚未完成的取数；不批准新的 AI 判断。':' 同意按上述原批准上限继续尚未完成的取数；不批准新的 AI 判断。'));actions.append(consentLabel);
    const save=element('button','保存资料（不取数）','secondary-button'),resume=element('button','保存并继续文字对比','primary-button');save.type=resume.type='button';resume.disabled=!finiteQuote||t.control_state!=='running';
    if(t.control_state!=='running')actions.append(element('p','任务处于暂停或正在暂停状态。可以保存资料；请先在任务列表重新启动，再回到这里继续。'));
    const run=async continuing=>{
      app.hideMessage(message);
      try{
        if(!confirm.checked)throw Error('请先确认资料与 ASIN 一致。');
        if(continuing&&!consent.checked)throw Error('请先确认继续取数的费用范围。');
        const entries=editors.map(({product,inputs,source,required})=>{
          const fields={};
          for(const [key,input] of Object.entries(inputs)){
            const value=input.value.trim();if(!value)continue;
            if(key==='photos'||key==='bullets')fields[key]=value.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
            else if(key==='attributes'){
              fields[key]=Object.create(null);
              for(const line of value.split(/\r?\n/).filter(s=>s.trim())){const m=line.match(/^([^:：]+)[:：](.+)$/);if(!m||!m[1].trim()||!m[2].trim()||Object.hasOwn(fields[key],m[1].trim()))throw Error('属性请逐行填写“名称：原文”，名称不能重复。');fields[key][m[1].trim()]=m[2].trim();}
            }else fields[key]=value;
          }
          if(fields.photos){
            if(fields.photos.length>20||new Set(fields.photos).size!==fields.photos.length)throw Error('图片链接最多 20 张，不能重复。');
            for(const value of fields.photos){let u;try{u=new URL(value);}catch{throw Error('图片链接格式无效。');}if(u.protocol!=='https:'||u.username||u.password||u.port||!['m.media-amazon.com','images-na.ssl-images-amazon.com','images-eu.ssl-images-amazon.com','images-fe.ssl-images-amazon.com'].includes(u.hostname))throw Error('请使用 Amazon 图片 HTTPS 链接。');}
          }
          if(continuing&&required.some(k=>!hasEvidence(fields[k]??product[k])))throw Error(`${product.asin} 的文字必需资料尚未补齐。`);
          if(!Object.keys(fields).length)return null;
          if(!source.value.trim())throw Error(`${product.asin} 请填写资料来源。`);
          return {asin:product.asin,source:source.value.trim(),fields};
        }).filter(Boolean);
        if(!entries.length&&!continuing)throw Error('请至少填写一项缺失资料。');
        save.disabled=resume.disabled=true;
        const response=await app.client.rpc('save_keyword_comparison_evidence',{p_task_id:t.id,p_revision:state.evidenceRevision||0,p_entries:entries,p_continue:continuing});
        if(response.error)throw response.error;
        await onDone();
        if(continuing){document.getElementById('comparison-review').close();}
        else{document.getElementById('comparison-review').close();await open(t,app,onDone);app.showMessage(message,'资料已保存，未触发取数。补齐文字资料后，可确认费用范围并继续。','success');}
      }catch(error){app.showMessage(message,app.humanError(error));}
      finally{save.disabled=false;resume.disabled=!finiteQuote||t.control_state!=='running';}
    };
    save.onclick=()=>run(false);resume.onclick=()=>run(true);actions.append(save,resume);body.append(actions);
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
      document.getElementById('comparison-review-title').textContent=t.comparison_phase==='needs_evidence'?'补齐产品资料':'竞对对比 · 待确认';
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
        approval.append(approve,document.createTextNode(` 我已逐项审核，确认清洗结果，并批准文本核对费用上限 ¥${state.aiQuote?.maxCny ?? '未返回'}（最多 ${state.aiQuote?.maxCalls ?? '未返回'} 次）。`));
        const button=element('button','确认清单并生成对比','primary-button');button.type='button';
        button.onclick=()=>{
          app.hideMessage(message);
          if (!inputs.length || inputs.some(x=>!x.select.value||!x.reason.value.trim())) return app.showMessage(message,'请逐条填写判定和理由。');
          if (!inputs.some(x=>x.select.value!=='剔除')) return app.showMessage(message,'至少保留一项适用特征。');
          if (!approve.checked || !Number.isFinite(state.aiQuote?.maxCny)) return app.showMessage(message,'请确认清洗结果和文本核对费用。');
          const decisions=inputs.map(x=>({product_feature:x.f.product_feature,decision:x.select.value,reason:x.reason.value.trim(),...(x.select.value==='剔除'?{exclusionBasis:'不属于本产品类型'}:{})}));
          return submit(button,'confirm_keyword_features',{p_task_id:t.id,p_source_digest:state.sourceDigest,p_decisions:decisions,p_ai_max_cny:state.aiQuote.maxCny});
        };
        actions.append(approval,button);body.append(actions);
      } else { body.append(element('p',state.notice || '当前阶段无需确认，请稍后刷新任务。')); if(state.rawFeatureResponse){const details=element('details'),summary=element('summary','查看接口原始返回（已留底）');details.append(summary,element('pre',JSON.stringify(state.rawFeatureResponse,null,2)));body.append(details);} }
    } catch (e) { app.showMessage(message,app.humanError(e)); }
  }
  const api={request,phaseLabels,taskLabel,share,open};
  if (typeof module !== 'undefined' && module.exports) module.exports=api;
  else root.KeywordComparison=Object.freeze(api);
}(typeof window !== 'undefined' ? window : globalThis));
