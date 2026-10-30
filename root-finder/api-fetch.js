'use strict';
// Shared request helper: 15s timeout + readable Chinese errors + retry UI, so pages never stay blank.
(function(){
const TIMEOUT_MS=15000;
function withTimeout(promise,ms,label){let t;return Promise.race([promise,new Promise((_,rej)=>{t=setTimeout(()=>{const e=new Error(label);e.kind='timeout';rej(e);},ms);})]).finally(()=>clearTimeout(t));}
async function request(base,path,body,getToken){
  const token=getToken?await withTimeout(Promise.resolve(getToken()),TIMEOUT_MS,'登录状态读取超时，请刷新页面或重新登录总网站'):'';
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),TIMEOUT_MS);
  let r;
  try{
    r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:controller.signal});
  }catch(err){
    const e=new Error(err.name==='AbortError'?`服务器 ${TIMEOUT_MS/1000} 秒内没有响应（可能正在重启或已卡住），请稍后重试`:'无法连接服务器，请检查网络后重试');
    e.kind=err.name==='AbortError'?'timeout':'network';throw e;
  }finally{clearTimeout(timer);}
  const data=await r.json().catch(()=>({}));
  if(!r.ok){const e=new Error(data.error||(r.status===401?'登录已失效，请重新登录总网站':`服务返回错误 ${r.status}`));e.status=r.status;throw e;}
  return data;
}
function showError(el,prefix,err,retry){
  el.replaceChildren(document.createTextNode(`${prefix}${err.message} `));
  if(retry){const b=document.createElement('button');b.type='button';b.textContent='重试';b.onclick=async()=>{b.disabled=true;b.textContent='重试中…';el.replaceChildren(document.createTextNode('正在重新读取…'));try{await retry();el.textContent='';}catch(e){showError(el,prefix,e,retry);}};el.append(b);}
}
window.RootFinderFetch={TIMEOUT_MS,request,showError};
})();
