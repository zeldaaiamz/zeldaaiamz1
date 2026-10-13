(function(root){
 'use strict';
 function upgrade(html){
  const doc=new DOMParser().parseFromString(html,'text/html'),panel=doc.querySelector('[data-module-panel="04"]');
  if(!panel||doc.querySelector('#image-setup-entry'))return html;
  const section=doc.createElement('section');section.id='image-setup-entry';section.style.cssText='margin:20px;padding:24px;background:#fff;border:1px solid #cbded5;border-radius:12px';
  const title=doc.createElement('h3');title.textContent='图片诊断准备';
  const note=doc.createElement('p');note.textContent='查看图片资料 → 编辑并确认买家清单 → 查看费用并开始诊断。诊断结果与图片证据显示在 05。';
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
  let row=null,timer=null,submitting=false,lastRevision=null,checklistFeedback=null;
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
   if(!row){body.append(button('读取本任务图片资料（不产生费用）',()=>send('prepare')));return;}
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
    body.append(el('h3','买家下单前需要确认的清单'),el('p','按需增删清单条目，供图片诊断逐项核对。可从已确认的适用特征中取用，也可以自行填写。'));
    const draft=row.command?.action==='confirm'?row.command.input:null;
    const kw=el('input');kw.value=draft?.coreKeyword||state.coreKeyword||'';kw.maxLength=200;kw.setAttribute('aria-label','核心关键词');body.append(kw);
    const rows=el('div'),entries=[],labels={name:'买家需要确认什么',english:'英文要素',source:'依据来源',purchaseReason:'影响购买的原因'};body.append(rows);
    const feedback=el('p');feedback.className='checklist-feedback';feedback.setAttribute('role','alert');checklistFeedback=feedback;
    let fieldId=0;
    function fieldError(input){const error=el('small');error.id=`image-checklist-error-${++fieldId}`;error.className='checklist-error';error.hidden=true;input.setAttribute('aria-describedby',error.id);input.setAttribute('aria-required','true');input.oninput=()=>{input.removeAttribute('aria-invalid');error.hidden=true;error.textContent='';feedback.textContent='';};return error;}
    const keywordError=fieldError(kw);kw.after(keywordError);
    function clearError(input,error){input.removeAttribute('aria-invalid');error.hidden=true;error.textContent='';}
    function mark(input,error,text){input.setAttribute('aria-invalid','true');error.textContent=text;error.hidden=false;}
    function focusInvalid(input){input.scrollIntoView({block:'center'});input.focus({preventScroll:true});}

    function add(){const wrap=el('fieldset'),entry={wrap,errors:{}};
     const feature=el('select');entry.feature=feature;feature.setAttribute('aria-label','引用适用特征');const blank=el('option','选择要引用的适用特征（可选）');blank.value='';feature.append(blank);
     (row.state.features||[]).forEach((f,i)=>{const o=el('option',f.product_feature);o.value=String(i);feature.append(o);});wrap.append(feature);
     for(const [key,label] of [['name','买家需要确认什么'],['english','英文要素'],['source','依据来源'],['purchaseReason','影响购买的原因']]){const l=el('label',label),input=el('textarea');input.rows=2;input.maxLength=2000;input.setAttribute('aria-label',label);input.style.cssText='display:block;width:100%;margin:4px 0 12px';const error=fieldError(input);entry.errors[key]=error;l.append(input,error);wrap.append(l);entry[key]=input;}
     feature.onchange=()=>{if(feature.value==='')return;const f=row.state.features[Number(feature.value)];entry.english.value=f.product_feature;entry.source.value=`04 已确认适用特征：${f.product_feature}。${f.feature_description||''}`;};
     wrap.append(button('删除本条',()=>{entries.splice(entries.indexOf(entry),1);wrap.remove();}));entries.push(entry);rows.append(wrap);
    }
    for(let i=0;i<(draft?.items?.length??1);i++)add();
    draft?.items?.forEach((item,i)=>{const entry=entries[i];if(!entry)return;for(const k of ['name','english','source','purchaseReason'])entry[k].value=item[k]||'';const index=(row.state.features||[]).findIndex(f=>item.sourceFeatures?.includes(f.product_feature));entry.feature.value=index<0?'':String(index);});body.append(button('增加一条',add));
    body.append(feedback);
    body.append(button('确认买家清单并查看费用',()=>{
     feedback.textContent='';message.textContent='';clearError(kw,keywordError);entries.forEach(e=>Object.keys(labels).forEach(k=>clearError(e[k],e.errors[k])));
     const missing=[];
     if(!kw.value.trim()){mark(kw,keywordError,'请填写核心关键词。');missing.push({input:kw,label:'核心关键词'});}
     entries.forEach((e,i)=>Object.entries(labels).forEach(([k,label])=>{if(!e[k].value.trim()){mark(e[k],e.errors[k],`第 ${i+1} 条：请填写${label}。`);missing.push({input:e[k],label:`第 ${i+1} 条的“${label}”`});}}));
     if(missing.length){feedback.textContent=`尚有 ${missing.length} 项未填写，已定位到${missing[0].label}。请补齐红框内容后再次确认。`;focusInvalid(missing[0].input);return;}

     const items=entries.map((e,i)=>({id:`item-${i+1}`,sourceFeatures:e.feature.value===''?[]:[row.state.features[Number(e.feature.value)].product_feature],...Object.fromEntries(['name','english','source','purchaseReason'].map(k=>[k,e[k].value.trim()]))}));
     const seen=new Map();
     for(let i=0;i<items.length;i++){const previous=seen.get(items[i].name);if(previous!==undefined){const text=`第 ${i+1} 条与第 ${previous+1} 条的“买家需要确认什么”重复，请修改。`;mark(entries[i].name,entries[i].errors.name,text);feedback.textContent=text;focusInvalid(entries[i].name);return;}seen.set(items[i].name,i);}

     send('confirm',{sourceDigest:state.sourceDigest,coreKeyword:kw.value.trim(),items});
    }));return;
   }
   const details=el('details'),summary=el('summary','已确认的买家清单');details.append(summary);state.checklist?.items.forEach(i=>details.append(el('p',`${i.name} / ${i.english} · ${i.source} · ${i.purchaseReason}`)));body.append(details);
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
