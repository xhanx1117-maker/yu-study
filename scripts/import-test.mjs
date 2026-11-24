import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {initial} from '../src/model.js';

const require=createRequire(import.meta.url);
const {chromium,webkit}=require('playwright');
const {PDFDocument,StandardFonts}=require('pdf-lib');
const root=path.resolve('dist');
const mime={'.html':'text/html','.js':'application/javascript','.mjs':'application/javascript','.css':'text/css','.wasm':'application/wasm'};
const server=http.createServer((req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;
  if(pathname==='/seed.html'){
    res.setHeader('Content-Type','text/html');
    res.end('<!doctype html><title>Isolated storage test</title>');
    return;
  }
  if(!pathname.startsWith('/yu-study/')){res.writeHead(404).end();return}
  const relative=decodeURIComponent(pathname.slice('/yu-study/'.length))||'index.html';
  const file=path.resolve(root,relative);
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.writeHead(404).end();return}
  res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');
  fs.createReadStream(file).pipe(res);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port;
const engine=process.env.YU_TEST_ENGINE||'chromium';
const deadline=setTimeout(()=>{
  console.error('Import regression exceeded 120 seconds.');
  process.exit(1);
},120000);
deadline.unref();
let browser;
async function pdfFile(name,text,mimeType='application/pdf'){
  const doc=await PDFDocument.create();
  const font=await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([595,842]).drawText(text,{x:40,y:720,font,size:14});
  return {name,mimeType,buffer:Buffer.from(await doc.save())};
}
try{
  // WebKit private sessions do not support Blob/File values in IndexedDB.
  // Use a fresh temporary persistent profile, like a normal Safari/PWA session.
  const context=await (engine==='webkit'?webkit:chromium).launchPersistentContext('',{
    headless:true,
    ...(engine==='chromium'?{executablePath:process.env.YU_BROWSER}:{}),
    viewport:{width:834,height:1194},isMobile:true,hasTouch:true,
    userAgent:'Mozilla/5.0 (iPad; CPU OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Mobile/15E148 Safari/604.1',
  });
  browser=context;
  const page=await context.newPage();
  page.setDefaultTimeout(20000);
  const errors=[],external=[];
  page.on('pageerror',error=>{errors.push(error.message);console.error(error.message)});
  page.on('console',message=>{if(['error','warning'].includes(message.type()))console.log(message.type()+': '+message.text())});
  page.on('request',request=>{
    if(!/^https?:/.test(request.url()))return;
    const requestedOrigin=new URL(request.url()).origin;
    // Some local Windows setups inject antivirus/filter scripts into HTTP pages.
    // CI leaves this variable unset and rejects every external origin.
    if(requestedOrigin!==origin&&requestedOrigin!==process.env.YU_TEST_HOST_INJECTION)external.push(request.url());
  });
  const legacy=await pdfFile('legacy.pdf','1. Legacy record');
  const legacyHash=createHash('sha256').update(legacy.buffer).digest('hex');
  const archive=initial();
  archive.documents.push({id:'legacy',hash:legacyHash,title:'기존 국어 시험',subject:'국어',year:'2023',exam:'국가직 9급',count:20,session:'old-session',page:1});
  archive.sessions.push({id:'old-session',doc:'legacy',date:'2023-01-01'});
  archive.questions.push({id:'legacy#1',doc:'legacy',number:1,regions:[{page:1,x:0,y:0,w:1,h:.4}],theme:null,secondary:[],status:'부분 이해',memo:'기존 메모'});
  archive.events.push({id:'old-session#1',q:'legacy#1',session:'old-session',number:1,date:'2023-01-01'});
  await page.goto(origin+'/seed.html');
  console.log(engine+': seeding existing version 1 data');
  await page.evaluate(async({archive,bytes,hash})=>{
    const db=await new Promise((resolve,reject)=>{
      const req=indexedDB.open('yu-study-archive',1);
      req.onupgradeneeded=()=>{req.result.createObjectStore('meta');req.result.createObjectStore('files')};
      req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
    });
    await new Promise((resolve,reject)=>{
      const tx=db.transaction(['meta','files'],'readwrite');
      tx.objectStore('meta').put(archive,'archive');
      tx.objectStore('files').put(new File([new Uint8Array(bytes)],'legacy.pdf',{type:'application/pdf'}),hash);
      tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);
    });
    db.close();
  },{archive,bytes:[...legacy.buffer],hash:legacyHash});
  await page.goto(origin+'/yu-study/');
  await page.getByRole('heading',{name:'학습 서재'}).waitFor();
  console.log(engine+': legacy database opened');
  async function saved(){
    return page.evaluate(async()=>{
      const db=await new Promise((resolve,reject)=>{
        const req=indexedDB.open('yu-study-archive',1);
        req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
      });
      const result=await new Promise((resolve,reject)=>{
        const req=db.transaction('meta').objectStore('meta').get('archive');
        req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
      });
      db.close();return result;
    });
  }
  async function choose(files){
    const picking=page.waitForEvent('filechooser');
    await page.locator('#pdf-files').tap();
    const chooser=await picking;
    assert.equal(await chooser.element().evaluate(el=>el.isConnected),true);
    // Let the native interaction outlive the activation handler.
    await new Promise(resolve=>setTimeout(resolve,100));
    await chooser.setFiles(files);
    await page.locator('#add').waitFor();
  }
  async function closeImport(){
    await page.locator('#modal form button').click();
    await page.locator('#modal').waitFor({state:'hidden'});
    await page.waitForFunction(()=>document.querySelector('#pdf-files')?.value==='');
  }
  async function registered(count){
    await page.locator('#modal').waitFor({state:'hidden'});
    await page.getByRole('heading',{name:'자료실',exact:true}).waitFor();
    await page.waitForFunction(expected=>document.querySelectorAll('[data-doc]').length===expected,count);
    assert.equal(await page.locator('[data-doc]').count(),count);
  }

  assert.deepEqual((await saved()).events,archive.events);
  await page.getByRole('button',{name:'국어 자료 1 · 오답 1'}).click();
  await page.locator('#year').selectOption('2023');
  const english=await pdfFile('2026 영어.pdf','1. New question','');
  await choose(english);
  await page.locator('#add').click();
  await registered(2);
  console.log(engine+': native picker and empty MIME PDF imported');
  assert.equal(await page.locator('#subject').inputValue(),'전체 과목');
  assert.equal(await page.locator('#year').inputValue(),'전체 연도');
  assert.deepEqual((await saved()).questions,archive.questions);

  await choose(english);
  await page.locator('#add').click();
  await page.getByRole('alert').filter({hasText:'이미 등록된 PDF'}).waitFor();
  assert.equal((await saved()).documents.length,2);
  await closeImport();
  assert.equal(await page.locator('#pdf-files').inputValue(),'');
  console.log(engine+': duplicate rejected');

  await choose({name:'empty.pdf',mimeType:'application/pdf',buffer:Buffer.alloc(0)});
  await page.locator('#add').click();
  await page.getByRole('alert').filter({hasText:'비어 있습니다'}).waitFor();
  await closeImport();
  const valid=await pdfFile('2025 행정법.pdf','1. Retry me');
  await choose([{name:'invalid.pdf',mimeType:'application/pdf',buffer:Buffer.from('This is not a PDF.')},valid]);
  await page.locator('#add').click();
  await page.getByRole('alert').filter({hasText:'PDF 형식'}).waitFor();
  await page.locator('#skip').click();
  await page.getByRole('heading',{name:'PDF 가져오기 · 2 / 2'}).waitFor();
  console.log(engine+': invalid and empty files handled');

  await page.evaluate(()=>{
    const original=FileReader.prototype.readAsArrayBuffer;
    FileReader.prototype.readAsArrayBuffer=function(file){
      FileReader.prototype.readAsArrayBuffer=original;
      throw new DOMException('Provider unavailable','NotReadableError');
    };
  });
  await page.locator('#add').click();
  await page.getByRole('alert').filter({hasText:'나의 iPad'}).waitFor();
  assert.equal((await saved()).documents.length,2);
  await page.evaluate(()=>{
    const original=IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put=function(...args){
      if(this.name==='files'){
        IDBObjectStore.prototype.put=original;
        throw new DOMException('Fixture quota exceeded','QuotaExceededError');
      }
      return original.apply(this,args);
    };
  });
  await page.locator('#add').click();
  await page.getByRole('alert').filter({hasText:'저장 공간이 부족'}).waitFor();
  assert.equal((await saved()).documents.length,2);
  await page.locator('#add').click();
  await registered(3);
  console.log(engine+': read and quota failures recovered');

  await page.reload();
  await page.getByRole('button',{name:'자료실',exact:true}).click();
  await page.getByRole('heading',{name:'자료실',exact:true}).waitFor();
  assert.equal(await page.locator('[data-doc]').count(),3);
  const after=await saved();
  assert.deepEqual(after.questions,archive.questions);
  assert.deepEqual(after.events,archive.events);
  assert.deepEqual(after.documents.find(d=>d.id==='legacy'),archive.documents[0]);
  const imported=after.documents.find(d=>d.title==='2026 영어');
  const expectedHash=createHash('sha256').update(english.buffer).digest('hex');
  assert.equal(imported.hash,expectedHash);
  assert.equal(imported.filename,'2026 영어.pdf');
  // Exercise the Safari stream-reader fallback on Chromium as well.
  await page.evaluate(()=>{delete ReadableStream.prototype[Symbol.asyncIterator]});
  await page.locator('[data-doc="'+imported.id+'"]').click();
  try{
    await page.waitForFunction(()=>document.querySelector('.paper canvas')?.width>0);
    await page.waitForFunction(()=>document.querySelector('#reginfo')?.textContent.includes('영역 1개'));
  }catch(error){console.error(await page.locator('body').innerText());throw error}
  console.log(engine+': PDF rendered after reload');
  await page.getByRole('button',{name:'자료실',exact:true}).click();
  await page.locator('[data-doc="legacy"]').click();
  await page.waitForFunction(()=>document.querySelector('#reginfo')?.textContent.includes('영역 1개'));
  console.log(engine+': original File PDF still readable');

  await page.getByRole('button',{name:'설정',exact:true}).click();
  await page.getByText('기기 저장 · v0.3.0').waitFor();
  assert.equal(await page.getByText('기기 저장 · v0.3.0').count(),1);
  assert.equal(await page.getByRole('button',{name:/Dropbox/}).count(),0);
  const choosing=page.waitForEvent('filechooser');
  await page.locator('#seed').click();
  const chooser=await choosing;
  assert.equal(await chooser.element().evaluate(el=>el.isConnected),true);
  await chooser.setFiles({name:'fictional.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({schemaVersion:1,books:[{id:'fake',subject:'국어',title:'가상 교재',themes:[{id:'fake-theme',title:'가상 테마'}]}]}))});
  await page.getByText('국어 · 가상 교재',{exact:true}).waitFor();
  console.log(engine+': JSON chooser consumed');
  assert.deepEqual(external,[]);
  assert.deepEqual(errors,[]);
  console.log('PASS '+engine+': touch file selection, legacy data, empty MIME, filter reset, duplicates, empty/invalid PDF, multi-file skip, provider read failure, quota rollback and retry, reload, PDF render and attached JSON chooser. No external requests.');
}finally{
  await browser?.close();
  server.close();
  clearTimeout(deadline);
}
