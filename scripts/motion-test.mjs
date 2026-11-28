import assert from 'node:assert/strict';
import {chromium,webkit} from 'playwright';
import {PDFDocument} from 'pdf-lib';
import {testServer} from './test-server.mjs';

const engine=process.env.YU_TEST_ENGINE==='webkit'?webkit:chromium;
const server=testServer({sourceModules:true});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin='http://127.0.0.1:'+server.address().port;
const pdf=await PDFDocument.create();pdf.addPage([700,1000]);pdf.addPage([700,1000]);const bytes=[...await pdf.save()];
const start=async touch=>engine.launchPersistentContext('',{
  headless:true,hasTouch:touch,isMobile:touch,viewport:touch?{width:834,height:1194}:{width:1380,height:900},
  ...(engine===chromium?{executablePath:process.env.YU_BROWSER}:{})
});
async function setup(context){
  const page=context.pages()[0]||await context.newPage();page.setDefaultTimeout(15000);
  await page.goto(origin+'/seed.html');
  await page.evaluate(async bytes=>{
    const {change,hash}=await import('/proof-src/db.js');
    const file=new Blob([new Uint8Array(bytes)],{type:'application/pdf'}),key=await hash(file);
    await change(s=>{
      s.documents.push({id:'sample',title:'가상 시험',subject:'행정학',year:'2026',exam:'지방직 9급',grade:'9급',form:'가',hash:key,count:20,type:'기출문제지',session:'attempt'});
      s.sessions.push({id:'attempt',doc:'sample',date:new Date().toISOString()});
    },[[key,file]]);
  },bytes);
  await page.goto(origin+'/yu-study/');await page.getByRole('heading',{name:'학습 서재'}).waitFor();
  return page;
}
const transform=e=>getComputedStyle(e).transform;
async function send(locator,type,extra={}){
  await locator.dispatchEvent(type,{pointerType:'touch',isPrimary:true,button:0,pointerId:4,clientX:50,clientY:50,...extra});
}
try{
  if(engine===chromium){
    const desktop=await start(false);
    try{
      const page=await setup(desktop),nav=page.getByRole('button',{name:'자료실',exact:true});
      await nav.hover();
      await page.waitForFunction(()=>getComputedStyle(document.querySelector('button[data-menu="1"]')).transform.includes('-1)'));
      await nav.click();const card=page.locator('.material-card'),title=card.locator('.material-title');
      await title.hover();await page.waitForFunction(()=>getComputedStyle(document.querySelector('.material-title')).transform.includes('-1)'));
      assert.equal(await card.evaluate(transform),'none');
      const manage=card.getByRole('button',{name:'자료 관리'});await manage.hover();
      await page.waitForFunction(()=>getComputedStyle(document.querySelector('.material-title')).transform==='none');
      assert.equal(await card.evaluate(transform),'none');
      await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.matches(':focus-visible')),true);
      const disabled=card.locator('button:disabled').first();await disabled.hover();assert.equal(await disabled.evaluate(transform),'none');
      await page.emulateMedia({reducedMotion:'reduce'});await nav.hover();assert.equal(await nav.evaluate(transform),'none');
      const next=page.getByRole('button',{name:'오답노트',exact:true});await next.click();
      await page.locator('#study-log').click();await page.keyboard.press('Escape');
      assert.equal(await page.locator('#modal').evaluate(d=>d.open),false);
    }finally{await desktop.close()}
  }
  const tablet=await start(true);
  try{
    const page=await setup(tablet),nav=page.getByRole('button',{name:'자료실',exact:true});
    await nav.tap();const card=page.locator('.material-card'),title=card.locator('.material-title'),manage=card.getByRole('button',{name:'자료 관리'});
    await send(manage,'pointerdown');assert.ok(await manage.evaluate(el=>el.hasAttribute('data-pressed')));
    assert.equal(await card.evaluate(transform),'none');assert.equal(await title.evaluate(transform),'none');
    await send(manage,'pointermove',{clientY:76});assert.equal(await manage.getAttribute('data-pressed'),null);
    await send(manage,'pointerdown');await send(manage,'pointercancel');assert.equal(await manage.getAttribute('data-pressed'),null);
    await send(title,'pointerdown');await send(title,'pointerdown',{pointerId:5,isPrimary:false});assert.equal(await title.getAttribute('data-pressed'),null);
    const disabled=card.locator('button:disabled').first();await send(disabled,'pointerdown');assert.equal(await disabled.getAttribute('data-pressed'),null);
    // A real touch tap opens the reader, leaves no hover or press, and preserves navigation on return.
    await title.tap();await page.locator('.paper canvas').waitFor();
    assert.equal(await page.locator('html').getAttribute('data-pointer'),'touch');assert.equal(await page.locator('[data-pressed]').count(),0);
    await page.locator('#view-back').tap();await title.waitFor();
    await page.setViewportSize({width:1194,height:834});
    await page.getByRole('button',{name:'오답노트',exact:true}).tap();await page.locator('#study-log').tap();
    const dialog=page.locator('#modal'),panel=dialog.locator('.modal-panel');await panel.waitFor();await panel.locator('h2').tap();assert.ok(await dialog.evaluate(d=>d.open));
    await page.touchscreen.tap(3,410);await page.waitForFunction(()=>!document.getElementById('modal').open);
    assert.equal(await page.locator('#app h1').textContent(),'오답노트');assert.equal(await page.locator('[data-pressed]').count(),0);
    await page.emulateMedia({reducedMotion:'reduce'});
    const study=page.locator('#study-log');await send(study,'pointerdown');assert.equal(await study.evaluate(transform),'none');await send(study,'pointerup');
    console.log(engine.name()+': control-only press, scroll/pinch cancellation, touch tap, tablet rotation, popup dismissal and reduced motion passed.');
  }finally{await tablet.close()}
}finally{await new Promise(resolve=>server.close(resolve))}
