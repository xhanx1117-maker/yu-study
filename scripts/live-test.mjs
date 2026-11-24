import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
const require=createRequire(import.meta.url);
const {chromium}=require('playwright'),{PDFDocument}=require('pdf-lib');
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
  assert.equal(registration.scope,url);
  assert.equal(registration.script,url+'sw.js');
  await page.waitForFunction(()=>navigator.serviceWorker.controller?.state==='activated');
  await context.setOffline(true);
  const offline=await page.reload();
  assert.equal(offline.fromServiceWorker(),true);
  await page.getByRole('heading',{name:'학습 서재'}).waitFor();
  await page.getByRole('button',{name:'오답노트',exact:true}).click();
  await page.locator('.crops canvas').waitFor();
  assert.equal(await page.locator('[data-q]').count(),1);
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({version,url,status:response.status(),registration,verified:['native PDF picker','local PDF storage','question extraction','wrong-answer record','offline reload','offline notebook rendering']}));
}finally{
  await browser?.close();
  clearTimeout(deadline);
}
