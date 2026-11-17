// node root-finder/tests/sif-points.test.js — 入队预计点数 / SIF 余额 / 两步查跳过 的文案
const fs=require('fs'),path=require('path');
globalThis.window={};
eval(fs.readFileSync(path.join(__dirname,'..','sif-points.js'),'utf8'));
const {estimateText,quotaText,skippedText}=window.RootFinderPoints;
const ok=(n,c)=>{if(!c)throw Error(n);console.log('ok',n);};
ok('approx estimate for new root',estimateText({keywords:120,approx:true,maxPoints:2643,expectedPoints:603})==='预计约 603 点（最多 2643 点，按历史平均约 120 个词估算）');
ok('exact estimate',estimateText({keywords:92,approx:false,maxPoints:2024,expectedPoints:460})==='预计约 460 点（最多 2024 点，待查 92 个词）');
ok('no estimate → empty',estimateText(null)===''&&estimateText(undefined)==='');
ok('zero keywords',estimateText({keywords:0,approx:false,maxPoints:0,expectedPoints:0})==='不需要再花点数');
ok('quota text',quotaText({remaining:14,checkedAt:'2026-11-17T04:20:00+00:00'})==='SIF 剩余 14 点');
ok('quota unknown → empty',quotaText({remaining:null})===''&&quotaText(null)==='');
ok('skipped text',skippedText(5)==='两步查省下 5 个词的商品资料'&&skippedText(0)==='');
console.log('sif points ok');
