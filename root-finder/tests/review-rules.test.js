// node root-finder/tests/review-rules.test.js
const fs=require('fs'),path=require('path'),dir=path.join(__dirname,'..');
const a=fs.readFileSync(path.join(dir,'app.js'),'utf8');
const grab=n=>{const i=a.indexOf('function '+n+'(');let d=0;for(let k=a.indexOf('{',i);;k++){if(a[k]=='{')d++;if(a[k]=='}'&&--d==0)return a.slice(i,k+1);}};
eval(fs.readFileSync(path.join(dir,'quality.js'),'utf8').split('\n').slice(0,6).join('\n')+';'+a.match(/const hasPrice=[^\n;]*;/)[0]+grab('screeningRaw')+';'+a.match(/const REVIEW_LIMIT[^\n]*/)[0]+';'+grab('reviewCount')+';'+grab('applyReviewRules')+';globalThis.S=screeningRaw');
const row=(rc,hi,hr)=>({queried:true,products:[...Array(10)].map((_,i)=>({asin:'A'+i,price:hi.includes(i)?100:10,title:'Notebook 2 Pack 8.5 x 11 inch',monthlyPurchases:'100+',ratingCount:hi.includes(i)?hr[hi.indexOf(i)]:rc}))});
const t=(name,r,f)=>{const m=S(r,5,0,50);if(!f(m))throw Error(name+' '+JSON.stringify(m));};
t('single>500',row(10,[0],[600]),r=>!r.anomalies.length&&r.anomalyReviewExcluded&&r.priceFloor);
t('single<=500',row(10,[0],[500]),r=>r.anomalies.length==1);
t('multi all>500',row(10,[0,1],[600,'1,200']),r=>!r.anomalies.length);
t('multi mixed',row(10,[0,1],[600,300]),r=>r.anomalies.length==2);
t('missing reviews',row(10,[0],[null]),r=>r.anomalies.length==1);
t('top10 all>500',row(900,[],[]),r=>r.reviewExcluded&&!r.priceFloor);
t('lowcomp untouched',{queried:true,products:[{asin:'x',price:9,ratingCount:9999}]},r=>r.lowCompetition&&!r.reviewExcluded);
console.log('review rules ok');
