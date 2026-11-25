import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {chromium,webkit} from 'playwright';
import {PDFDocument,StandardFonts,rgb} from 'pdf-lib';
import {testServer} from './test-server.mjs';

// With an explicit local input, the PDF stays in the isolated browser profile.
// The automated build invokes this script only with entirely invented papers.
async function fixture(kind){
  const pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica);
  const W=728,H=1031,p=pdf.addPage([W,H]);
  const stroke=(x,y,X,Y,color=rgb(0,0,0),thickness=.8)=>p.drawLine({start:{x,y:H-y},end:{x:X,y:H-Y},color,thickness});
  const txt=(s,x,y,size=12)=>p.drawText(s,{x,y:H-y,size,font});
  const chrome=rgb(.98,0,.6);
  txt('Fictional B4 examination',18,32);
  stroke(12,44,716,44,chrome);stroke(12,1018,716,1018,chrome);
  for(const x of [12,350,716])stroke(x,44,x,1018,chrome,1.4);
  for(let i=0;i<6;i++){
    const n=i+1,x=i<3?19:365,y=[66,383,717][i%3];
    txt(n+'. '+(kind==='law'?'Case study':'Public management')+' '+n,x,y);
    txt('Read the fictional record and choose an answer.',x+8,y+24,11);
    const caseTop=y+34;
    p.drawRectangle({x:x+7,y:H-caseTop-48,width:309,height:48,borderWidth:.85,borderColor:rgb(.1,.1,.1)});
    txt('The records below refer to an invented office.',x+13,caseTop+16,10);
    if(kind==='admin'){
      stroke(x+7,caseTop+25,x+316,caseTop+25);stroke(x+170,caseTop+25,x+170,caseTop+48);
      txt('Group A',x+13,caseTop+39,9);txt('Group B',x+180,caseTop+39,9);
    }else txt('Keep this boxed statement with its question.',x+13,caseTop+37,10);
    const positions=[106,138,174,i%3===2?270:203];
    for(let j=0;j<4;j++)txt(String.fromCharCode(65+j)+'. Example choice '+(j+1),x+10,y+positions[j],11);
    txt('LAST-LINE-'+n,x+25,y+positions[3]+15,11);
  }
  return pdf.save();
}
const [input,subject,numbers,destination]=process.argv.slice(2);
const outputDir=process.env.YU_PROOF_DIR;
if(input && (!subject||!numbers||!destination))throw Error('Usage: node scripts/print-proof.mjs SOURCE.pdf SUBJECT 1,2,3 OUTPUT.pdf');
const mobile=process.env.YU_TEST_ENGINE==='webkit',engine=mobile?webkit:chromium;
const server=testServer({sourceModules:true});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let context;
try{
  context=await engine.launchPersistentContext('',{headless:true,viewport:{width:834,height:1194},hasTouch:true,isMobile:mobile,
    ...(!mobile&&process.env.YU_BROWSER?{executablePath:process.env.YU_BROWSER}:{})});
  const page=await context.newPage();
  await page.goto('http://127.0.0.1:'+server.address().port+'/yu-study/proof.html');
  const jobs=input?[{subject,bytes:await readFile(input),numbers:numbers.split(',').map(Number),destination}]:
    await Promise.all(['law','admin'].map(async kind=>({subject:kind==='law'?'행정법':'행정학',bytes:await fixture(kind),numbers:[1,2,3,4,5,6],
      destination:outputDir?path.join(outputDir,kind+'-b4-to-a4.pdf'):null})));
  for(const job of jobs){
    const result=await page.evaluate(async({encoded,subject,numbers,synthetic})=>{
      const {openPdf,detect}=await import('/proof-src/pdf.js');
      const {initial,record}=await import('/proof-src/model.js');
      const {get,change,hash}=await import('/proof-src/db.js');
      const {notebookIndex}=await import('/proof-src/notebook-model.js');
      const {prepareWorkbook,renderArea}=await import('/proof-src/workbook-source.js');
      const {writeWorkbook}=await import('/proof-src/export.js');
      const signal=new AbortController().signal,start=performance.now(),noop=()=>{};
      const blob=new Blob([Uint8Array.from(atob(encoded),c=>c.charCodeAt(0))],{type:'application/pdf'});
      const fileHash=await hash(blob),s=initial(),d={id:'source',hash:fileHash,subject,title:subject+' 연습',year:'',exam:'',count:Math.max(20,...numbers),session:'practice'};
      s.documents=[d];s.sessions=[{id:d.session,doc:d.id}];
      await change(()=>s,[[fileHash,blob]],true);
      const pdf=await openPdf(blob),full={x:0,y:0,w:1,h:1};
      let map;
      try{map=await detect(pdf,d.count)}finally{await pdf.destroy()}
      d.detected=map;record(s,d,d.session,numbers);
      for(const q of s.questions){
        if(!map[q.number]?.regions.length)throw Error('Missing automatic region for '+q.number);
        Object.assign(q,map[q.number]);
      }
      const rows=notebookIndex(s).rows;
      const prepared=await prepareWorkbook(s,rows,{themeIds:[]},{},signal,noop);
      const {file,formats}=await writeWorkbook(prepared,subject+' · '+(synthetic?'가상 문제집':'오답 문제집'),signal,noop);
      const elapsed=Math.round(performance.now()-start);
      const exported=await openPdf(file),rendered=[],texts=[];
      let magenta=0;
      try{
        for(let n=1;n<=exported.numPages;n++){
          const sheet=await exported.getPage(n),cv=await renderArea(sheet,full,1.5,signal);
          if(synthetic){
            const pixels=cv.getContext('2d').getImageData(0,0,cv.width,cv.height).data;
            for(let i=0;i<pixels.length;i+=4)if(pixels[i]>200&&pixels[i+1]<60&&pixels[i+2]>90)magenta++;
          }
          rendered.push(cv.toDataURL('image/png').split(',')[1]);cv.width=cv.height=1;
          const reader=sheet.streamTextContent().getReader();
          try{for(;;){const {done,value}=await reader.read();if(done)break;texts.push(...value.items.filter(t=>t.str).map(t=>({s:t.str,size:Math.hypot(t.transform[0],t.transform[1])})))}}finally{reader.releaseLock()}
          sheet.cleanup();
        }
      }finally{await exported.destroy()}
      const file64=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result.split(',')[1]);r.onerror=reject;r.readAsDataURL(file)});
      return {file64,rendered,formats,elapsed,magenta,texts,geometry:prepared.plan.pages.flatMap(sheet=>sheet.placements.filter(v=>v.kind==='crop').map(v=>({id:v.item,width:v.part.width,height:v.part.height,pageWidth:v.part.pageWidth,pageHeight:v.part.pageHeight,oneColumn:v.part.oneColumn,laneWidth:v.part.laneWidth}))),hashOK:fileHash===await hash(await get('files',fileHash)),
        detected:numbers.map(n=>map[n].text),placements:prepared.plan.pages.map(p=>p.placements.filter(v=>v.kind==='crop').map(v=>({id:v.item,x:v.x,y:v.y,w:v.w,h:v.h,scale:v.scale})))};
    },{encoded:Buffer.from(job.bytes).toString('base64'),subject:job.subject,numbers:job.numbers,synthetic:!input});
    const bytes=Buffer.from(result.file64,'base64');
    assert.equal(result.hashOK,true);
    if(!input){
      assert.equal(result.placements.length,1);assert.equal(result.magenta,0,'source separator and page borders are absent');
      const items=result.placements[0];assert.equal(items.length,6);assert.ok(items.some(v=>v.x>297));
      for(const crop of items)assert.ok(Math.abs(crop.scale-.817)<.005);
      for(const [i,text] of result.detected.entries())assert.ok(text.includes('LAST-LINE-'+(i+1)));
      const text=result.texts.filter(t=>/LAST-LINE-/.test(t.s));
      assert.equal(text.length,6,'every final choice remains searchable, including beneath 96.5% of the source');
      for(const t of text)assert.ok(Math.abs(t.size-11*.817)<.08);
      assert.equal(result.formats.vector,6);
    }
    if(input && process.env.YU_PRINT_GEOMETRY==='1'){
      console.log('PRINT_GEOMETRY '+JSON.stringify(result.geometry));
      console.log('CHOICE_COUNTS '+JSON.stringify(result.detected.map(value=>['①','②','③','④'].map(mark=>value.includes(mark)))));
    }
    if(job.destination){
      await mkdir(path.dirname(job.destination),{recursive:true});await writeFile(job.destination,bytes);
      for(const [i,png] of result.rendered.entries())await writeFile(job.destination.replace(/\.pdf$/i,'')+'-p'+(i+1)+'.png',Buffer.from(png,'base64'));
    }
    if(!input){
      // Use the normal deployed application and a freshly chosen PDF; a sample
      // preview must never alter the existing archive or print preferences.
      const before=await page.evaluate(async()=>JSON.stringify(await (await import('/proof-src/db.js')).state()));
      const fragment=new URLSearchParams({file:'paper.pdf',subject:job.subject,questions:'1,2,3,4,5,6'});
      await page.goto('http://127.0.0.1:'+server.address().port+'/yu-study/#sample?'+fragment);
      await page.locator('#sample-file').waitFor();
      const select=page.waitForEvent('filechooser');await page.locator('#sample-file').click();
      await (await select).setFiles({name:'paper.pdf',mimeType:'application/pdf',buffer:Buffer.from(job.bytes)});
      await page.waitForFunction(()=>document.querySelector('#print-status')?.textContent==='6문항 · 1쪽',null,{timeout:60000});
      const after=await page.evaluate(async()=>JSON.stringify(await (await import('/proof-src/db.js')).state()));
      assert.equal(after,before);
      await page.goto('http://127.0.0.1:'+server.address().port+'/yu-study/proof.html');
    }
    console.log(JSON.stringify({subject:job.subject,pages:result.placements.length,questions:job.numbers.length,bytes:bytes.length,ms:result.elapsed,formats:result.formats}));
  }
}finally{await context?.close();server.close()}
