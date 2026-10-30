// node root-finder/tests/result-search.test.js
const fs=require('fs'),path=require('path'),a=fs.readFileSync(path.join(__dirname,'..','app.js'),'utf8');
const grab=n=>{const i=a.indexOf('function '+n+'(');if(i<0)throw Error('missing '+n);let d=0;for(let k=a.indexOf('{',i);;k++){if(a[k]=='{')d++;if(a[k]=='}'&&--d==0)return a.slice(i,k+1);}};
const els={};const $=s=>els[s]||(els[s]={value:'',textContent:'',checked:false,indeterminate:false,disabled:false});
let current={id:'r1',data:{keywordRoot:'Squishy'}},busy=false,curationBusy=false,selectionContext='',selectedResults=new Set();
const M={a:{youngMarket:['x'],priceFloor:false,lowCompetition:false,anomalies:[]},b:{youngMarket:[],priceFloor:true,lowCompetition:false,anomalies:[]}};
const rowMatch=r=>M[r.kind],resultKey=r=>r.keyword,window={};
eval([grab('rowRecord'),grab('methodMatch'),grab('resultSearchMatch'),grab('delBlocked'),grab('syncResultSelection')].join('\n'));
const other={id:'r2',data:{keywordRoot:'Note'}};
const rows=[{keyword:'Dumpling Squishy',translation:'饺子捏捏',kind:'a'},{keyword:'cat toy',translation:'猫玩具',kind:'b'},{keyword:'sticky note',translation:'便利贴',kind:'a',_source:other}];
const vis=(m,q)=>rows.filter(r=>methodMatch(r,m)&&resultSearchMatch(r,q)).map(r=>r.keyword);
const eq=(x,y,n)=>{if(JSON.stringify(x)!==JSON.stringify(y))throw Error(n+' '+JSON.stringify(x));};
eq(vis('all','dumpling'),['Dumpling Squishy'],'en ci');eq(vis('all','猫'),['cat toy'],'zh');
eq(vis('all','squishy'),['Dumpling Squishy','cat toy'],'source keyword');eq(vis('all','NOTE'),['sticky note'],'source ci');
eq(vis('young_market','squishy'),['Dumpling Squishy'],'tab+search');eq(vis('price_floor',''),['cat toy'],'empty query');eq(vis('all','zzz'),[],'none');
$('#resultMethod').value='all';selectionContext='r1:all';selectedResults=new Set(rows.map(resultKey));
syncResultSelection(rows.filter(r=>resultSearchMatch(r,'猫')));eq([...selectedResults],['cat toy'],'prune hidden selections');
if(!$('#resultSelectAll').checked)throw Error('select all state');eq($('#resultSelectedCount').textContent,'已选 1 / 1 条','count');
console.log('result search ok');
