import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {fixturePaper} from './bulk-fixture.mjs';
import {testServer} from './test-server.mjs';

const {chromium}=createRequire(import.meta.url)('playwright');
const server=testServer({sourceModules:true});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,executablePath:process.env.YU_BROWSER});
try{
  const page=await browser.newPage();
  await page.goto('http://127.0.0.1:'+server.address().port+'/yu-study/proof.html');
  const trials=await page.evaluate(async encoded=>{
    const {openPdf,detect}=await import('/proof-src/pdf.js');
    const {initial,record}=await import('/proof-src/model.js');
    const {notebookIndex}=await import('/proof-src/notebook-model.js');
    const {prepareWorkbook}=await import('/proof-src/workbook-source.js');
    const {writeWorkbook}=await import('/proof-src/export.js');
    const blob=new Blob([Uint8Array.from(atob(encoded),c=>c.charCodeAt(0))],{type:'application/pdf'});
    const read=async()=>blob,signal=new AbortController().signal,progress=()=>{},samples=[];
    for(let run=0;run<4;run++){
      const start=performance.now(),pdf=await openPdf(blob);let regions;
      try{regions=await detect(pdf,20,{signal})}finally{await pdf.destroy()}
      const scanned=performance.now();
      const doc={id:'synthetic-paper',hash:'synthetic',title:'가상 행정법',subject:'행정법',year:'2026',exam:'국가직 9급',count:20,session:'one',detected:regions};
      const archive=initial();archive.documents.push(doc);archive.sessions.push({id:'one',doc:doc.id,date:'2026-01-01'});
      record(archive,doc,'one',[1,3,5,7,9,11]);const rows=notebookIndex(archive).rows;
      const printing=performance.now(),prepared=await prepareWorkbook(archive,rows,{themeIds:[]},{},signal,progress,read);
      const {file}=await writeWorkbook(prepared,'가상 시험지',signal,progress,read);
      samples.push({scanMs:Math.round(scanned-start),printMs:Math.round(performance.now()-printing),pages:prepared.plan.pages.length,
        questions:Object.keys(regions).length,bytes:file.size});
    }
    return samples;
  },(await fixturePaper(20,true)).toString('base64'));
  assert.ok(trials.every(t=>t.questions===20&&t.pages===1&&t.bytes>1000));
  console.log(JSON.stringify({cold:trials[0],warm:trials.slice(1)}));
}finally{await browser.close();server.close()}
