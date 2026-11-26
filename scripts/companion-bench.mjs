import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {fixturePaper} from './bulk-fixture.mjs';
import {testServer} from './test-server.mjs';
import {materialIndex,missingMaterials} from '../src/materials.js';

const {chromium}=createRequire(import.meta.url)('playwright'),template=(await fixturePaper(18)).toString('base64');
const server=testServer({sourceModules:true});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url='http://127.0.0.1:'+server.address().port+'/yu-study/',browser=await chromium.launch({executablePath:process.env.YU_BROWSER,headless:true});
const system=await browser.newBrowserCDPSession();
async function rss(){
 const {processInfo}=await system.send('SystemInfo.getProcessInfo');
 const values=await Promise.all(processInfo.map(async({id})=>{
   const data=await readFile('/proc/'+id+'/status','utf8').catch(()=>'');return +(data.match(/^VmRSS:\s+(\d+)/m)?.[1]||0);
 }));return Math.round(values.reduce((a,b)=>a+b,0)/1024);
}
const time=async fn=>{const begin=performance.now();await fn();return Math.round(performance.now()-begin)};
try{
 for(const n of [100,500,1000,3000]){
  const ctx=await browser.newContext({viewport:{width:834,height:1194},hasTouch:true}),page=await ctx.newPage();
  try{
   await page.goto(url+'proof.html');const cd=await ctx.newCDPSession(page);
   let heapPeak=0,rssPeak=0,measuring=false;
   const timer=setInterval(async()=>{if(measuring)return;measuring=true;try{heapPeak=Math.max(heapPeak,(await cd.send('Runtime.getHeapUsage')).usedSize);rssPeak=Math.max(rssPeak,await rss())}catch{}finally{measuring=false}},500);
   try{
    const result=await page.evaluate(async({n,template})=>{
      const db=await import('/proof-src/db.js'),bulk=await import('/proof-src/bulk-import.js'),{makeZip}=await import('/proof-src/archive-zip.js');
      const pdf=new Blob([Uint8Array.from(atob(template),c=>c.charCodeAt(0))]),control={pause:false,signal:new AbortController().signal},noop=()=>{};
      async function* files(){
        for(let i=0;i<n;i++){const group=Math.floor(i/3),kind=['문제지','공식 최종 정답지','해설지'][i%3],subject=group%2?'행정학':'행정법';
          const path=(2010+Math.floor(group/198))+'/국가직9급/제'+(1+group%99)+'회/'+subject+'_가_'+kind+'_'+String(i).padStart(4,'0')+'.pdf';
          yield {path,blob:new Blob([pdf,'\n%'+i])};
        }
      }
      const zip=new File([await makeZip(files())],'모음.zip'),t=performance.now(),input=await bulk.discover([zip]),job=await bulk.startJob(input),rows=await bulk.jobRows(job);
      await bulk.preview(job,rows,input.sources,control,noop);const preview=performance.now();
      if(rows.some(r=>r.status!=='ready'))throw Error('파일 검증 실패');
      job.options.analyse=false;await bulk.register(job,rows,control,noop);const registered=performance.now();await bulk.finishJob(job);
      const archive=await db.state();return {count:n,zipBytes:zip.size,previewMs:Math.round(preview-t),registerMs:Math.round(registered-preview),
        storedBytes:(await navigator.storage.estimate()).usage,docs:archive.documents.map(({id,title,year,subject,grade,form,exam,round,type})=>({id,title,year,subject,grade,form,exam,round,type}))};
    },{n,template});
    const {docs,...metrics}=result;
    const times=[];for(let i=0;i<7;i++)times.push(await time(()=>{const index=materialIndex(docs);assert.equal(missingMaterials(index).length,Math.ceil(n/3))}));
    metrics.metadataMedianMs=times.sort((a,b)=>a-b)[3];
    metrics.startMs=await time(async()=>{await page.goto(url);await page.getByRole('heading',{name:'학습 서재'}).waitFor()});
    const nav=()=>page.locator('nav').getByRole('button',{name:'자료실',exact:true}).click();
    metrics.libraryMs=await time(async()=>{await nav();await page.locator('[data-card]').first().waitFor()});
    assert.ok(await page.locator('[data-card]').count()<=48);
    metrics.typeTabMs=await time(async()=>{await page.locator('[data-kind="해설지"]').click();await page.locator('[data-kind="해설지"][aria-pressed=true]').waitFor()});
    await page.locator('[data-kind="문제지"]').click();
    metrics.subjectTabMs=await time(async()=>{await page.locator('[data-lib-sub="행정법"]').click();await page.locator('[data-lib-sub="행정법"][aria-pressed=true]').waitFor()});
    metrics.searchMs=await time(async()=>{await page.locator('#query').fill('0000');await page.waitForFunction(()=>document.querySelectorAll('[data-card]').length===1)});
    const paper=docs[0],key=docs[1],sol=docs[2],loaded=()=>page.waitForFunction(()=>document.querySelector('.paper canvas')?.width>350);
    metrics.openMs=await time(async()=>{await page.locator('[data-doc="'+paper.id+'"]').click();await loaded()});
    const switchTimes=[],heaps=[];
    for(let i=0;i<(n===3000?36:9);i++){
      const d=[key,sol,paper][i%3];switchTimes.push(await time(async()=>{
        await page.locator('.workspace-tabs [data-open-material="'+d.id+'"]').click();
        await page.getByRole('heading',{name:d.title,exact:true}).waitFor();await loaded();
      }));
      if(i%3===2){await cd.send('HeapProfiler.collectGarbage');heaps.push(Math.round((await cd.send('Runtime.getHeapUsage')).usedSize/1048576))}
    }
    metrics.switchMedianMs=switchTimes.sort((a,b)=>a-b)[Math.floor(switchTimes.length/2)];metrics.switches=switchTimes.length;metrics.retainedHeapMiB=heaps;
    metrics.backMs=await time(async()=>{await page.locator('#view-back').click();await page.locator('[data-doc="'+paper.id+'"]').waitFor()});
    assert.equal(await page.locator('#query').inputValue(),'0000');
    await page.evaluate(async()=>{const {change}=await import('/proof-src/db.js');await change(s=>{for(const d of s.documents)d.deleted=true})});
    await nav();await page.locator('#trash').click();await page.locator('#empty-library-trash').click();
    metrics.purgeMs=await time(async()=>{await page.locator('#purge-files').click();await page.waitForFunction(()=>!document.querySelector('#modal').open)});
    const count=await page.evaluate(async()=>(await(await import('/proof-src/db.js')).state()).documents.length);
    assert.equal(count,0);metrics.peakPageHeapMiB=Math.round(heapPeak/1048576);metrics.sampledRssMiB=rssPeak;
    console.log('COMPANION_METRICS '+JSON.stringify(metrics));
   }finally{clearInterval(timer)}
  }finally{await ctx.close()}
 }
}finally{await browser.close();server.close()}
