import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {initial,record} from '../src/model.js';
import {fixturePaper} from './bulk-fixture.mjs';
import {testServer} from './test-server.mjs';
const require=createRequire(import.meta.url),{chromium,webkit}=require('playwright'),Zip=require('jszip');
const tablet=process.env.YU_TEST_ENGINE==='webkit',server=testServer({sourceModules:true});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base='http://127.0.0.1:'+server.address().port,url=base+'/yu-study/';
const ctx=await (tablet?webkit:chromium).launchPersistentContext('',{headless:true,...(tablet?{}:{executablePath:process.env.YU_BROWSER}),viewport:{width:834,height:1194},hasTouch:true,isMobile:tablet});
try{
  const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(15000);
  await page.addInitScript(()=>Object.defineProperty(navigator,'standalone',{configurable:true,value:true}));
  const pdf=await fixturePaper(18),s=initial(),blobs=[];
  function document(id,title,type,extra={}){
    const bytes=Buffer.concat([pdf,Buffer.from('\n%'+id)]),hash=createHash('sha256').update(bytes).digest('hex');
    const d={id,title,type,hash,filename:title+'.pdf',size:bytes.length,subject:'행정법',year:'2026',exam:'국가직 9급',form:'가',round:'1',count:18,session:id+'-s',scanned:true,...extra};
    blobs.push([hash,[...bytes]]);s.documents.push(d);s.sessions.push({id:d.session,doc:id,date:'2026-01-01'});return d;
  }
  const paper=document('paper','가상 행정법 원문','시험지'),key=document('key','가상 통합 최종 정답','정답지',{subject:'통합',combined:true,answerEdition:'최종',authority:'공식'});
  const sol=document('sol','가상 해설집','문제·해설 혼합'),wrong=document('old','잘못 분류한 자료','기출문제지',{round:'2'});
  document('admin','가상 행정학 원문','기출문제지',{subject:'행정학'});document('different','다른 책형','정답지',{form:'나'});
  document('shared','공유 해설 원본','해설지',{deleted:true,round:'2'});
  wrong.solutionIds=['shared'];record(s,paper,paper.session,[2]);record(s,wrong,wrong.session,[3]);
  s.questions[0].solution={doc:sol.id,page:2};s.questions[1].memo='보존';s.questions[0].regions=[{page:1,x:.04,y:.05,w:.4,h:.21}];
  for(let i=0;i<68;i++)document('trash'+i,'삭제 연습 '+i,'기타',{deleted:true});
  await page.goto(base+'/seed.html');
  await page.evaluate(async({s,blobs})=>{
    const db=await import('/proof-src/db.js');await db.change(()=>s,blobs.map(([hash,bytes])=>[hash,new Blob([new Uint8Array(bytes)],{type:'application/pdf'})]));
  },{s,blobs});
  await page.goto(url);
  async function nav(name){
    await page.locator('nav').getByRole('button',{name,exact:true}).click();
    await page.getByRole('heading',{name:name==='홈'?'학습 서재':name,exact:true}).waitFor();
  }
  const click=id=>page.locator('#'+id).click(),heading=name=>page.getByRole('heading',{name,exact:true}).waitFor();
  const loaded=()=>page.waitForFunction(()=>document.querySelector('.paper canvas')?.width>350);
  const snapshot=()=>page.evaluate(async()=>(await import('/proof-src/db.js')).state());
  async function switchDoc(id,title){await page.locator('.workspace-tabs [data-open-material="'+id+'"]').click();await heading(title);await loaded()}
  const swipe=async(dx,dy)=>page.evaluate(({dx,dy})=>{
    const target=document.querySelector('main');
    function fire(name,x,y,end){const e=new Event(name,{bubbles:true,cancelable:true}),touch={identifier:9,clientX:x,clientY:y};
      Object.assign(e,{changedTouches:[touch],touches:end?[]:[touch]});target.dispatchEvent(e)}
    fire('touchstart',4,80);fire('touchmove',4+dx,80+dy);fire('touchend',4+dx,80+dy,true);
  },{dx,dy});
  await nav('자료실');assert.equal(await page.locator('[data-doc]').count(),3);
  await page.locator('[data-kind="해설지"]').click();assert.equal(await page.locator('[data-doc]').count(),1);
  await page.locator('[data-kind="정답지"]').click();await page.locator('[data-lib-sub="행정학"]').click();
  assert.deepEqual(await page.locator('[data-doc]').evaluateAll(bs=>bs.map(b=>b.dataset.doc)),['key']);
  await click('scope-back');await page.locator('[data-lib-sub=""][aria-pressed=true]').waitFor();
  assert.equal(await page.locator('[data-kind="정답지"]').getAttribute('aria-pressed'),'true');
  await nav('자료실');await page.locator('[data-lib-sub="행정법"]').click();await page.locator('#query').fill('가상 행정법');
  await page.waitForFunction(()=>document.querySelectorAll('[data-card]').length===1);
  await page.locator('[data-card="paper"] [data-open-material="paper"]').click();await loaded();
  await click('next');await page.waitForFunction(()=>document.querySelector('#pg').value==='2');await click('zoom');await page.waitForFunction(()=>document.querySelector('.paper').style.width==='150%');
  await page.locator('[data-n="4"]').click();
  const scroll=await page.locator('.sheet').evaluate(el=>{el.scrollTo(32,65);return [el.scrollLeft,el.scrollTop]});
  await switchDoc('key',key.title);assert.equal(await page.locator('.numbers').count(),0);
  await switchDoc('sol',sol.title);await switchDoc('paper',paper.title);
  assert.equal(await page.locator('#pg').inputValue(),'2');assert.equal(await page.locator('.paper').evaluate(el=>el.style.width),'150%');
  assert.deepEqual(await page.locator('.sheet').evaluate(el=>[el.scrollLeft,el.scrollTop]),scroll);
  assert.equal(await page.locator('[data-n="4"]').getAttribute('aria-pressed'),'true');
  await swipe(18,100);await heading(paper.title);await swipe(130,6);
  await heading('자료실');assert.equal(await page.locator('#query').inputValue(),'가상 행정법');
  assert.equal(await page.locator('[data-card]').count(),1);
  await nav('오답노트');await page.locator('[data-subject="행정법"]').click();
  await click('notebook-back');await page.locator('[data-subject=""][aria-pressed=true]').waitFor();
  await page.locator('[data-detail="paper#2"]').click();await click('goto-solution');await heading(sol.title);await loaded();
  assert.equal(await page.locator('#pg').inputValue(),'2');await click('view-back');await page.locator('#modal #goto-original').waitFor();
  await page.keyboard.press('Escape');await page.locator('#modal').waitFor({state:'hidden'});
  await nav('자료실');await click('library-edit');await page.locator('[data-select="old"]').check();await click('edit-selected');
  await page.locator('#bulk-kind').selectOption('해설지');page.once('dialog',d=>d.accept());await click('apply-batch');
  await page.waitForFunction(()=>!document.querySelector('#modal').open);
  let a=await snapshot();assert.equal(a.documents.find(d=>d.id==='old').hash,wrong.hash);assert.equal(a.questions.find(q=>q.doc==='old').memo,'보존');assert.equal(a.events.length,2);
  await click('trash');await heading('자료실 휴지통');await swipe(125,5);await heading('자료실');
  await click('trash');await nav('자료실');await heading('자료실');assert.equal(await page.locator('[data-kind="문제지"]').getAttribute('aria-pressed'),'true');
  await click('trash');await click('empty-library-trash');await click('stop-purge');
  assert.equal((await snapshot()).documents.length,s.documents.length);
  await click('empty-library-trash');
  await page.evaluate(()=>{
    const original=window.setTimeout;
    window.setTimeout=function(fn,delay,...args){
      if(delay===0&&document.querySelector('#purge-files')?.closest('[aria-busy=true]')&&document.querySelector('#modal [role=status]')?.textContent.includes('32 /'))return 0;
      return original.call(window,fn,delay,...args);
    };
  });
  await click('purge-files');await page.waitForFunction(()=>document.querySelector('#modal [role=status]')?.textContent.includes('32 /'));
  await page.reload();await nav('자료실');await click('trash');await click('resume-purge');await click('purge-files');
  await page.waitForFunction(()=>!document.querySelector('#modal').open);
  a=await snapshot();assert.equal(a.documents.filter(d=>d.deleted).length,1);assert.ok(a.documents.find(d=>d.id==='shared'));
  assert.equal(a.events.length,2);assert.deepEqual(a.questions.find(q=>q.id==='paper#2').regions,s.questions[0].regions);
  await click('brand-home');await heading('학습 서재');await nav('설정');await page.locator('main > footer.settings-credit').waitFor();assert.equal(await page.locator('main > :last-child').textContent(),'Made by Yuchan.');
  await page.locator('summary').filter({hasText:'저장 공간 관리'}).click();await click('settings-back');
  await page.waitForFunction(()=>document.querySelector('[data-settings-panel="storage"]')?.open===false);
  await nav('자료실');await click('bring');
  const zip=new Zip(),path='2026/국가직9급/제1회/행정법_가_추가.pdf',bytes=Buffer.concat([pdf,Buffer.from('\n%manifest-study')]);
  const {PDFDocument}=require('pdf-lib'),appended=await PDFDocument.create();
  appended.addPage().drawText('1. Fictional question only');
  appended.addPage().drawText('Answer: B. Explanation: a fictional worked example');
  zip.file('2025/지방직9급/행정학_시험지.pdf',await appended.save());
  zip.file(path,bytes);zip.file('manifest.json',JSON.stringify({files:[{path,type:'mixed',sha256:createHash('sha256').update(bytes).digest('hex')}]}));
  await page.locator('#bulk-files').setInputFiles({name:'연습.zip',mimeType:'application/zip',buffer:await zip.generateAsync({type:'nodebuffer'})});
  await page.locator('#bulk-register').waitFor();assert.match(await page.locator('#modal').innerText(),/해설지 2/);await click('bulk-register');await click('bulk-library');
  const imported=(await snapshot()).documents.find(d=>d.title.includes('추가'));assert.equal(imported.type,'문제·해설 혼합');assert.equal(imported.analysisState,'off');
  await page.locator('[data-kind="해설지"][aria-pressed=true]').waitFor();
  const mixed=(await snapshot()).documents.find(d=>d.title==='행정학_시험지');assert.equal(mixed.type,'문제·해설 혼합');assert.equal(mixed.analysisState,'off');
  async function single(name,tag,override){
    await nav('홈');await page.locator('#pdf-files').setInputFiles({name,mimeType:'application/pdf',buffer:Buffer.concat([await appended.save(),Buffer.from('\n%'+tag)])});
    await page.locator('#add').waitFor();
    if(override){await page.locator('#type').selectOption('정답지');await page.locator('#title').fill('직접 수정한 정답표')}
    await click('add');await page.locator('#modal').waitFor({state:'hidden'});
    await page.locator('[data-kind="'+(override?'정답지':'해설지')+'"][aria-pressed=true]').waitFor();
    return (await snapshot()).documents.find(d=>d.filename===name);
  }
  assert.equal((await single('2024_국가직9급_행정학.pdf','single')).type,'문제·해설 혼합');
  const manual=await single('2023_국가직9급_행정법.pdf','manual',true);assert.equal(manual.type,'정답지');assert.equal(manual.title,'직접 수정한 정답표');
  await page.waitForFunction(()=>!!navigator.serviceWorker.controller);await ctx.setOffline(true);await page.reload();
  await nav('자료실');await page.locator('[data-card="paper"] [data-open-material="key"]').click();await heading(key.title);await loaded();
  await switchDoc('paper',paper.title);assert.equal(await page.locator('#pg').inputValue(),'2');assert.equal(await page.locator('.paper').evaluate(el=>el.style.width),'150%');
  assert.deepEqual(errors,[]);console.log('PASS '+(tablet?'WebKit':'Chromium')+' companion roles, matching, selected draft, scroll/zoom, detail return, edge/vertical gesture, mixed ZIP, protected source, purge interruption and offline restart.');
}finally{await ctx.close();server.close()}
