import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {chromium,webkit} from 'playwright';
import {PDFDocument} from 'pdf-lib';
import Zip from 'jszip';
import {testServer} from './test-server.mjs';
const engine=process.env.YU_TEST_ENGINE||'chromium';
const server=testServer({sourceModules:true});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port,app=origin+'/yu-study/';
let context;
try{
  context=await (engine==='webkit'?webkit:chromium).launchPersistentContext('',{headless:true,
    ...(engine==='chromium'?{executablePath:process.env.YU_BROWSER}:{}),hasTouch:true,isMobile:true,viewport:{width:834,height:1194}});
  const page=context.pages()[0]||await context.newPage();page.setDefaultTimeout(15000);
  page.on('dialog',d=>d.accept());
  const sample=await PDFDocument.create();sample.addPage([400,600]);
  const bytes=[...await sample.save()];await page.goto(origin+'/seed.html');
  await page.evaluate(async bytes=>{
    const {initial}=await import('/proof-src/model.js');
    const db=await new Promise(resolve=>{const r=indexedDB.open('yu-study-archive',1);r.onupgradeneeded=()=>{r.result.createObjectStore('meta');r.result.createObjectStore('files')};r.onsuccess=()=>resolve(r.result)});
    const s=initial(),blob=new Blob([new Uint8Array(bytes)],{type:'application/pdf'}),hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].map(v=>v.toString(16).padStart(2,'0')).join('');
    s.documents.push({id:'paper',hash,count:20,subject:'행정법',year:'2026',exam:'국가직 9급',grade:'9급',form:'가',type:'기출문제지',title:'가상 행정 시험',session:'new'});
    s.sessions=['past','new','repeat','clean'].map(id=>({id,doc:'paper',date:'2026-07-31T14:30:00Z'}));
    s.sessions[0].solvedAt='2026-07-31T14:45:00Z';
    s.questions=[1,2].map(n=>({id:'paper#'+n,doc:'paper',number:n,regions:[],theme:null,secondary:[],status:'미복습',memo:'보존'}));
    const event=(n,time)=>({id:'past#'+n,session:'past',q:'paper#'+n,number:n,date:time});
    s.events.push(event(1,'2026-07-31T14:40:00Z'));s.removedMistakes=[{id:'bag',date:'2026-07-31T15:30:00Z',events:[event(2,'2026-07-31T15:05:00Z')]}];
    await new Promise((res,rej)=>{const tx=db.transaction(['meta','files'],'readwrite');tx.objectStore('meta').put(s,'archive');tx.objectStore('files').put(blob,hash);tx.oncomplete=res;tx.onabort=()=>rej(tx.error)});db.close();
  },bytes);
  await page.goto(app);await page.getByRole('heading',{name:'학습 서재'}).waitFor();
  const metrics=await page.evaluate(async()=>{
    const {queryStudy}=await import('/proof-src/study-query.js'),{change,state}=await import('/proof-src/db.js'),
      {record}=await import('/proof-src/model.js'),{completeSession}=await import('/proof-src/study-events.js'),
      {removeEvents,changeTrash,trashEntries}=await import('/proof-src/notebook-model.js');
    const rows=await queryStudy('2026-07-31','2026-08-01','행정법');
    const other=await queryStudy('2026-07-31','2026-08-01','영어');
    await change(s=>{const d=s.documents[0];record(s,d,'new',[1,2]);record(s,d,'new',[1,2]);record(s,d,'repeat',[1]);completeSession(s,s.sessions[3],new Date().toISOString())});
    await change(s=>{record(s,s.documents[0],'new',[1]);removeEvents(s,s.events.filter(e=>e.session==='repeat'));changeTrash(s,trashEntries(s).filter(x=>x.event.session==='repeat').map(x=>x.key),'purge');s.questions[0].status='숙지 완료'});
    return {legacy:rows.map(r=>[r.day,r.kind,r.wrongInSession]),other:other.length,active:(await state()).events.length};
  });
  assert.deepEqual(metrics,{legacy:[['2026-07-31','wrong',undefined],['2026-07-31','solved',2],['2026-08-01','wrong',undefined]],other:0,active:2});
  await page.getByRole('button',{name:'오답노트',exact:true}).click();await page.locator('#study-log').click();
  await page.waitForFunction(()=>document.querySelector('#study-summary')?.textContent.includes('반복 2회'));
  await page.locator('#study-preview summary').click();await page.waitForFunction(()=>document.querySelector('#study-preview textarea')?.value.includes('누적 3회'));assert.match(await page.locator('#study-preview textarea').inputValue(),/누적 3회/);
  if(engine==='chromium')await context.grantPermissions(['clipboard-read','clipboard-write'],{origin});
  await page.locator('#study-copy').click();await page.waitForFunction(()=>document.querySelector('#study-feedback').textContent.includes('복사'));
  if(engine==='chromium')assert.match(await page.evaluate(()=>navigator.clipboard.readText()),/기록된 오답 없음/);
  for(const fmt of ['JSON','CSV','Markdown','텍스트']){
    await page.locator('#study-format').selectOption(fmt);const promise=page.waitForEvent('download');await page.locator('#study-export').click();
    const contents=await fs.readFile(await (await promise).path(),'utf8');
    if(fmt==='JSON'){const r=JSON.parse(contents);assert.equal(r.summary.unique,1);assert.equal(r.summary.occurrences,2);assert.equal(r.summary.cleanCompletedPapers,1)}
    else assert.match(contents,fmt==='CSV'?/기록 ID/:/일일 학습 기록/);
  }
  await page.locator('#study-history summary').click();
  const repeat=page.locator('.study-entry').filter({hasText:'누적 3회'});await repeat.getByText('정정',{exact:true}).click();
  await repeat.locator('input').fill('2026-08-02');await repeat.getByText('날짜 저장').click();
  await page.waitForFunction(()=>document.querySelector('#study-summary')?.textContent.includes('반복 1회'));
  await page.locator('#study-period').selectOption('직접 날짜 지정');await page.locator('#study-from').fill('2026-08-02');await page.locator('#study-to').fill('2026-08-02');
  await page.waitForFunction(()=>document.querySelector('.study-entry strong')?.textContent.includes('2026-08-02'));
  await page.locator('.study-entry button').first().click();await page.getByText('기록 취소',{exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#study-summary')?.textContent.includes('기록이 없습니다'));
  await page.locator('dialog form button').click();await page.getByRole('button',{name:'설정',exact:true}).click();
  const saved=page.waitForEvent('download');await page.locator('#backup').click();const file=await (await saved).path();
  const zip=await Zip.loadAsync(await fs.readFile(file)),archive=JSON.parse(await zip.file('archive.json').async('string'));
  assert.equal(archive.questions[0].memo,'보존');assert.ok(archive.studyLog.some(r=>r.removed));assert.ok(archive.studyLog.some(r=>r.kind==='solved'));
  const before=JSON.stringify(archive.studyLog);
  await page.evaluate(async()=>{const {transaction}=await import('/proof-src/db.js');await transaction(['studyLog'],'readwrite',({studyLog})=>studyLog.clear())});
  const chooser=page.waitForEvent('filechooser');await page.locator('#restore').click();await (await chooser).setFiles({name:'synthetic.zip',mimeType:'application/zip',buffer:await fs.readFile(file)});
  await page.waitForFunction(()=>document.querySelector('#notice')?.textContent.includes('복원했습니다')||document.querySelector('#notice')?.textContent.includes('복원 완료'));
  const restored=await page.evaluate(async()=>{const {transaction}=await import('/proof-src/db.js');return transaction(['studyLog'],'readonly',({studyLog},read,done)=>read(studyLog.getAll(),done))});
  assert.deepEqual(restored,JSON.parse(before));console.log(engine+': legacy → indexed daily history, repeat/undo/cleanup, date correction, clipboard, 4 formats, ZIP round trip passed.');
}finally{await context?.close();await new Promise(r=>server.close(r))}
