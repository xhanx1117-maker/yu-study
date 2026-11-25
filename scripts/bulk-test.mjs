import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {testServer} from './test-server.mjs';
import {fixturePaper} from './bulk-fixture.mjs';
const require=createRequire(import.meta.url),{chromium,webkit}=require('playwright'),Zip=require('jszip');
const tablet=process.env.YU_TEST_ENGINE==='webkit',server=testServer({sourceModules:true});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url='http://127.0.0.1:'+server.address().port+'/yu-study/';
const ctx=await (tablet?webkit:chromium).launchPersistentContext('',{headless:true,viewport:{width:834,height:1194},hasTouch:true,isMobile:tablet,
  ...(!tablet&&process.env.YU_BROWSER?{executablePath:process.env.YU_BROWSER}:{})});
const stop=setTimeout(()=>{console.error('Collection integration test timed out');process.exit(1)},210000);stop.unref();
try{
  const page=await ctx.newPage(),errors=[];page.setDefaultTimeout(18000);page.on('pageerror',e=>errors.push(e.message));
  const paper=await fixturePaper(),long=await fixturePaper(25),key=Buffer.concat([paper,Buffer.from('\n% answer key')]);
  const zip=new Zip();zip.file('2025/국가직9급/행정법_가.pdf'.normalize('NFD'),paper);
  zip.file('2025/국가직9급/행정법_가_복사.pdf',paper);zip.file('__MACOSX/._행정학.pdf',paper);
  zip.file('2025/국가직9급/행정학_가.pdf',long);
  zip.file('2025/국가직9급/통합 최종 정답.pdf',key);zip.file('기타/깨진.pdf',Buffer.from('broken'));zip.file('설명.txt','readme');
  const other=Buffer.concat([paper,Buffer.from('\n% another variant')]),z2=new Zip();z2.file('2024/지방직7급/행정법_나.pdf',other);
  const files=[{name:'첫째.zip',mimeType:'application/zip',buffer:await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'})},
    {name:'둘째.zip',mimeType:'application/zip',buffer:await z2.generateAsync({type:'nodebuffer'})}];
  async function click(id){await page.locator('#'+id).click()}
  async function nav(name){await page.getByRole('button',{name,exact:true}).first().click()}
  async function snapshot(){return page.evaluate(async()=>await (await import('/proof-src/db.js')).state())}
  async function openBulk(){await nav('자료실');await click('bring')}
  const modal=page.locator('#modal');await page.goto(url);await openBulk();
  const picking=page.waitForEvent('filechooser');await page.locator('#bulk-files').tap();await (await picking).setFiles(files);
  await page.locator('#bulk-register').waitFor();
  assert.match(await page.locator('#bulk-counts').innerText(),/발견 6개 · 신규 4 · 등록 0 · 중복 1 · 실패 1/);
  assert.equal((await snapshot()).documents.length,0);
  // Reload after preview: staged bytes and analysis summaries survive without another picker.
  await page.reload();await openBulk();await click('bulk-register');
  await page.waitForFunction(()=>document.querySelector('#scan-counts')?.textContent.includes('문항 분석 완료 3'));
  const saved=await snapshot();assert.equal(saved.documents.length,4);
  const law=saved.documents.find(d=>d.subject==='행정법'&&d.year==='2025'),admin=saved.documents.find(d=>d.subject==='행정학'),answer=saved.documents.find(d=>d.type==='정답지');
  assert.equal(law.count,20);assert.equal(admin.count,25);assert.equal(answer.combined,true);assert.equal(law.form,'가');assert.equal(law.exam,'국가직 9급');
  const expectedHash=createHash('sha256').update(paper).digest('hex');assert.equal(law.hash,expectedHash);assert.ok(law.externalRegions);
  page.once('dialog',d=>d.accept());await click('bulk-finish');await modal.waitFor({state:'hidden'});
  await page.locator('[data-doc="'+law.id+'"]').click();await page.locator('#open-answer').waitFor();
  await page.locator('[data-n="3"]').click();await click('save');await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('오답을 저장'));
  await click('open-answer');await page.getByRole('heading',{name:answer.title}).waitFor();assert.equal(await page.locator('.numbers').count(),0);
  await nav('자료실');await click('library-edit');await page.locator('[data-select="'+law.id+'"]').check();const selectedZip=page.waitForEvent('download');await click('export-zip');assert.equal((await selectedZip).suggestedFilename(),'Yu-study-선택자료.zip');
  await modal.waitFor({state:'hidden'});await click('trash-docs'); // browser's default cancel protects an unconfirmed deletion
  assert.ok(!(await snapshot()).documents.find(d=>d.id===law.id).deleted);page.once('dialog',d=>d.accept());await click('trash-docs');
  await page.waitForFunction(id=>!document.querySelector('[data-doc="'+id+'"]'),law.id);
  await click('trash');await click('library-edit');await page.locator('[data-select="'+law.id+'"]').check();await click('restore-docs');
  await click('trash');await page.locator('[data-doc="'+law.id+'"]').waitFor();
  await click('inventory');await page.locator('button[data-cell]').first().waitFor();assert.match(await modal.innerText(),/확인되지 않음/);await page.keyboard.press('Escape');
  await nav('설정');const download=page.waitForEvent('download');await click('backup');const zipPath=await (await download).path(),bytes=await readFile(zipPath);
  const portable=await Zip.loadAsync(bytes);const meta=JSON.parse(await portable.file('archive.json').async('string'));
  assert.equal(meta.documents.find(d=>d.id===law.id).detected[3].regions.length,1);
  assert.equal((await portable.file('files/'+law.hash).async('nodebuffer')).compare(paper),0);
  await modal.waitFor({state:'hidden'});const choice=page.waitForEvent('filechooser');await click('merge-restore');page.once('dialog',d=>d.accept());
  await (await choice).setFiles({name:'backup.zip',mimeType:'application/zip',buffer:bytes});await page.waitForFunction(()=>document.querySelector('#notice').textContent==='복원했습니다.');
  const merged=await snapshot();assert.equal(merged.documents.length,4);assert.equal(merged.events.length,1);assert.ok(merged.questions[0].regions.length);
  await openBulk();await page.locator('#bulk-files').setInputFiles({name:'backup.zip',mimeType:'application/zip',buffer:bytes});
  await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('전체 앱 백업'));assert.equal((await snapshot()).events.length,1);
  await modal.locator('form button').click();
  // A direct multi-PDF selection, cancelled after a committed 24-paper batch.
  const pending=Array.from({length:26},(_,i)=>({name:'2023_지방직9급_행정법_'+i+'.pdf',mimeType:'application/pdf',buffer:Buffer.concat([paper,Buffer.from('\n% batch '+i)])}));
  await click('bring');await page.locator('#bulk-files').setInputFiles(pending);await page.locator('#bulk-register').waitFor();
  await page.locator('summary').filter({hasText:'가져오기 설정'}).click();await page.locator('[data-bulk-option="analyse"]').uncheck();
  await page.waitForFunction(()=>!document.querySelector('[data-bulk-option="analyse"]').checked);
  // Pause at the next progress event for the first committed group (no timer race).
  await page.evaluate(()=>{
    const observer=new MutationObserver(()=>{if(document.querySelector('#bulk-numbers')?.textContent.includes('등록 24')){observer.disconnect();document.querySelector('#bulk-pause').click()}});
    observer.observe(document.querySelector('#modal'),{childList:true,subtree:true,characterData:true});
  });
  await click('bulk-register');await page.waitForFunction(()=>document.querySelector('#bulk-counts')?.textContent.includes('등록 24'));
  assert.equal((await snapshot()).documents.length,28);
  await page.reload();await openBulk();await click('bulk-register');await page.waitForFunction(()=>document.querySelector('#bulk-counts')?.textContent.includes('등록 26'));
  assert.equal((await snapshot()).documents.length,30);await click('bulk-finish');await modal.waitFor({state:'hidden'});
  await page.waitForFunction(()=>navigator.serviceWorker.controller?.state==='activated');
  if(!tablet)await ctx.setOffline(true);
  const offline=await page.reload();assert.equal(offline.fromServiceWorker(),true);
  await nav('자료실');await page.locator('[data-doc="'+law.id+'"]').click();
  await page.locator('.numbers [data-n="3"][aria-pressed=true]').waitFor();assert.deepEqual(errors,[]);
  console.log('PASS '+(tablet?'WebKit':'Chromium')+' ZIP, nested NFC/NFD, DEFLATE/STORE, corrupt isolation, exact duplicates, grade/form, shared final key, 20/25 crops, reload/resume, batch pause, intact originals, trash/restore, inventory, ZIP backup/merge and offline study.');
}finally{await ctx.close();server.close();clearTimeout(stop)}
