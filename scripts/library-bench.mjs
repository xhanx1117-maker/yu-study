import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {initial} from '../src/model.js';
import {testServer} from './test-server.mjs';

const require=createRequire(import.meta.url);
const {chromium}=require('playwright');
const {PDFDocument,StandardFonts}=require('pdf-lib');
const template=await PDFDocument.create(),font=await template.embedFont(StandardFonts.Helvetica);
for(let n=1;n<=4;n++){
  const page=template.addPage([728,1031]);
  for(let q=0;q<5;q++)page.drawText((5*n-4+q)+'. Synthetic question\n    A. First choice    B. Second choice',{font,size:12,x:30,y:910-q*160});
}
const bytes=Array.from(await template.save());
const server=testServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,executablePath:process.env.YU_BROWSER});
try{
  for(const n of [100,500,1000]){
    const ctx=await browser.newContext({viewport:{width:834,height:1194},hasTouch:true});
    const page=await ctx.newPage();await page.goto(url+'/seed.html');
    await page.evaluate(async({count,seed,bytes})=>{
      const request=indexedDB.open('yu-study-archive',1);
      request.onupgradeneeded=()=>{request.result.createObjectStore('meta');request.result.createObjectStore('files')};
      const db=await new Promise(resolve=>request.onsuccess=()=>resolve(request.result));
      const prefix=new Uint8Array(bytes),attachment=new Uint8Array(240*1024);
      const files=[];
      for(let i=0;i<count;i++){
        const subject=i%2?'행정학':'행정법',id='doc'+i, session=id+'s',year=String(2016+i%10);
        // Appended PDF comments vary by file; the original four-page vector paper remains valid.
        const file=new Blob([prefix,'\n% fixture ',String(i),'\n%',attachment],{type:'application/pdf'});
        const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer()))].map(v=>v.toString(16).padStart(2,'0')).join('');
        files.push([hash,file]);
        seed.documents.push({id,hash,subject,year,exam:'국가직 9급',title:subject+' 연습 '+i,tags:'',size:file.size,count:20,session,scanned:true});
        seed.sessions.push({id:session,doc:id,date:year+'-01-01'});
      }
      await new Promise((resolve,reject)=>{const tx=db.transaction(['meta','files'],'readwrite');tx.objectStore('meta').put(seed,'archive');
        for(const [key,file] of files)tx.objectStore('files').put(file,key);tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error)});
      db.close();
    },{count:n,seed:initial(),bytes});
    const cd=await ctx.newCDPSession(page);await cd.send('Performance.enable');
    const measure=async(fn)=>{const start=performance.now();await fn();return Math.round(performance.now()-start)};
    const single=async(sel)=>page.locator(sel).first().waitFor();
    const cold=await measure(async()=>{await page.goto(url+'/yu-study/');await page.getByRole('heading',{name:'학습 서재'}).waitFor()});
    const library=await measure(async()=>{await page.getByRole('button',{name:'자료실',exact:true}).click();await single('[data-doc]')});
    const cards=await page.locator('[data-doc]').count();
    const filter=await measure(async()=>{await page.locator('#subject').selectOption('행정학');await page.waitForFunction(()=>!document.querySelector('[data-doc="doc0"]'))});
    const search=await measure(async()=>{await page.locator('#query').fill('연습 '+(n-1));await page.waitForFunction(()=>document.querySelectorAll('[data-doc]').length===1)});
    const scroll=await page.evaluate(async()=>{const intervals=[],start=performance.now();let last=start;for(let i=0;i<12;i++){
      window.scrollBy(0,i%2?80:-80);await new Promise(requestAnimationFrame);let now=performance.now();intervals.push(now-last);last=now}
      return Math.round(Math.max(...intervals))});
    const open=await measure(async()=>{await page.locator('[data-doc]').first().click();await page.waitForFunction(()=>document.querySelector('.paper canvas')?.width>300)});
    const heaps=[];
    for(let i=0;i<4;i++){
      await page.getByRole('button',{name:'자료실',exact:true}).click();await single('[data-doc]');
      await cd.send('HeapProfiler.collectGarbage');heaps.push(Math.round((await cd.send('Runtime.getHeapUsage')).usedSize/1048576));
      if(i<3){await page.locator('[data-doc]').first().click();await page.waitForFunction(()=>document.querySelector('.paper canvas')?.width>300)}
    }
    assert.equal(await page.locator('[data-doc]').count(),1);
    const usage=await page.evaluate(async()=>(await navigator.storage.estimate()).usage);
    console.log(JSON.stringify({count:n,bytesPerFile:bytes.length+240*1024+20,cold,library,cards,filter,search,scrollFrameMax:scroll,open,retainedHeapMiB:heaps,estimatedBytes:usage}));
    await ctx.close();
  }
}finally{await browser.close();server.close()}
