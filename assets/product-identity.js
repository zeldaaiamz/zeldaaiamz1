(function(root){
 'use strict';
 function sourceAsins(source){
  const ids=[];
  for(const text of String(source||'').match(/https?:\/\/[^\s<>"'，；]+/gi)||[]){
   try{const u=new URL(text);if(!/(^|\.)amazon\.(com|ca|co\.uk|de|fr|it|es|co\.jp|com\.au)$/i.test(u.hostname))continue;
    const m=decodeURIComponent(u.pathname).match(/\/(?:dp|gp\/product|gp\/aw\/d)\/([a-z0-9]{10})(?:\/|$)/i);if(m)ids.push(m[1].toUpperCase());
   }catch{}
  }
  return [...new Set(ids)];
 }
 function assertSource(asin,source){
  const wrong=sourceAsins(source).filter(id=>id!==asin);
  if(wrong.length)throw Error(`${asin} 的资料来源链接属于 ${wrong.join('、')}，请填写该 ASIN 对应的来源，不能混用其他产品资料。`);
 }
 function imageKey(value){
  try{const u=new URL(value);const m=decodeURIComponent(u.pathname).match(/\/images\/I\/([^/.]+)(?:\.[^/]*)?$/);if(!m)return u.origin+u.pathname;return 'amazon-image:'+m[1];}catch{return null;}
 }
 function issues(products){
  const found=[];
  for(const p of products){
   const evidence=p.manualEvidence;
   if(evidence)for(const field of evidence.fields||[]){const source=evidence.fieldSources?.[field]?.source||evidence.source;
    try{assertSource(p.asin,source);}catch(e){found.push({asins:[p.asin],field,reason:e.message});}
   }
  }
  for(let i=0;i<products.length;i++)for(let j=i+1;j<products.length;j++){
   const a=products[i],b=products[j];if(a.asin===b.asin)continue;
   const keys=p=>new Set((p.photos||[]).map(x=>imageKey(typeof x==='string'?x:x.url)).filter(Boolean));
   const ak=keys(a),bk=keys(b),shared=[...ak].filter(k=>bk.has(k));
   const main=p=>imageKey(p.imageUrl||p.photos?.[0]?.url||(typeof p.photos?.[0]==='string'?p.photos[0]:null));
   const sameMain=main(a)&&main(a)===main(b);
   if(sameMain||shared.length>=2)found.push({asins:[a.asin,b.asin],field:'photos',reason:`${a.asin} 与 ${b.asin} ${sameMain?'主图相同':`有 ${shared.length} 张图片相同`}（已忽略图片尺寸后缀），图片归属待核实，暂不能用于诊断。`});
  }
  return found;
 }
 function assertProducts(products){const invalid=issues(products);if(invalid.length)throw Error(invalid.map(x=>x.reason).join('\n'));}
 const api={sourceAsins,assertSource,imageKey,issues,assertProducts};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.KeywordProductIdentity=api;
}(typeof window!=='undefined'?window:globalThis));
