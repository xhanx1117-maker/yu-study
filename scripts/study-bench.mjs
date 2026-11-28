import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {PDFDocument} from 'pdf-lib';
import {testServer} from './test-server.mjs';
import {initial} from '../src/model.js';

const pdf=await PDFDocument.create();pdf.addPage([500,700]);
const bytes=Array.from(await pdf.save());
const server=testServer({sourceModules:true});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,executablePath:process.env.YU_BROWSER});
const counts=(process.env.YU_STUDY_COUNTS||'100,500,1000,3000').split(',').map(Number);
const ms=async fn=>{const t=performance.now();await fn();return Math.round(performance.now()-t)};
async function seed(page,count){
  await page.goto(origin+'/seed.html');
  await page.evaluate(async({archive,bytes,count})=>{
    const db=await new Promise((resolve,reject)=>{
      const req=indexedDB.open('yu-study-archive',1);
      req.onupgradeneeded=()=>{req.result.createObjectStore('meta');req.result.createObjectStore('files')};
      req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
    });
    const write=(name,fn)=>new Promise((resolve,reject)=>{
      const tx=db.transaction(name,'readwrite');fn(tx.objectStore(name));tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);
    });
    const subjects=['행정법','행정학','영어','국어'],yearStart=Date.UTC(2026,0,1,3),pdf=new Uint8Array(bytes);
    for(let start=0;start<count;start+=80){
      const files=[];
      for(let i=start;i<Math.min(count,start+80);i++){
        const blob=new Blob([pdf,'\n%fixture '+i],{type:'application/pdf'});
        const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].map(n=>n.toString(16).padStart(2,'0')).join('');
        const id='paper-'+i,subject=subjects[i%4],title=subject+' 가상 시험 '+String(i).padStart(4,'0');
        files.push([hash,blob]);archive.documents.push({id,hash,type:'기출문제지',title,year:'2026',exam:'국가직 9급',grade:'9급',form:'가',subject,count:20,size:blob.size,session:id+'-12'});
        for(let n=1;n<=4;n++)archive.questions.push({id:id+'#'+n,doc:id,number:n,regions:[],secondary:[],theme:null,status:'미복습',memo:''});
        for(let j=0;j<13;j++){
          const session=id+'-'+j,day=(i+j*7)%330,time=new Date(yearStart+day*86400000).toISOString();
          archive.sessions.push({id:session,doc:id,date:time,...(j%3===0?{solvedAt:time}:{})});
          if(j===12)continue;
          const number=j%4+1;
          archive.events.push({id:session+'#'+number,q:id+'#'+number,session,number,date:time,instance:'synthetic-'+i+'-'+j});
        }
      }
      await write('files',store=>{for(const [key,blob] of files)store.put(blob,key)});
    }
    await write('meta',store=>store.put(archive,'archive'));db.close();
  },{archive:initial(),bytes,count});
}
async function frameSample(page,reduced){
  await page.emulateMedia({reducedMotion:reduced?'reduce':'no-preference'});
  return page.evaluate(async()=>{
    const frames=[];
    const button=document.querySelector('.material-title');
    const press=type=>button.dispatchEvent(new PointerEvent(type,{bubbles:true,isPrimary:true,pointerType:'touch',pointerId:2,button:0}));
    let previous=await new Promise(requestAnimationFrame);
    for(let i=0;i<30;i++){
      if(i%10===0)press('pointerdown');else if(i%10===3)press('pointerup');
      window.scrollBy(0,i<15?55:-55);
      const t=await new Promise(requestAnimationFrame);frames.push(t-previous);previous=t;
    }
    press('pointerup');return frames.sort((a,b)=>a-b)[Math.floor(frames.length*.95)];
  });
}
try{
  for(const count of counts){
    const ctx=await browser.newContext({viewport:{width:834,height:1194},hasTouch:true});
    try{
      const page=await ctx.newPage();await seed(page,count);
      const m={documents:count,mistakes:count*12,completions:count*5};
      const home=()=>page.getByRole('heading',{name:'학습 서재'}).waitFor();
      m.firstUpgradeMs=await ms(async()=>{await page.goto(origin+'/yu-study/');await home()});
      m.reopenMs=await ms(async()=>{await page.reload();await home()});
      const nav=name=>page.locator('nav').getByRole('button',{name,exact:true}).click();
      const card=()=>page.locator('[data-card]').first().waitFor();
      m.libraryMs=await ms(async()=>{await nav('자료실');await card()});
      m.renderedCards=await page.locator('[data-card]').count();assert.ok(m.renderedCards<=48);
      m.subjectTabMs=await ms(async()=>{await page.locator('[data-lib-sub="행정법"]').click();await page.locator('[data-lib-sub="행정법"][aria-pressed=true]').waitFor()});
      m.searchMs=await ms(async()=>{await page.locator('#query').fill('0000');await page.waitForFunction(()=>document.querySelectorAll('[data-card]').length===1)});
      await page.locator('#query').fill('');await page.waitForFunction(()=>document.querySelectorAll('[data-card]').length>1);
      const frames=[[],[]];
      for(const reduced of [false,true,true,false])frames[Number(reduced)].push(await frameSample(page,reduced));
      const round=x=>+x.toFixed(1);
      m.scrollP95ms={motion:frames[0].map(round),reduced:frames[1].map(round)};
      await page.emulateMedia({reducedMotion:'no-preference'});
      m.notebookMs=await ms(async()=>{await nav('오답노트');await page.locator('#study-log').waitFor()});
      m.daily=await page.evaluate(async count=>{
        const {queryStudy}=await import('/proof-src/study-query.js');
        const {studyReport,reportText}=await import('/proof-src/study-report.js');
        let forbidden=0;const proto=IDBTransaction.prototype,original=proto.objectStore;
        proto.objectStore=function(name){if(name==='meta'||name==='files')forbidden++;return original.call(this,name)};
        const out={},to=count===100?'2026-04-05':'2026-09-20',monthStart=count===100?'2026-03-07':'2026-08-22';
        try{
          for(const [key,from,subject] of [['oneDay',to,''],['monthSubject',monthStart,'행정법'],['monthAll',monthStart,'']]){
            const measurements=[];let rowCount;
            for(let i=0;i<5;i++){
              const start=performance.now(),rows=await queryStudy(from,to,subject),queried=performance.now();
              const report=studyReport(rows,{from,to,subject});reportText(report);
              measurements.push([queried-start,performance.now()-start]);rowCount=rows.length;
            }
            out[key]={rows:rowCount,queryMedianMs:+measurements.map(x=>x[0]).sort((a,b)=>a-b)[2].toFixed(1),withTextMedianMs:+measurements.map(x=>x[1]).sort((a,b)=>a-b)[2].toFixed(1)};
          }
        }finally{proto.objectStore=original}
        return {...out,originalArchiveReads:forbidden};
      },count);
      for(const key of ['oneDay','monthSubject','monthAll'])assert.ok(m.daily[key].rows>0);
      assert.equal(m.daily.originalArchiveReads,0);
      const cdp=await ctx.newCDPSession(page);m.retainedHeapMiB=[];
      for(let i=0;i<7;i++){
        await page.locator('#study-log').click();await page.waitForFunction(()=>!document.querySelector('#study-summary')?.textContent.includes('읽는 중'));
        await page.locator('dialog form button').click();
        await nav('자료실');await card();await nav('오답노트');await page.locator('#study-log').waitFor();
        if(i%2===0){await cdp.send('HeapProfiler.collectGarbage');m.retainedHeapMiB.push(round((await cdp.send('Runtime.getHeapUsage')).usedSize/1048576))}
      }
      const usage=(await page.evaluate(()=>navigator.storage.estimate())).usage;m.storageMiB=round(usage/1048576);
      console.log(JSON.stringify(m));
    }finally{await ctx.close()}
  }
}finally{await browser.close();await new Promise(resolve=>server.close(resolve))}
