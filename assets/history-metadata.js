(function(){'use strict';
const dates=new Map(),reports=new Map();
function date(value,date1904=false){const s=String(value??'').trim();if(!s)return null;
 let y,m,d,match;if(/^\d+(?:\.\d+)?$/.test(s)){const n=Number(s);if(n<1||n>100000)return null;return new Date(Date.UTC(date1904?1904:1899,date1904?0:11,date1904?1:30)+Math.floor(n)*86400000).toISOString().slice(0,10);}
 if((match=s.match(/^(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})(?:日|(?:T|\s).*)?$/))){[,y,m,d]=match;}
 else if((match=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/))){[,m,d,y]=match;}
 else {const months={jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12};match=s.match(/^(\d{1,2})[- ]([A-Za-z]+)[- ,]+(\d{4})$/);if(match){d=match[1];m=months[match[2].slice(0,3).toLowerCase()];y=match[3];}else {match=s.match(/^([A-Za-z]+) +(\d{1,2}),? +(\d{4})$/);if(!match)return null;m=months[match[1].slice(0,3).toLowerCase()];d=match[2];y=match[3];}}
 const out=new Date(Date.UTC(Number(y),Number(m)-1,Number(d)));return out.getUTCFullYear()===Number(y)&&out.getUTCMonth()+1===Number(m)&&out.getUTCDate()===Number(d)?out.toISOString().slice(0,10):null;
}
function csv(text){const rows=[];let row=[],cell='',quoted=false;for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}else if(!quoted&&(c===','||c==='\n'||c==='\r')){row.push(cell);cell='';if(c!==','){if(c==='\r'&&text[i+1]==='\n')i++;if(row.some(Boolean))rows.push(row);row=[];}}else cell+=c;}row.push(cell);if(row.some(Boolean))rows.push(row);return rows;}
function ranges(rows,date1904=false){if(!rows.length)return[];const headers=rows[0].map(v=>String(v??'').replace(/^\uFEFF/,'').trim()),start=headers.findIndex(h=>['开始日期','Start Date'].includes(h)),end=headers.findIndex(h=>['结束日期','End Date'].includes(h));if(start<0||end<0)return[];const found=new Set();for(const r of rows.slice(1)){const a=date(r[start],date1904),b=date(r[end],date1904);if(a&&b&&a<=b)found.add(a+' 至 '+b);}const pairs=[...found].sort().map(s=>s.split(' 至 ')),merged=[];for(const pair of pairs){const last=merged.at(-1);if(last&&Date.parse(pair[0])<=Date.parse(last[1])+86400000)last[1]=last[1]>pair[1]?last[1]:pair[1];else merged.push(pair);}return merged.map(pair=>pair.join(' 至 '));}
function xml(bytes){const doc=new DOMParser().parseFromString(new TextDecoder().decode(bytes),'application/xml');if(doc.querySelector('parsererror'))throw Error('Invalid spreadsheet XML');return doc;}
function uploadRanges(bytes,path){if(/\.csv$/i.test(path))return ranges(csv(new TextDecoder().decode(bytes)));
 if(!window.fflate)throw Error('Spreadsheet reader unavailable');let total=0;const files=window.fflate.unzipSync(new Uint8Array(bytes),{filter:f=>{const wanted=/^xl\/(?:workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|worksheets\/[^/]+\.xml)$/.test(f.name);if(wanted){total+=f.originalSize;if(total>100*1024*1024)throw Error('Spreadsheet XML too large');}return wanted;}});
 const workbook=xml(files['xl/workbook.xml']),rels=xml(files['xl/_rels/workbook.xml.rels']),first=workbook.getElementsByTagName('sheet')[0],rid=first?.getAttribute('r:id'),rel=[...rels.getElementsByTagName('Relationship')].find(r=>r.getAttribute('Id')===rid);let target=rel?.getAttribute('Target')||'';target=target.startsWith('/')?target.slice(1):'xl/'+target.replace(/^\.\//,'');if(!/^xl\/worksheets\/[^/]+\.xml$/.test(target)||!files[target])throw Error('First worksheet missing');
 const shared=files['xl/sharedStrings.xml']?[...xml(files['xl/sharedStrings.xml']).getElementsByTagName('si')].map(si=>[...si.getElementsByTagName('t')].map(t=>t.textContent).join('')):[];
 const rows=[...xml(files[target]).getElementsByTagName('row')].map(row=>{const out=[];for(const c of row.getElementsByTagName('c')){const letters=(c.getAttribute('r')||'').match(/^[A-Z]+/)?.[0];if(!letters)continue;let col=0;for(const ch of letters)col=col*26+ch.charCodeAt(0)-64;const type=c.getAttribute('t'),v=c.getElementsByTagName('v')[0]?.textContent||'';out[col-1]=type==='s'?shared[Number(v)]:type==='inlineStr'?[...c.getElementsByTagName('t')].map(t=>t.textContent).join(''):v;}return out;});const epoch=workbook.getElementsByTagName('workbookPr')[0]?.getAttribute('date1904');return ranges(rows,epoch==='1'||epoch==='true');
}
function generation(html,task){
 const unknown={generated:null,generatedAt:null};
 const doc=new DOMParser().parseFromString(html,'text/html');
 const text=doc.body?.textContent||'';
 if(!text.includes(task.asin)||(!html.includes(task.id)&&!(task.report_url?.endsWith('/'+task.id+'.html')&&doc.title.includes(task.asin))))return unknown;
 const footer=[...doc.querySelectorAll('.footer')].map(e=>e.textContent).join(' ');
 const iso=footer.match(/生成于\s*(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?Z\b/);
 if(iso){
   const time=new Date(iso[1]+(iso[2]?'.'+iso[2]:'')+'Z');
   if(Number.isFinite(time.getTime())&&time.toISOString().startsWith(iso[1]+'.')){
     const generated=new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(time).replaceAll('/','-');
     return {generated,generatedAt:iso[1]+'.'+(iso[2]||'').padEnd(9,'0')+'Z'};
   }
 }
 const header=[...doc.querySelectorAll('.module-stage > .wrap p,.hero')].map(e=>e.textContent).join(' ');
 return {generated:date(header.match(/完成于[：:]\s*(\d{4}年\d{1,2}月\d{1,2}日)/)?.[1]),generatedAt:null};
}

const waitingDownloads=[];
const downloadTimeoutMs=10000;
let activeDownloads=0;
let downloadScope=new AbortController();
async function download(app,bucket,path){
 const scope=downloadScope.signal;
 if(activeDownloads>=2)await new Promise(resolve=>waitingDownloads.push(resolve));
 else activeDownloads++;
 try{
   if(scope.aborted)throw Error('Storage download cancelled');
   const transfer=new AbortController();
   const cancel=()=>transfer.abort();
   const interrupted=new Promise((_,reject)=>{
     transfer.signal.addEventListener('abort',()=>reject(Error('Storage download interrupted')),{once:true});
   });
   scope.addEventListener('abort',cancel,{once:true});
   const timer=setTimeout(cancel,downloadTimeoutMs);
   try{
     const request=app.client.storage.from(bucket).download(path,undefined,{signal:transfer.signal});
     const result=await Promise.race([request,interrupted]);
     if(result.error||!result.data)throw result.error||Error('Saved file missing');
     return result.data;
   }finally{
     clearTimeout(timer);
     scope.removeEventListener('abort',cancel);
   }
 }finally{
   const next=waitingDownloads.shift();
   if(next)next();
   else activeDownloads--;
 }
}
function cached(cache,key,read){
 if(cache.has(key))return cache.get(key);
 const work=read().catch(error=>{
   if(cache.get(key)===work)cache.delete(key);
   throw error;
 });
 cache.set(key,work);
 return work;
}
const reportKey=task=>JSON.stringify([task.id,task.report_url,task.updated_at]);
async function loadGeneration(app,task){
 try{
   return await cached(reports,reportKey(task),async()=>{
     const blob=await download(app,app.config.reportBucket,task.report_url);
     return generation(await blob.text(),task);
   });
 }catch{
   return {generated:null,generatedAt:null,generationError:true};
 }
}
async function loadRanges(app,task){
 const uploadPath=task.recovered_source?.upload_path||task.upload_path;
 try{
   if(!uploadPath)throw Error('Upload missing');
   const ranges=await cached(dates,uploadPath,async()=>{
     const {bytes}=await window.KeywordVerifiedSource.readVerifiedSource(app,uploadPath,{signal:downloadScope.signal});
     return uploadRanges(bytes,uploadPath);
   });
   return {ranges};
 }catch(error){
   return {ranges:[],rangeError:true,rangeMissing:error?.code==='SOURCE_MISSING'};
 }
}
window.KeywordHistoryMetadata={loadGeneration,loadRanges,reportKey,date,csv,ranges,uploadRanges,
 generatedDate(html,task){return generation(html,task).generated;},
 clear(){
   downloadScope.abort();
   downloadScope=new AbortController();
   dates.clear();
   reports.clear();
 }
};
}());
