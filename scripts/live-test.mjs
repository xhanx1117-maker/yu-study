import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
const require=createRequire(import.meta.url);
const {chromium}=require('playwright'),{PDFDocument}=require('pdf-lib');
const Zip=require('jszip');
const {version}=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
const url=process.env.YU_LIVE_URL||'https://xhanx1117-maker.github.io/yu-study/';
assert.equal(url,'https://xhanx1117-maker.github.io/yu-study/');
const deadline=setTimeout(()=>{console.error('Live verification exceeded 180 seconds.');process.exit(1)},180000);
deadline.unref();
let browser;
try{
  browser=await chromium.launch({headless:true,executablePath:process.env.YU_BROWSER});
  let context,page,response;
  // Allow Pages/CDN propagation, using a fresh profile for each version check.
  for(let attempt=0;attempt<10;attempt++){
    context=await browser.newContext({viewport:{width:834,height:1194},hasTouch:true,isMobile:true});
    page=await context.newPage();page.setDefaultTimeout(20000);
    response=await page.goto(url);
    assert.equal(response.status(),200);
    await page.getByRole('heading',{name:'학습 서재'}).waitFor();
    await page.getByRole('button',{name:'설정',exact:true}).click();
    try{await page.getByText('기기 저장 · v'+version).waitFor({timeout:3000});break}
    catch(error){await context.close();if(attempt===9)throw error;await new Promise(resolve=>setTimeout(resolve,5000))}
  }
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.getByRole('button',{name:'홈',exact:true}).click();
  const pdf=await PDFDocument.create();
  pdf.addPage([595,842]).drawText('1. Fictional deployment check',{x:40,y:720});
  const choosing=page.waitForEvent('filechooser');
  await page.locator('#pdf-files').tap();
  await (await choosing).setFiles({name:'2026 영어 검증.pdf',mimeType:'application/pdf',buffer:Buffer.from(await pdf.save())});
  await page.locator('#add').click();
  await page.locator('[data-doc]').click();
  await page.waitForFunction(()=>document.querySelector('#reginfo')?.textContent.includes('영역 1개'));
  await page.locator('[data-n="1"]').click();
  await page.locator('#save').click();
  await page.waitForFunction(()=>document.querySelector('#notice')?.textContent.includes('오답을 저장했습니다'));
  const registration=await page.evaluate(async()=>{
    const r=await navigator.serviceWorker.ready;
    return {scope:r.scope,script:r.active.scriptURL};
  });
  const manifest=await page.evaluate(async()=>{
    const href=document.querySelector('link[rel=manifest]').href,data=await (await fetch(href)).json();
    return {name:data.name,start:new URL(data.start_url,href).href,scope:new URL(data.scope,href).href,display:data.display};
  });
  assert.deepEqual(manifest,{name:'Yu: study',start:url,scope:url,display:'standalone'});
  assert.equal(registration.scope,url);
  assert.equal(registration.script,url+'sw.js');
  await page.waitForFunction(()=>navigator.serviceWorker.controller?.state==='activated');
  await context.setOffline(true);
  const offline=await page.reload();
  assert.equal(offline.fromServiceWorker(),true);
  await page.getByRole('heading',{name:'학습 서재'}).waitFor();
  await page.getByRole('button',{name:'오답노트',exact:true}).click();
  await page.locator('[data-subject="영어"]').click();
  await page.locator('#filters > summary').click();
  const search=page.locator('#f-search');await search.focus();
  const ime=await context.newCDPSession(page);
  await search.evaluate(el=>{window.releaseInput=el});
  await ime.send('Input.imeSetComposition',{text:'ㄱ',selectionStart:1,selectionEnd:1});
  await page.waitForTimeout(350);
  assert.ok(await search.evaluate(el=>el===window.releaseInput&&el===document.activeElement));
  assert.equal(await page.locator('[data-q]').count(),1);
  await ime.send('Input.imeSetComposition',{text:'구름',selectionStart:2,selectionEnd:2});
  await ime.send('Input.insertText',{text:'구름'});
  await page.waitForFunction(()=>!document.querySelector('[data-q]'));
  await search.fill('검증');await page.locator('[data-q]').waitFor();
  assert.ok(await search.evaluate(el=>el===window.releaseInput&&el===document.activeElement));
  await ime.detach();
  await page.locator('[data-detail]').first().click();
  await page.locator('.crops canvas').waitFor();
  assert.ok(await page.evaluate(()=>document.elementFromPoint(5,5)?.classList.contains('modal-backdrop')));
  await page.touchscreen.tap(5,5);await page.locator('#modal').waitFor({state:'hidden'});
  await page.locator('#print').click();await page.locator('#make-proof').click();
  await page.locator('#proof-canvas canvas').waitFor();
  assert.equal(await page.locator('[data-q]').count(),1);
  await page.locator('#modal form button').click();
  await page.getByRole('button',{name:'자료실',exact:true}).click();
  await page.locator('#bring').click();
  const corpus=await PDFDocument.create();
  corpus.addPage([728,1031]).drawText('1. Fictional offline archive question',{x:32,y:902});
  const member=await corpus.save(),zip=new Zip();
  zip.file('2025/국가직9급/행정법_나.pdf',member);zip.file('2025/국가직9급/행정법_나_사본.pdf',member);
  await page.locator('#bulk-files').setInputFiles({name:'릴리스-검증.zip',mimeType:'application/zip',buffer:await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'})});
  await page.locator('#bulk-register').waitFor();
  assert.match(await page.locator('#bulk-counts').innerText(),/신규 1 · 등록 0 · 중복 1 · 실패 0/);
  await page.locator('#bulk-register').click();
  await page.waitForFunction(()=>document.querySelector('#scan-counts')?.textContent.includes('분석 완료 1'));
  await page.locator('#bulk-library').click();
  await page.waitForFunction(()=>document.querySelectorAll('[data-doc]').length===2);
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({version,url,status:response.status(),registration,manifest,verified:['native PDF picker','local PDF storage','question extraction','wrong-answer record','offline reload','offline notebook rendering','subject tab','offline native Korean composition and committed search','offline detail backdrop tap','offline workbook preview','offline nested ZIP import, deduplication and question analysis']}));
}finally{
  await browser?.close();
  clearTimeout(deadline);
}
