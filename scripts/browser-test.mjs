import http from 'node:http';import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {createRequire} from 'node:module';const require=createRequire(import.meta.url);const {chromium,webkit}=require('playwright'),{PDFDocument,StandardFonts}=require('pdf-lib');
const latest=path.resolve('dist'),previous=process.env.YU_PREVIOUS_DIST?path.resolve(process.env.YU_PREVIOUS_DIST):null;
let upgrade=false;
const server=http.createServer((req,res)=>{const u=new URL(req.url,'http://localhost');if(u.pathname==='/observe-update.html'){res.writeHead(200,{'Content-Type':'text/html'}).end('<!doctype html><title>Update observer</title>');return}if(!u.pathname.startsWith('/yu-study/')){res.writeHead(404).end();return}const root=upgrade||!previous?latest:previous;const f=path.resolve(root,u.pathname.slice(10)||'index.html');if(!f.startsWith(root+path.sep)||!fs.existsSync(f)){res.writeHead(404).end();return}res.setHeader('Content-Type',({'.js':'application/javascript','.mjs':'application/javascript','.css':'text/css','.html':'text/html','.wasm':'application/wasm','.webmanifest':'application/manifest+json'})[path.extname(f)]||'application/octet-stream');if(upgrade&&!previous&&path.basename(f)==='sw.js'){res.end(fs.readFileSync(f,'utf8') .replace('yu-study-shell-','yu-study-shell-upgrade-'));return}fs.createReadStream(f).pipe(res)});
async function waitForStorage(page,test,arg){
  const deadline=Date.now()+30000;
  while(Date.now()<deadline){
    if(await page.evaluate(test,arg))return;
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw Error('Service worker did not finish its update');
}
// A v0.4.1 user may already have a reviewed crop, a linked theme, a memo and a trashed attempt.
async function storedArchive(page,seed=false){
  return page.evaluate(async seed=>{
    const read=request=>new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)});
    const db=await read(indexedDB.open('yu-study-archive',1));
    try{
      const s=await read(db.transaction('meta').objectStore('meta').get('archive'));
      if(seed){
        s.books.push({id:'fiction-book',subject:'영어',title:'가상 교재',themes:[{id:'fiction-theme',title:'가상 주제',number:'01'}]});
        const q=s.questions[0];q.theme='fiction-theme';q.memo='업데이트 전 가상 메모';q.reviewed=true;
        const second={...q,id:q.doc+'#2',number:2};s.questions.push(second);
        s.removedMistakes=[{id:'fiction-trash',date:s.events[0].date,events:[{...s.events[0],id:q.doc+'-trashed',q:second.id,number:2}]}];
        s.reviews.push({id:'fiction-review',q:q.id,date:s.events[0].date,status:'부분 이해'});
        await new Promise((resolve,reject)=>{const tx=db.transaction('meta','readwrite');tx.objectStore('meta').put(s,'archive');tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error)});
      }
      const file=await read(db.transaction('files').objectStore('files').get(s.documents[0].hash));
      const bytes=await crypto.subtle.digest('SHA-256',await file.arrayBuffer());
      return {archive:s,original:[...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,'0')).join(''),database:db.version};
    }finally{db.close()}
  },seed);
}
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;const deadline=setTimeout(()=>{console.error('Browser regression exceeded 120 seconds.');process.exit(1)},120000);deadline.unref();try{
const engine=process.env.YU_TEST_ENGINE==='webkit'?webkit:chromium;
// A temporary persistent profile supports WebKit IndexedDB Blob/File storage.
const context=await engine.launchPersistentContext('',{headless:true,viewport:{width:1024,height:768},hasTouch:true,...(engine===chromium?{executablePath:process.env.YU_BROWSER,args:['--no-sandbox']}:{})});browser=context;const p=await context.newPage();const pageErrors=[];p.on('pageerror',e=>pageErrors.push(e.message));p.on('console',m=>{if(m.type()==='error')console.log(m.text())});p.setDefaultTimeout(20000);
await p.goto('http://127.0.0.1:'+server.address().port+'/yu-study/');await p.getByRole('heading',{name:'학습 서재'}).waitFor();
const pdf=await PDFDocument.create(),page=pdf.addPage([600,800]),font=await pdf.embedFont(StandardFonts.Helvetica);page.drawText('1. Fictional sample',{x:35,y:690,font,size:14});page.drawText('2. Second sample',{x:35,y:510,font,size:14});
const pick=p.waitForEvent('filechooser');await p.locator('#import').click();await (await pick).setFiles({name:'2024 영어 지방직9급.pdf',mimeType:'application/pdf',buffer:Buffer.from(await pdf.save())});await p.locator('#add').click();await p.locator('[data-doc]').first().click();await p.locator('.paper canvas').waitFor();await p.waitForFunction(()=>document.querySelector('#reginfo')?.textContent.includes('영역 1개'));
await p.locator('[data-n="1"]').click();await p.locator('#save').click();await p.getByRole('button',{name:'오답노트',exact:true}).click();await p.locator('[data-detail]').first().click();await p.locator('.crops canvas').waitFor();await p.locator('dialog form button').click();assert.equal(await p.locator('[data-q]').count(),1);
await p.locator('#print').click();await p.locator('#make-proof').click();await p.locator('#proof-canvas canvas').waitFor();await p.locator('#pdfsave').waitFor();
const printed=p.waitForEvent('download');await p.locator('#pdfsave').click();const rendered=await PDFDocument.load(fs.readFileSync(await (await printed).path()));assert.equal(rendered.getPageCount(),1);await p.locator('dialog form button').click();
await p.getByRole('button',{name:'설정',exact:true}).click();const dl=p.waitForEvent('download');await p.locator('#backup').click();const zip=await (await dl).path();await p.waitForFunction(()=>document.querySelector('#notice')?.textContent.includes('백업 ZIP'));
const fc=p.waitForEvent('filechooser');await p.locator('#restore').click();p.once('dialog',d=>d.accept());await (await fc).setFiles({name:'sample.zip',mimeType:'application/zip',buffer:fs.readFileSync(zip)});await p.waitForFunction(()=>document.querySelector('#notice')?.textContent.includes('복원했습니다'));
const before=await storedArchive(p,Boolean(previous));
assert.equal(before.original,before.archive.documents[0].hash);
await p.evaluate(()=>navigator.serviceWorker.ready);await p.waitForFunction(()=>!!navigator.serviceWorker.controller);
const oldCaches=await p.evaluate(async()=>(await caches.keys()).filter(k=>k.startsWith('yu-study-shell-')));assert.ok(oldCaches.length);
if(previous)await p.getByText('기기 저장 · v0.4.1',{exact:true}).waitFor();
upgrade=true;
await p.evaluate(async()=>{const reg=await navigator.serviceWorker.ready;await reg.update()});
await waitForStorage(p,async()=>(await navigator.serviceWorker.getRegistration())?.waiting?.state==='installed');
const address=p.url();
if(!previous){
  const other=await context.newPage();await other.goto(address);await other.getByRole('heading',{name:'학습 서재'}).waitFor();
  p.once('dialog',dialog=>dialog.accept());await p.locator('#apply-update').click();
  await p.waitForFunction(()=>document.querySelector('#update-result')?.textContent.includes('다른 Yu: study 창'));
  await other.close();p.once('dialog',dialog=>dialog.accept());
  await Promise.all([p.waitForNavigation(),p.locator('#apply-update').click()]);
  await p.getByRole('heading',{name:'학습 서재'}).waitFor();
}
const reopened=await context.newPage();reopened.setDefaultTimeout(20000);
reopened.on('pageerror',e=>pageErrors.push(e.message));
// Close the last controlled client exactly as an installed app closes. An outside-scope
// page can watch activation without racing to acquire the old worker on navigation.
await reopened.goto(new URL('/observe-update.html',address).href);
await p.close();
await waitForStorage(reopened,async({url,oldCaches})=>{
  const reg=await navigator.serviceWorker.getRegistration(url),names=await caches.keys();
  return reg?.active?.state==='activated'&&!reg.waiting&&!reg.installing&&
    names.some(k=>k.startsWith('yu-study-shell-')&&!oldCaches.includes(k))&&!names.some(k=>oldCaches.includes(k));
},{url:address,oldCaches});
const resumed=await reopened.goto(address);
assert.equal(resumed.fromServiceWorker(),true);
await reopened.waitForFunction(()=>navigator.serviceWorker.controller?.state==='activated');
if(previous){
  await reopened.getByRole('button',{name:'설정',exact:true}).click();
  await reopened.getByText('기기 저장 · v'+require('../package.json').version,{exact:true}).waitFor().catch(async error=>{
    console.error('Upgrade UI',await reopened.locator('main').innerText(),await reopened.locator('#notice').textContent(),pageErrors);
    console.error('Scripts / cache',await reopened.evaluate(async()=>[document.scripts[0]?.src,await caches.keys()]));throw error;
  });
}
assert.deepEqual(await storedArchive(reopened),before);
// WebKit's offline emulation rejects even literal service-worker responses
// (microsoft/playwright#42775). Stop the origin for both engines instead;
// Chromium also exercises the browser's offline flag.
const closed=new Promise(resolve=>server.close(resolve));server.closeAllConnections();await closed;
await assert.rejects(fetch(address));
if(engine===chromium)await context.setOffline(true);
const offlineResponse=await reopened.reload();assert.equal(offlineResponse.fromServiceWorker(),true);
await reopened.getByRole('heading',{name:'학습 서재'}).waitFor();await reopened.getByRole('button',{name:'오답노트',exact:true}).click();await reopened.locator('[data-detail]').first().click();await reopened.locator('.crops canvas').waitFor();assert.deepEqual(pageErrors,[]);console.log('PASS: import, auto crop, session, notebook rendering, A4 PDF file, full backup and restore, app update, origin stopped, service-worker reload and PDF rendering.');
}finally{await browser?.close();if(server.listening)server.close();clearTimeout(deadline)}})().catch(e=>{console.error(e);process.exitCode=1});
