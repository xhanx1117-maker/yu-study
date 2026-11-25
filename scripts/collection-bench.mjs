import {testServer} from './test-server.mjs';
import {fixturePaper} from './bulk-fixture.mjs';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const {chromium}=createRequire(import.meta.url)('playwright');
const server=testServer({sourceModules:true});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,executablePath:process.env.YU_BROWSER});
const base=(await fixturePaper(20,true)).toString('base64');
try{
  for(const n of (process.env.YU_BENCH_COUNTS||'100,500,1000').split(',').map(Number)){
    const context=await browser.newContext({viewport:{width:834,height:1194},hasTouch:true}),page=await context.newPage(),cd=await context.newCDPSession(page);
    await page.goto('http://127.0.0.1:'+server.address().port+'/yu-study/proof.html');
    let pending=false,peak=0;const monitor=setInterval(async()=>{if(pending)return;pending=true;try{const {usedSize}=await cd.send('Runtime.getHeapUsage');peak=Math.max(peak,usedSize)}catch{}finally{pending=false}},400);
    try{
      const result=await page.evaluate(async({base,n})=>{
        const {makeZip}=await import('/proof-src/archive-zip.js');
        const bulk=await import('/proof-src/bulk-import.js'),db=await import('/proof-src/db.js');
        const {record}=await import('/proof-src/model.js'),{notebookIndex}=await import('/proof-src/notebook-model.js');
        const {prepareWorkbook}=await import('/proof-src/workbook-source.js'),{writeWorkbook}=await import('/proof-src/export.js');
        const blob=new Blob([Uint8Array.from(atob(base),c=>c.charCodeAt(0))]),control={pause:false,signal:new AbortController().signal},noop=()=>{};
        async function* entries(){for(let i=0;i<n;i++)yield {path:(2017+i%10)+'/국가직9급/'+(i%2?'행정학':'행정법')+'_'+i+'.pdf',blob:new Blob([blob,'\n% '+i])}}
        const zip=new File([await makeZip(entries())],'연습.zip');
        const t=performance.now(),input=await bulk.discover([zip]),job=await bulk.startJob(input),rows=await bulk.jobRows(job);
        await bulk.preview(job,rows,input.sources,control,noop);
        if(rows.some(r=>r.status!=='ready'))throw Error('Failed preview '+JSON.stringify(rows.find(r=>r.status!=='ready')));
        const p=performance.now();await bulk.register(job,rows,control,noop);const r=performance.now();
        // Sample full quality scanning separately from the measured all-file import.
        // The same queue is exercised to completion in bulk-test. Pause at a file boundary.
        await bulk.analyse(job,control,(_doc,i)=>{if(i===2)control.pause=true});
        const a=performance.now();let s=await db.state();const completed=s.documents.filter(d=>d.analysisState==='done');
        if(completed.length!==3||completed.some(d=>d.count!==20))throw Error('Invalid sample analysis count: '+completed.map(d=>d.count));
        const d=completed[0],regions=await bulk.automaticMap(d);record(s,d,d.session,[1,3,5,7,9,11]);
        for(const q of s.questions)Object.assign(q,regions[q.number]);
        const start=performance.now();const prepared=await prepareWorkbook(s,notebookIndex(s).rows,{themeIds:[]},{},control.signal,noop);
        const printed=await writeWorkbook(prepared,'가상 시험지',control.signal,noop);
        const end=performance.now();control.pause=false;
        const remainder=performance.now();await bulk.analyse(job,control,noop);
        const fullScanMs=Math.round(a-r+performance.now()-remainder);s=await db.state();
        if(s.documents.some(d=>d.analysisState!=='done'||d.count!==20))throw Error('Incomplete full analysis');
        const usage=(await navigator.storage.estimate()).usage;
        return {count:s.documents.length,zipBytes:zip.size,previewMs:Math.round(p-t),registerMs:Math.round(r-p),scanThreeMs:Math.round(a-r),
          fullScanMs,workbookSixMs:Math.round(end-start),workbookPages:prepared.plan.pages.length,outputBytes:printed.file.size,storageEstimate:usage};
      },{n,base});
      assert.equal(result.count,n);console.log(JSON.stringify({...result,sampledPeakJSHeapMiB:Math.round(peak/1048576)}));
    }finally{clearInterval(monitor);await context.close()}
  }
}finally{await browser.close();server.close()}
