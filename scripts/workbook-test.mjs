import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fixture} from './workbook-fixture.mjs';

const require=createRequire(import.meta.url);
const {chromium,webkit}=require('playwright');
const root=path.resolve('dist'),out=process.env.YU_PROOF_DIR;
const mime={'.html':'text/html','.js':'application/javascript','.mjs':'application/javascript','.wasm':'application/wasm','.css':'text/css','.webmanifest':'application/manifest+json'};
const server=http.createServer((req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;
  if(pathname==='/seed.html'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Fixture</title>');return}
  const prefix='/yu-study/';
  if(!pathname.startsWith(prefix)){res.writeHead(404).end();return}
  const file=path.resolve(root,decodeURIComponent(pathname.slice(prefix.length))||'index.html');
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.writeHead(404).end();return}
  res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');fs.createReadStream(file).pipe(res);
});
const engine=process.env.YU_TEST_ENGINE==='webkit'?webkit:chromium;
const hasVector=fs.existsSync(path.join(root,'vendor/pdfium.wasm'));
const deadline=setTimeout(()=>{console.error('Workbook test exceeded five minutes');process.exit(1)},300000);
deadline.unref();
let context;
try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port;
  context=await engine.launchPersistentContext('',{headless:true,viewport:{width:834,height:1194},isMobile:true,hasTouch:true,
    ...(engine===chromium?{executablePath:process.env.YU_BROWSER}: {})});
  const page=await context.newPage();page.setDefaultTimeout(20000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/seed.html');
  const ko=await page.evaluate(()=>{
    const c=document.createElement('canvas');c.width=1030;c.height=240;const g=c.getContext('2d');
    g.fillStyle='#fff';g.fillRect(0,0,c.width,c.height);g.fillStyle='#18332a';g.font='bold 28px sans-serif';
    g.fillText('[1~2] 다음 글을 읽고 물음에 답하시오.',12,43);
    g.font='21px sans-serif';g.fillText('연습 지문입니다. 그림과 표의 내용을 함께 살펴보세요.',12,87);
    g.fillStyle='#ef8708';g.fillRect(12,108,160,8);g.fillStyle='#253f37';
    g.strokeRect(12,135,452,74);g.strokeRect(170,135,294,74);g.fillText('자료',27,182);g.fillText('가상 예시',190,182);
    return c.toDataURL('image/png').split(',')[1];
  });
  const {archive,files,source}=await fixture(Buffer.from(ko,'base64'));
  await page.evaluate(async({archive,files})=>{
    const db=await new Promise((res,rej)=>{const r=indexedDB.open('yu-study-archive',1);
      r.onupgradeneeded=()=>{r.result.createObjectStore('meta');r.result.createObjectStore('files')};
      r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)});
    await new Promise((res,rej)=>{const tx=db.transaction(['meta','files'],'readwrite');
      tx.objectStore('meta').put(archive,'archive');
      for(const f of files)tx.objectStore('files').put(new Blob([new Uint8Array(f.bytes)],{type:'application/pdf'}),f.hash);
      tx.oncomplete=res;tx.onabort=()=>rej(tx.error)});db.close();
  },{archive,files});
  if(out){fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'source.pdf'),source)}
  async function readArchive(){
    return page.evaluate(async()=>{
      const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('yu-study-archive',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
      try{return await new Promise((res,rej)=>{const r=db.transaction('meta').objectStore('meta').get('archive');r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
      finally{db.close()}
    });
  }
  await page.goto(origin+'/yu-study/');
  const click=id=>page.locator('#'+id).click(),close=async()=>{await page.locator('dialog form button').click();await page.locator('#modal').waitFor({state:'hidden'})};
  const nav=name=>page.getByRole('button',{name,exact:true}).click();
  const tab=sub=>page.locator('[data-subject="'+sub+'"]').click();
  const hasCount=async(n)=>{await page.waitForFunction(n=>document.querySelectorAll('[data-q]').length===n,n)};
  const detail=id=>page.locator('[data-detail="'+id+'"]').click();
  const summary=async(sel)=>{const el=page.locator(sel);if(!(await el.evaluate(x=>x.open)))await el.locator('summary').first().click()};
  await nav('오답노트');
  for(const [subject,n] of [['국어',2],['영어',1],['행정법',8],['행정학',1]])assert.equal(await page.locator('[data-subject="'+subject+'"] b').textContent(),String(n));
  await tab('행정학');await summary('#filters');assert.equal(await page.locator('[data-ft="case"]').count(),0);
  await page.locator('#f-part').selectOption('part');await page.locator('#f-chapter').selectOption('chapter');await hasCount(1);
  await nav('자료실');await page.locator('[data-doc="admin"]').click();await page.locator('[data-n="2"]').click();await click('save');
  await page.waitForFunction(()=>document.querySelector('#notice')?.textContent.includes('오답을 저장'));
  await nav('오답노트');await tab('행정학');await hasCount(2);await summary('#filters');await page.locator('#f-kind').selectOption('unassigned');await hasCount(1);
  await detail('admin#2');await page.locator('#qt').selectOption('public');await click('qsave');await hasCount(0);
  await click('f-clear');await hasCount(2);
  await tab('행정법');await summary('#group-panel');await page.locator('#group-type').selectOption('theme');
  assert.match(await page.locator('[data-group="case"]').textContent(),/고유 8문항 · 누적 9회/);await page.locator('[data-group="case"]').click();
  await hasCount(8);await summary('#filters');await page.locator('#f-year').selectOption('2025');await hasCount(7);
  await page.locator('#f-search').fill('연습 A 1');await hasCount(1);
  await page.locator('#f-search').fill('연습 A');await hasCount(7);
  await page.locator('#f-sort').selectOption('year');
  await detail('law#1');await page.locator('.crops canvas').waitFor();await close();

  async function make(mode,button='print',extras=[]){
    await click(button);await page.locator('#print-mode').selectOption(mode);
    if(extras.length){await summary('.print-more');for(const key of extras)await page.locator('[data-option="'+key+'"]').check()}
    await click('make-proof');
    try{await page.locator('#proof-canvas canvas').waitFor({timeout:70000})}catch(error){console.error('Proof status:',await page.locator('#print-status').textContent());throw error}
    await page.waitForFunction(()=>/문항 · \d+쪽/.test(document.querySelector('#print-status')?.textContent));
  }
  // Render the actual downloaded file. Locate colored calibration strips in real pixels,
  // extract native body text at its final size, and inspect every output page.
  async function inspect(bytes){
    return page.evaluate(async({bytes,collect})=>{
      const base=new URL('vendor/',document.baseURI),api=await import(new URL('pdf.min.mjs',base).href);
      api.GlobalWorkerOptions.workerSrc=new URL('pdf.worker.min.mjs',base).href;
      const pdf=await api.getDocument({data:new Uint8Array(bytes),standardFontDataUrl:new URL('standard_fonts/',base).href,cMapUrl:new URL('cmaps/',base).href,cMapPacked:true,wasmUrl:new URL('wasm/',base).href}).promise;
      const sheets=[];
      try{for(let n=1;n<=pdf.numPages;n++){
        const p=await pdf.getPage(n),scale=2,v=p.getViewport({scale}),cv=document.createElement('canvas');
        cv.width=Math.ceil(v.width);cv.height=Math.ceil(v.height);const g=cv.getContext('2d',{willReadFrequently:true});
        await p.render({canvasContext:g,viewport:v}).promise;
        const {data}=g.getImageData(0,0,cv.width,cv.height), strips=[],orange=[],blueBounds=[Infinity,Infinity,0,0];let outside=0;
        for(let y=0;y<cv.height;y++){
          let start=-1;let orangeStart=-1;
          for(let x=0;x<=cv.width;x++){
            const at=(y*cv.width+x)*4,r=data[at],gr=data[at+1],b=data[at+2];
            const blue=x<cv.width&&r<48&&gr>85&&gr<155&&b>180;
            const amber=x<cv.width&&r>210&&gr>92&&gr<165&&b<50;
            if(blue){blueBounds[0]=Math.min(blueBounds[0],x);blueBounds[1]=Math.min(blueBounds[1],y);blueBounds[2]=Math.max(blueBounds[2],x);blueBounds[3]=Math.max(blueBounds[3],y)}
            if(r>205&&gr<50&&b>110&&b<195)outside++;
            function scan(begin,on,list){
              if(on)return begin===-1?x:begin;
              if(begin!==-1&&x-begin>75){
                const w=(x-begin)/scale,last=list.find(v=>Math.abs(v.x-begin/scale)<1.5&&Math.abs(v.y-y/scale)<5);
                if(!last)list.push({x:begin/scale,y:y/scale,w});
              }
              return -1;
            }
            start=scan(start,blue,strips);orangeStart=scan(orangeStart,amber,orange);
          }
        }
        const reader=p.streamTextContent().getReader(),texts=[];
        try{for(;;){const {value,done}=await reader.read();if(done)break;for(const t of value.items)if(t.str)texts.push([t.str,Math.hypot(t.transform[0],t.transform[1])])}}
        finally{reader.releaseLock()}
        sheets.push({width:v.width/scale,height:v.height/scale,strips,orange,outside,texts,blueBounds,
          png:collect&&n===1?cv.toDataURL('image/png').split(',')[1]:null});
        cv.width=cv.height=1;p.cleanup();
      }}finally{await pdf.destroy()}
      return sheets;
    },{bytes:[...bytes],collect:Boolean(out)});
  }
  async function saveAndInspect(name){
    const downloading=page.waitForEvent('download');await click('pdfsave');
    const bytes=fs.readFileSync(await (await downloading).path());
    if(name==='workbook'&&hasVector){
      const {PDFDocument,PDFRawStream,PDFName,decodePDFRawStream}=require('pdf-lib'),doc=await PDFDocument.load(bytes);
      for(const [,object] of doc.context.enumerateIndirectObjects()){
        if(!(object instanceof PDFRawStream)||object.dict.get(PDFName.of('Subtype'))===PDFName.of('Image'))continue;
        const stream=Buffer.from(decodePDFRawStream(object).decode()).toString('latin1');
        for(const word of ['EXCLUDED-HEADER','EXCLUDED-FOOTER','Neighbor outside selection']){
          assert.ok(!stream.includes(word)&&!stream.toLowerCase().includes(Buffer.from(word).toString('hex')),'discarded neighboring content');
        }
      }
    }
    if(out)fs.writeFileSync(path.join(out,name+'.pdf'),bytes);
    const sheets=await inspect(bytes);
    if(out&&sheets[0].png)fs.writeFileSync(path.join(out,name+'.png'),Buffer.from(sheets[0].png,'base64'));
    return sheets;
  }
  const src=(await inspect(source))[0];
  if(out)fs.writeFileSync(path.join(out,'source.png'),Buffer.from(src.png,'base64'));
  await make('auto');
  assert.equal(await page.locator('#print-scale').inputValue(),'100');
  assert.equal(await page.locator('#print-status').textContent(),'7문항 · 1쪽');
  const printed=await saveAndInspect('workbook'),first=printed[0];await close();
  assert.equal(printed.length,1);assert.ok(Math.abs(first.width-595.276)<.01&&Math.abs(first.height-841.89)<.01);
  assert.equal(src.strips.length,8);assert.equal(first.strips.length,7);
  assert.ok(src.outside>150);assert.equal(first.outside,0);
  const ordered=first.strips.toSorted((a,b)=>(a.x>280)-(b.x>280)||a.y-b.y);
  for(const [i,strip] of ordered.entries()){
    assert.ok(Math.abs(strip.w-(65+2*i))<=1,'one-to-one physical width for Q'+(i+1)+' = '+strip.w);
    assert.ok(strip.x>=20&&strip.x<335&&strip.y>45&&strip.y<760);
  }
  assert.equal(ordered.filter(a=>a.x<280).length,4);assert.equal(ordered.filter(a=>a.x>280).length,3);
  const body=first.texts.map(t=>t[0]).join(' ');
  assert.doesNotMatch(body,/Q08|EXCLUDED/);
  if(hasVector){
    assert.match(body,/Q01/);assert.match(body,/Q07/);
    for(const t of first.texts.filter(t=>/Q0[1-7]/.test(t[0])))assert.ok(Math.abs(t[1]-10)<.1,'10 pt native text');
  }
  console.log('Rendered A4: source and output',src.strips.map(x=>x.w),ordered.map(x=>x.w),'pt; selected 7, left 4, right 3; vector checked:',hasVector);
  await click('edit-notebook');await page.locator('[data-pick="law#3"]').check();await page.locator('[data-pick="law#5"]').check();
  await make('one','bulk-print',['serial','sections']);const selected=await saveAndInspect('selected');
  assert.equal(selected.length,1);assert.equal(selected[0].strips.length,2);assert.ok(selected[0].strips.every(r=>r.x<60));
  assert.equal(await page.locator('#print-status').textContent(),'2문항 · 1쪽');await close();
  await click('bulk-print');assert.equal(await page.locator('#print-mode').inputValue(),'one');await close();
  await click('bulk-remove');assert.match(await page.locator('#modal section p').textContent(),/문항 2개의 오답 이력 2회/);
  await click('confirm-remove');await hasCount(5);await click('mistake-trash');await page.locator('[data-restore]').first().click();await hasCount(7);
  await detail('law#1');await page.getByText('오답 이력 2회',{exact:true}).click();
  await page.locator('[data-event="law-repeat#1"]').click();await click('confirm-remove');
  await page.waitForFunction(()=>document.querySelector('.notebook-counts')?.textContent.includes('반복 0문항'));
  await detail('law#1');await click('remove-all');await click('confirm-remove');await hasCount(6);
  await nav('자료실');await page.locator('[data-doc="law"]').click();await page.locator('[data-n="1"]').waitFor();
  assert.equal(await page.locator('[data-n="1"]').getAttribute('aria-pressed'),'false');
  await nav('오답노트');await tab('행정법');await click('mistake-trash');await page.locator('[data-restore]').first().click();
  await hasCount(8);await click('mistake-trash');await page.locator('[data-restore]').first().click();
  await page.waitForFunction(()=>document.querySelector('.notebook-counts')?.textContent.includes('반복 1문항'));
  await tab('국어');await make('two','print',['answers']);const shared=await saveAndInspect('reading');
  assert.equal(shared.length,2);assert.equal(shared.flatMap(p=>p.orange).length,1,'shared Korean bitmap once');
  await close();await tab('영어');await make('auto');const rotate=await saveAndInspect('rotated');await close();
  const [x1,y1,x2,y2]=rotate[0].blueBounds;
  const rotatedLength=120*Math.min(1,595.276/693.75,841.89/450);
  assert.ok(Math.abs(y2-y1-rotatedLength)<=4&&x2-x1<=10,'rotated crop follows the sheet fit and UserUnit 1.25');
  await tab('행정법');await summary('#filters');await page.locator('#f-year').selectOption('2025');await hasCount(7);
  await make('original');const original=await saveAndInspect('original');assert.equal(original.length,1);assert.ok(original[0].outside>100);await close();
  await click('edit-notebook');await page.locator('[data-pick="law#1"]').check();await page.locator('[data-pick="law#3"]').check();
  await make('individual','bulk-print');const singles=await saveAndInspect('individual');assert.equal(singles.length,2);
  assert.ok(singles.every(s=>s.strips.length===1));await close();
  // Filter-wide selection includes both exam years and deduplicates secondary links.
  await tab('행정법');await summary('#filters');await summary('.theme-options');
  await page.locator('[data-ft="case"]').check();await page.locator('[data-ft="example"]').check();await hasCount(8);
  await click('edit-notebook');await click('select-all');assert.equal(await page.locator('#selection-count').textContent(),'선택 8문항');
  await make('two','bulk-print');const yearly=await saveAndInspect('theme-years');
  assert.equal(await page.locator('#print-status').textContent(),'8문항 · 1쪽');
  if(hasVector)assert.match(yearly[0].texts.map(t=>t[0]).join(' '),/Different exam year/);
  await close();await click('bulk-master');await page.waitForFunction(()=>document.querySelector('.notebook-counts')?.textContent.includes('미숙지 0문항'));
  await click('bulk-theme');await page.locator('#bulk-target').selectOption('example');await click('bulk-apply');await hasCount(8);
  await detail('law#2');await click('unlink');await hasCount(7);
  await detail('law#1');await click('goto-original');await page.waitForFunction(()=>document.querySelector('.paper canvas')?.width>0);
  await page.locator('[data-n="8"]').click();await click('save');
  await page.waitForFunction(()=>document.querySelector('#notice')?.textContent.includes('오답을 저장'));
  await nav('오답노트');await tab('행정법');await hasCount(9);
  await detail('law#8');await click('remove-all');await click('confirm-remove');await hasCount(8);
  await nav('자료실');await page.locator('[data-edit="older"]').click();await page.locator('#sub').selectOption('영어');await click('apply');
  await nav('오답노트');await tab('영어');await hasCount(2);
  await nav('자료실');await page.locator('[data-edit="older"]').click();await page.locator('#sub').selectOption('행정법');await click('apply');
  await nav('오답노트');await tab('행정법');await hasCount(8);
  await click('print');await click('make-proof');await click('stop-print');
  await page.waitForFunction(()=>document.querySelector('#print-status')?.textContent.includes('취소'));await close();
  await nav('자료실');await page.locator('[data-doc="admin"]').click();
  await page.getByText('문항 영역 검수',{exact:true}).click();await summary('.shared-edit');await click('shared-drag');
  const paper=page.locator('.paper');await paper.evaluate(el=>el.scrollIntoView({block:'start'}));
  const [left,top]=await paper.evaluate(el=>{
    const rect=el.getBoundingClientRect(),sheet=el.closest('.sheet').getBoundingClientRect(),header=document.querySelector('aside').getBoundingClientRect();
    const x=Math.max(0,rect.left,sheet.left)+28,y=Math.max(0,rect.top,sheet.top,header.bottom)+42;
    if(!el.contains(document.elementFromPoint(x,y)))throw Error('Drawing surface is outside the visible viewport.');
    return [x,y];
  });
  await page.mouse.move(left,top);await page.mouse.down();await page.mouse.move(left+100,top+38,{steps:7});await page.mouse.up();
  await page.waitForFunction(()=>document.querySelector('#notice')?.textContent.includes('공통 지문을 연결'));
  const current=await readArchive();
  const common=current.questions.filter(q=>q.doc==='admin').map(q=>q.regions.find(r=>r.shared));
  assert.equal(common.length,2);assert.ok(common[0]);assert.deepEqual(common[0],common[1]);
  assert.deepEqual(current.questions.find(q=>q.id==='law#1').regions,archive.questions.find(q=>q.id==='law#1').regions);
  assert.deepEqual(current.events.filter(e=>e.q==='law#1').map(e=>e.id).sort(),['law-repeat#1','law-session#1']);
  assert.equal(current.questions.find(q=>q.id==='law#1').theme,'example');
  assert.equal(current.questions.find(q=>q.id==='older#1').theme,'example');
  const fileHashes=await page.evaluate(async()=>{
    const db=await new Promise(res=>{const r=indexedDB.open('yu-study-archive',1);r.onsuccess=()=>res(r.result)});
    const store=db.transaction('files').objectStore('files');
    const [keys,values]=await Promise.all([store.getAllKeys(),store.getAll()].map(r=>new Promise(res=>{r.onsuccess=()=>res(r.result)})));db.close();
    return Promise.all(values.map(async(v,i)=>[keys[i],Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await v.arrayBuffer())),b=>b.toString(16).padStart(2,'0')).join('')]));
  });
  assert.ok(fileHashes.every(([key,hash])=>key===hash));assert.deepEqual(errors,[]);
  console.log('PASS '+engine.name()+': legacy subject counts, live reader registration, theme hierarchy, filtered selection, source size, true rendered output, bitmap passage, table, figures, rotation, five modes, partial/bulk removal, recovery and intact source hashes.');
}finally{await context?.close();server.close();clearTimeout(deadline)}
