(function(root){
 'use strict';
 function upgrade(html){
  const doc=new DOMParser().parseFromString(html,'text/html'),panel=doc.querySelector('[data-module-panel="04"]');
  if(!panel||doc.querySelector('#image-setup-entry'))return html;
  const section=doc.createElement('section');section.id='image-setup-entry';section.style.cssText='margin:20px;padding:24px;background:#fff;border:1px solid #cbded5;border-radius:12px';
  const title=doc.createElement('h3');title.textContent='图片诊断准备';
  const note=doc.createElement('p');note.textContent='查看图片资料 → AI 起草中文买家问题 → 确认或修改 → 查看图片诊断费用。诊断结果与图片证据显示在 05。';
  const button=doc.createElement('button');button.type='button';button.textContent='打开图片资料与确认清单';button.id='open-image-setup';button.style.cssText='padding:12px 20px;background:#18745d;color:white;border:0;border-radius:8px;cursor:pointer';
  section.append(title,note,button);panel.prepend(section);
  const script=doc.createElement('script');script.textContent=`document.getElementById('open-image-setup').addEventListener('click',()=>parent.postMessage({type:'keyword-images-open'},'*'));window.addEventListener('message',e=>{if(e.source===parent&&e.data?.type==='keyword-images-show-results')document.querySelector('[data-module="05"]')?.click();});`;doc.body.append(script);
  return '<!doctype html>\n'+doc.documentElement.outerHTML;
 }
 function mount({app,taskId,frame,onUpdated}){
  const el=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
  const dialog=el('dialog');dialog.id='image-setup-dialog';dialog.style.cssText='box-sizing:border-box;width:min(1100px,calc(100vw - 24px));max-height:90vh;font-family:system-ui,sans-serif;line-height:1.65;border:1px solid #ccdcd4;border-radius:16px;padding:24px;overflow:auto';
  const style=el('style');style.textContent='#image-setup-dialog button{max-width:100%;white-space:normal;margin:8px 8px 8px 0}#image-setup-dialog fieldset{min-width:0;border:1px solid #d7e4db;border-radius:10px;margin:14px 0;padding:16px}#image-setup-dialog input,#image-setup-dialog textarea,#image-setup-dialog select{box-sizing:border-box;max-width:100%}#image-setup-dialog p{overflow-wrap:anywhere}#image-setup-dialog [aria-invalid=true]{border:2px solid #b42318;background:#fff5f4}#image-setup-dialog .checklist-error{display:block;color:#b42318;font-size:14px}#image-setup-dialog .checklist-feedback{color:#b42318;font-weight:600}#image-setup-dialog .checklist-error[hidden],#image-setup-dialog .checklist-feedback:empty{display:none}#image-setup-dialog::backdrop{background:rgba(20,40,30,.4)}';dialog.append(style);
  const close=el('button','关闭'),title=el('h2','04 · 图片诊断准备'),message=el('p'),body=el('div');message.setAttribute('role','status');close.onclick=()=>dialog.close();dialog.append(close,title,message,body);document.body.append(dialog);
  let row=null,timer=null,submitting=false,lastRevision=null,checklistFeedback=null;const draftRequested=new Set();
  const notify=e=>{message.textContent=e.message||String(e);if(checklistFeedback){checklistFeedback.textContent=message.textContent;checklistFeedback.scrollIntoView({block:'nearest'});}else message.scrollIntoView({block:'nearest'});};
  async function send(action,input={}){
   if(submitting)return;submitting=true;body.querySelectorAll('button').forEach(b=>b.disabled=true);message.textContent='正在提交…';if(checklistFeedback)checklistFeedback.textContent='正在提交买家清单…';
   try{const r=await app.client.rpc('request_keyword_images',{p_task_id:taskId,p_revision:row?.revision??0,p_action:action,p_input:input});if(r.error)throw r.error;await load();}
   catch(e){notify(e);body.querySelectorAll('button').forEach(b=>b.disabled=false);}finally{submitting=false;}
  }
  function button(text,fn){const b=el('button',text);b.type='button';b.className='primary-button';b.onclick=fn;return b;}
  function resultButton(){return button('查看 05 诊断结果',()=>{dialog.close();frame.contentWindow.postMessage({type:'keyword-images-show-results'},'*');});}
  function render(){
   body.replaceChildren();checklistFeedback=null;message.textContent=row?.error||'';
   if(!row){body.append(button('读取资料并生成 AI 买家清单',()=>send('prepare')));return;}
   if(['queued','running'].includes(row.status)){body.append(el('p',row.status==='queued'?'已提交，等待处理。':'正在处理，请勿重复提交。'));body.append(el('p','若长时间未完成，请保留当前任务并联系维护；系统不会自动重复付费调用。'));return;}
   const state=row.state?.workflow;
   if(!state){body.append(button('重新读取图片资料',()=>send('prepare')));return;}
   try{if(!root.KeywordProductIdentity)throw Error('图片归属校验未加载，请刷新页面。');root.KeywordProductIdentity.assertProducts(state.products||[]);}catch(e){body.append(el('p',e.message),el('p','图片归属存在冲突，请先修正来源资料，再刷新。当前不能确认清单或启动诊断。'),button('刷新图片资料',()=>send('prepare')));return;}
   const gallery=el('div');gallery.style.cssText='display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px';
   state.products.forEach(p=>{const card=el('section');card.append(el('h3',`${p.role==='own'?'我方':'竞对'} ${p.asin} · ${p.photos.length} 张`),el('p',p.title));p.photos.forEach(photo=>{const a=el('a'),img=el('img');a.href=photo.url;a.target='_blank';a.rel='noopener noreferrer';img.src=photo.url;img.alt=photo.label;img.referrerPolicy='no-referrer';img.style.cssText='width:90px;height:90px;object-fit:contain';img.onerror=()=>{img.replaceWith(el('span',`${photo.label} 加载失败`));};a.append(img);card.append(a);});gallery.append(card);});body.append(gallery);
   if(state.missing.length){body.append(el('p',`缺少图片：${state.missing.join('、')}。请联系维护人员补齐这些 ASIN 的图片资料后刷新，暂不能启动诊断。`));}
   if(row.status==='error'){body.append(button('刷新资料与当前进度',()=>send('prepare')));return;}
   body.append(button('刷新图片资料与阶段',()=>send('prepare')));
   if(state.status==='awaiting_checklist'){
    body.append(el('h3','买家需要确认什么（中文）'),el('p','AI 已根据适用特征起草简短问题。逐条确认；需要调整时点击“修改”。可自由增删。'));
    const suggestion=row.state.checklistDraft;
    if(!suggestion){body.append(el('p','正在准备 AI 中文建议…'));return;}
    const rows=el('div'),entries=[];body.append(rows);
    const feedback=el('p');feedback.className='checklist-feedback';feedback.setAttribute('role','alert');checklistFeedback=feedback;
    let nextId=0;
    function add(item){
     const wrap=el('fieldset'),label=el('label','买家需要确认什么（中文）'),input=el('textarea'),error=el('small'),status=el('p');
     const entry={wrap,input,error,confirmed:false,id:item?.id||`manual-${Date.now()}-${++nextId}`};
     input.value=item?.name||'';input.rows=2;input.maxLength=2000;input.readOnly=Boolean(item?.name);input.style.cssText='display:block;width:100%;margin:6px 0';input.setAttribute('aria-label','买家需要确认什么（中文）');input.setAttribute('aria-required','true');
     error.className='checklist-error';error.hidden=true;error.id=`buyer-question-error-${++nextId}`;input.setAttribute('aria-describedby',error.id);status.textContent=item?.origin==='ai'?'AI 建议 · 待确认':'手动填写 · 待确认';
     function problem(text){error.textContent=text;error.hidden=false;input.setAttribute('aria-invalid','true');input.scrollIntoView({block:'center'});input.focus({preventScroll:true});}
     function clear(){error.hidden=true;error.textContent='';input.removeAttribute('aria-invalid');feedback.textContent='';}
     const confirm=button('确认',()=>{clear();if(!input.value.trim())return problem('请填写买家需要确认什么。');if(!/[\u3400-\u9fff]/.test(input.value))return problem('请用中文填写买家问题。');entry.confirmed=true;input.readOnly=true;confirm.disabled=true;confirm.textContent='已确认';status.textContent='已确认';});
     const modify=button('修改',()=>{clear();entry.confirmed=false;input.readOnly=false;confirm.disabled=false;confirm.textContent='确认';status.textContent='修改中 · 请确认修改结果';input.focus();});
     input.oninput=()=>{clear();entry.confirmed=false;confirm.disabled=false;confirm.textContent='确认';};
     const remove=button('删除本条',()=>{entries.splice(entries.indexOf(entry),1);wrap.remove();feedback.textContent='';});
     entry.problem=problem;label.append(input,error);wrap.append(label,status,confirm,modify,remove);entries.push(entry);rows.append(wrap);
    }
    suggestion.items.forEach(add);
    body.append(button('增加一条',()=>add()),feedback,button('保存已确认清单并查看图片诊断费用',()=>{
     feedback.textContent='';message.textContent='';
     const unconfirmed=entries.find(e=>!e.confirmed);
     if(unconfirmed){feedback.textContent='请先逐条确认买家问题；需要调整可点击“修改”。';unconfirmed.problem('这一条尚未确认。');return;}
     const seen=new Set();for(const e of entries){if(seen.has(e.input.value.trim())){e.problem('此问题与其他条目重复，请修改或删除。');return;}seen.add(e.input.value.trim());}
     send('confirm',{schemaVersion:2,draftVersion:suggestion.version,sourceDigest:state.sourceDigest,coreKeyword:suggestion.coreKeyword||state.coreKeyword,items:entries.map(e=>({id:e.id,name:e.input.value.trim(),confirmed:true}))});
    }));return;
   }
   const details=el('details'),summary=el('summary','已确认的买家清单');details.append(summary);state.checklist?.items.forEach(i=>details.append(el('p',i.name)));body.append(details);
   if(['awaiting_own_approval','awaiting_competitor_approval'].includes(state.status)){
    const q=row.state.quote;
    if(q){body.append(el('h3',q.stage==='own'?'我方图片诊断费用':`竞对 ${q.competitorAsin} 图片对比费用`),el('p',`本次 ${q.imageCount} 张图片，最多 ${q.maxCalls} 次调用，费用上限 ¥${q.maxCny}。模型：${q.model}。`),el('p',`报价依据：${q.pricingReference}；核实时间：${q.verifiedAt}`));const run=button('确认上述费用并开始本阶段诊断',()=>send('run',{quoteDigest:q.quoteDigest}));run.disabled=state.missing.length>0;body.append(run);}
    else body.append(el('p',`暂不能确认费用：${row.state.quoteError||'报价尚未准备完成'}。请维护人员核实视觉模型及当前报价后再刷新。`));
    body.append(button('刷新本阶段报价',()=>send('quote')));
   }else if(['awaiting_own_review','awaiting_competitor_review'].includes(state.status)){
    body.append(el('p','本阶段诊断已生成。请到 05 查看结果后，返回此处验收；验收不会自动启动下一次付费调用。'),resultButton());
    const seen=el('input');seen.type='checkbox';const label=el('label',' 我已查看 05 本阶段图片证据与结果');label.prepend(seen);body.append(label);
    const accept=button('验收本阶段结果',()=>send('accept'));accept.disabled=true;seen.onchange=()=>accept.disabled=!seen.checked;body.append(accept);
   }else if(state.status==='complete')body.append(el('p','图片诊断及逐家验收全部完成。'),resultButton());
  }
  async function load(){
   clearTimeout(timer);
   try{const r=await app.client.from('keyword_image_sessions').select('*').eq('task_id',taskId).maybeSingle();if(r.error)throw r.error;row=r.data;render();
    if(row?.status==='ready'&&row.state?.workflow?.status==='awaiting_checklist'&&!row.state.checklistDraft&&!draftRequested.has(row.state.workflow.sourceDigest)){draftRequested.add(row.state.workflow.sourceDigest);await send('draft');return;}
    if(row?.status==='ready'&&lastRevision!==row.revision){lastRevision=row.revision;await onUpdated();}
    if(row&&['queued','running'].includes(row.status)&&dialog.open)timer=setTimeout(load,2500);
   }catch(e){notify(e);}
  }
  dialog.addEventListener('close',()=>clearTimeout(timer));
  const listener=async e=>{if(e.source!==frame.contentWindow||e.data?.type!=='keyword-images-open')return;if(!dialog.open)dialog.showModal();await load();};window.addEventListener('message',listener);
  return {open:async()=>{dialog.showModal();await load();},dispose:()=>{clearTimeout(timer);dialog.remove();window.removeEventListener('message',listener);}};
 }
 root.KeywordImageSetup={upgrade,mount};
}(window));
