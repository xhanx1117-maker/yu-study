import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {initial} from '../src/model.js';
import {testServer} from './test-server.mjs';

const require=createRequire(import.meta.url);
const {chromium,webkit}=require('playwright');
const tablet=process.env.YU_TEST_ENGINE==='webkit',engine=tablet?webkit:chromium;
const server=testServer();
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port;
const deadline=setTimeout(()=>{console.error('Input tests exceeded three minutes');process.exit(1)},180000);
deadline.unref();
let context;
try{
  context=await engine.launchPersistentContext('',{headless:true,
    viewport:tablet?{width:1194,height:834}:{width:1440,height:900},hasTouch:tablet,isMobile:tablet,
    ...(tablet?{userAgent:'Mozilla/5.0 (iPad; CPU OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Mobile/15E148 Safari/604.1'}:{executablePath:process.env.YU_BROWSER})
  });
  const page=await context.newPage(),errors=[];
  page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
  const cdp=tablet?null:await context.newCDPSession(page);
  await page.addInitScript(()=>{
    window.archiveTransactions=0;
    const transaction=IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction=function(...args){
      if(this.name==='yu-study-archive')window.archiveTransactions++;
      return transaction.apply(this,args);
    };
  });
  await page.goto(origin+'/seed.html');
  const archive=initial();
  archive.books=[{id:'book',subject:'국어',title:'가상 분류표',themes:[{id:'wave',number:'01',title:'파도 연습'},{id:'cloud',number:'02',title:'구름 연습'}]}];
  for(let i=0;i<22;i++){
    const doc={id:'d'+i,hash:i.toString(16).padStart(64,'0'),subject:'국어',type:'기출문제지',count:i<2?1:100,
      title:i===0?'바다 Atlas':i===1?'구름 실습':'가상 묶음 '+i,year:'2025',exam:'연습',session:'s'+i,tags:i===0?'파랑':''};
    archive.documents.push(doc);archive.sessions.push({id:doc.session,doc:doc.id,date:'2025-01-01'});
    for(let n=1;n<=doc.count;n++){
      const id=doc.id+'#'+n;
      archive.questions.push({id,doc:doc.id,number:n,text:i===0?'바다 Atlas 지도':i===1?'구름 도감':('연습 문장 '+n+' ').repeat(24),
        regions:[],theme:i===0?'wave':null,secondary:[],memo:'',status:'미복습'});
      archive.events.push({id:doc.session+'#'+n,q:id,session:doc.session,number:n,date:'2025-01-01'});
    }
  }
  await page.evaluate(async archive=>{
    const db=await new Promise((res,rej)=>{const r=indexedDB.open('yu-study-archive',1);
      r.onupgradeneeded=()=>{r.result.createObjectStore('meta');r.result.createObjectStore('files')};
      r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)});
    await new Promise((res,rej)=>{const tx=db.transaction('meta','readwrite');tx.objectStore('meta').put(archive,'archive');tx.oncomplete=res;tx.onabort=()=>rej(tx.error)});
    db.close();
  },archive);
  await page.goto(origin+'/yu-study/');
  const nav=name=>page.getByRole('button',{name,exact:true}).click();
  const open=async sel=>{const box=page.locator(sel);if(!await box.evaluate(el=>el.open))await box.locator('summary').first().click()};
  const waitCount=(sel,n)=>page.waitForFunction(([sel,n])=>document.querySelectorAll(sel).length===n,[sel,n]);
  const transactions=()=>page.evaluate(()=>window.archiveTransactions);
  const wait=ms=>page.waitForTimeout(ms);
  const assertField=async(sel,value,cursor)=>{
    const state=await page.locator(sel).evaluate(el=>({same:el===window.originalField,focused:document.activeElement===el,value:el.value,start:el.selectionStart,end:el.selectionEnd}));
    assert.deepEqual(state,{same:true,focused:true,value,start:cursor,end:cursor},sel+' must preserve the native input and selection');
  };
  async function mark(sel){
    const field=page.locator(sel);await field.focus();
    await field.evaluate(el=>{window.originalField=el});
    return field;
  }
  // Chromium exposes a real browser composition session over CDP. WebKit uses its
  // normal editable control plus DOM event sequences observed on Safari.
  async function composition(sel){
    const field=await mark(sel);
    const range=await field.evaluate(el=>[el.selectionStart,el.selectionEnd]);
    let length=range[1]-range[0],last='';
    if(!cdp)await field.dispatchEvent('compositionstart',{data:''});
    return {
      async update(text){
        last=text;
        if(cdp){await cdp.send('Input.imeSetComposition',{text,selectionStart:text.length,selectionEnd:text.length});return}
        await field.evaluate((el,{text,start,old})=>{
          el.dispatchEvent(new CompositionEvent('compositionupdate',{bubbles:true,data:text}));
          el.dispatchEvent(new InputEvent('beforeinput',{bubbles:true,inputType:'insertCompositionText',isComposing:true,data:text}));
          el.setRangeText(text,start,start+old,'end');
          el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertCompositionText',isComposing:true,data:text}));
        },{text,start:range[0],old:length});
        length=text.length;
      },
      async end(){
        if(cdp){await cdp.send('Input.insertText',{text:last});return}
        await field.evaluate((el,text)=>{
          el.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:text}));
          el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertFromComposition',data:text,isComposing:false}));
        },last);
      }
    };
  }
  async function compose(sel,steps){const ime=await composition(sel);for(const text of steps)await ime.update(text);await ime.end()}
  async function observeTextEdits(sel,extra=''){
    const field=await mark(sel);await field.fill('');
    await compose(sel,['ㅎ','하','한']);await page.keyboard.type(' A');await page.keyboard.press('Backspace');await page.keyboard.insertText('B'+extra);
    await assertField(sel,'한 B'+extra,3+extra.length);return field;
  }

  await nav('오답노트');await open('#filters');await waitCount('[data-q]',28);
  const reads=await transactions(),query='#f-search';
  const ime=await composition(query);
  await ime.update('ㅂ');await wait(370);
  await assertField(query,'ㅂ',1);await waitCount('[data-q]',28);
  await ime.update('바');await ime.update('바ㄷ');await wait(350);
  await assertField(query,'바ㄷ',2);await waitCount('[data-q]',28);
  await ime.update('바다');await ime.end();await waitCount('[data-q]',1);await assertField(query,'바다',2);
  assert.equal(await page.locator('[data-q]').getAttribute('data-q'),'d0#1');

  const field=page.locator(query);
  await field.fill('바다Atlas');await field.evaluate(el=>el.setSelectionRange(2,2));
  await page.keyboard.press('Space');await waitCount('[data-q]',1);await wait(300);await assertField(query,'바다 Atlas',3);
  await page.keyboard.press('Backspace');await waitCount('[data-q]',0);await assertField(query,'바다Atlas',2);
  await field.fill('바다 ATLAS'.normalize('NFD'));await waitCount('[data-q]',1);
  await page.keyboard.press('End');await field.evaluate(el=>el.setSelectionRange(1,3,'backward'));await wait(300);
  assert.deepEqual(await field.evaluate(el=>[el.selectionStart,el.selectionEnd,el.selectionDirection]),[1,3,'backward']);
  await field.fill('구름');await page.locator('#f-sort').focus();await waitCount('[data-q]',1);
  await page.waitForFunction(()=>document.querySelector('[data-q]')?.dataset.q==='d1#1');
  assert.equal(await page.evaluate(()=>document.activeElement.id),'f-sort');
  assert.equal(await transactions(),reads,'typing did not read or write IndexedDB');

  await open('.theme-options');const themes='#f-theme-search';
  await compose(themes,['ㅍ','파','파도']);
  await page.waitForFunction(()=>document.querySelector('[data-ft="cloud"]').closest('label').hidden);
  await page.locator('[data-ft="wave"]').check();await page.locator(themes).fill('구름');
  await page.waitForFunction(()=>document.querySelector('[data-ft="wave"]').closest('label').hidden);
  assert.equal(await page.locator('[data-ft="wave"]').isChecked(),true);await waitCount('[data-q]',0);
  await page.locator('#f-clear').click();await waitCount('[data-q]',28);
  await field.fill('사라질 초안');await page.locator('#f-clear').click();await wait(300);assert.equal(await field.inputValue(),'');
  await field.fill('이전 화면');await nav('자료실');await waitCount('[data-doc]',22);
  const libReads=await transactions(),lib='#query',libField=await mark(lib);
  const libIME=await composition(lib);await libIME.update('ㅂ');await wait(350);
  await assertField(lib,'ㅂ',1);await waitCount('[data-doc]',22);await libIME.update('바다');await libIME.end();
  await waitCount('[data-doc]',1);await assertField(lib,'바다',2);
  await libField.fill('파랑');await waitCount('[data-doc]',1);await wait(300);
  assert.equal(await page.locator('[data-doc]').getAttribute('data-doc'),'d0');
  assert.equal(await transactions(),libReads);

  // Use the browser's actual copy and paste commands, including a Korean/English
  // selection, a space and replacement in the middle of the query.
  await libField.fill('바다 Atlas');await libField.selectText();
  const mod=process.platform==='darwin'?'Meta':'Control';
  await page.keyboard.press(mod+'+c');await libField.evaluate(el=>el.setSelectionRange(1,el.value.length-1));await page.keyboard.press(mod+'+v');
  await page.waitForFunction(()=>document.querySelector('#query').value==='바바다 Atlass');
  await wait(300);await assertField(lib,'바바다 Atlass',9);
  await libField.fill('');await waitCount('[data-doc]',22);
  assert.equal(await transactions(),libReads);

  await page.locator('[data-edit="d0"]').click();
  await observeTextEdits('#title');await observeTextEdits('#tags');await observeTextEdits('#et');
  await page.locator('#apply').click();await page.locator('#modal').waitFor({state:'hidden'});
  await page.locator('#query').fill('한 b');await waitCount('[data-doc]',1);
  assert.equal(await page.locator('[data-doc]').getAttribute('data-doc'),'d0');
  await nav('오답노트');await open('#filters');assert.equal(await page.locator(query).inputValue(),'');
  await page.locator(query).fill('한 b');await waitCount('[data-q]',1);await page.locator('[data-detail="d0#1"]').click();
  await observeTextEdits('#memo','\n두 줄');await page.getByText('정답·해설 연결',{exact:true}).click();
  await observeTextEdits('#solution-text',' 해설');await page.locator('#qsave').click();await page.locator('#modal').waitFor({state:'hidden'});
  await page.locator(query).fill('두 줄');await waitCount('[data-q]',1);await page.locator('[data-detail="d0#1"]').click();
  assert.equal(await page.locator('#memo').inputValue(),'한 B\n두 줄');
  assert.equal(await page.locator('#solution-text').inputValue(),'한 B 해설');await page.locator('dialog form button').click();
  await nav('설정');await page.locator('#custom').click();await observeTextEdits('#ct');await page.locator('#csave').click();
  await page.locator('#modal').waitFor({state:'hidden'});await page.getByText('국어 · 개인 목차',{exact:true}).waitFor();

  // Launch from the manifest start URL while the origin is actually stopped.
  const registration=await page.evaluate(async()=>{
    const r=await navigator.serviceWorker.ready,href=document.querySelector('link[rel=manifest]').href;
    const manifest=await (await fetch(href)).json();
    return {scope:r.scope,start:new URL(manifest.start_url,href).href,display:manifest.display};
  });
  assert.equal(registration.start,origin+'/yu-study/');assert.equal(registration.display,'standalone');
  await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
  const stopped=new Promise(resolve=>server.close(resolve));server.closeAllConnections();await stopped;
  if(!tablet)await context.setOffline(true);
  const response=await page.goto(registration.start);assert.equal(response.fromServiceWorker(),true);
  await nav('오답노트');await open('#filters');await compose(query,['ㄷ','두','두 줄']);await waitCount('[data-q]',1);
  assert.equal(await page.locator('[data-q]').getAttribute('data-q'),'d0#1');
  assert.deepEqual(errors,[]);
  console.log('PASS '+engine.name()+': 2,002 questions, composition across pauses, middle edits and selection, English/Korean, spaces, backspace, real clipboard, unchanged field/focus, zero archive transactions while filtering, theme choices, title/tag/exam/memo/solution/custom-theme save and offline PWA start URL.');
}finally{
  await context?.close();if(server.listening)server.close();clearTimeout(deadline);
}
