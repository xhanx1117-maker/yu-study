import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {testServer} from './test-server.mjs';
import {fixturePaper} from './bulk-fixture.mjs';
import {initial,record} from '../src/model.js';
const require=createRequire(import.meta.url),{webkit,chromium}=require('playwright');
const tablet=process.env.YU_TEST_ENGINE==='webkit',server=testServer({sourceModules:true});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port,url=origin+'/yu-study/';
const engine=await (tablet?webkit:chromium).launch({headless:true,...(tablet?{}:{executablePath:process.env.YU_BROWSER})});
try{
  const browser=await engine.newContext({viewport:{width:834,height:1194},isMobile:tablet,hasTouch:true,acceptDownloads:true});
  const p=await browser.newPage();p.setDefaultTimeout(15000);
  const errors=[];p.on('pageerror',e=>errors.push(e.message));
  const template=await fixturePaper(6),s=initial(),files=[],claims=[],hash=bytes=>createHash('sha256').update(bytes).digest('hex');
  function add(id,title,type,extra={}){
    const bytes=Buffer.concat([template,Buffer.from('\n%'+id)]),digest=hash(bytes);
    const d={id,title,type,filename:title+'.pdf',size:bytes.length,hash:digest,session:'s-'+id,subject:'행정법',exam:'국가직 9급',year:'2025',form:'가',count:20,...extra};
    files.push([digest,[...bytes]]);s.documents.push(d);s.sessions.push({id:d.session,doc:id,date:'2025-01-01'});return d;
  }
  const paper=add('p','가상 본시험','문제지'),exam2=add('q','가상 행정학 시험','문제지',{subject:'행정학'});
  const answer=add('a','가상 통합 정답표','정답지',{form:'',date:'2025-01-01',reviewReasons:['manifest exam 불일치']});
  const sol=add('s','가상 강사 해설','해설지',{form:'',date:'2025-01-01'});
  const cross=add('wrong-form','나형 대조 후보','정답지',{form:'나'});
  const text=['1. 이 문서는 인쇄된 원문의 다양한 판본을 대조하기 위한 첫 번째 가상 문항이다.',
    '2. 또 다른 행정기관의 정보를 구별하는 두 번째 가상의 사례를 고려해 보자.',
    '3. 동일한 질문이 서로 다른 위치에서 시작하는 세 번째 문항을 검토한다.'];
  for(let i=0;i<2;i++)add('v'+i,'가상 제76기 '+(i?'순수문제지':'행정학발췌'),'기출문제지',{subject:'행정학',exam:'경찰',year:'2027',detected:Object.fromEntries(text.map((v,n)=>[n+1,{text:v}]))});
  for(let i=0;i<18;i++)add('f'+i,'가상 보관 자료 '+i,'정답지',{subject:'영어',year:String(2000+i)});
  add('retired','휴지통 자료','해설지',{deleted:true});
  const missing=add('missing','원본 확인 자료','정답지',{subject:'국어'});files.pop();
  record(s,paper,paper.session,[2]);s.questions[0].memo='기존 메모';s.questions[0].regions=[{page:1,x:.1,y:.2,w:.4,h:.3}];
  const refs=structuredClone({questions:s.questions,events:s.events,sessions:s.sessions,books:s.books});
  function claim(doc,target,role,ok,booklet){
    claims.push({sha256:doc.hash,role,subject:target.subject,exam:'국가직9급',year:'2025',booklet,auto_link_allowed:ok,
      linked_targets:[{question_ref:{sha256:target.hash},booklet:target.form,auto_link_allowed:ok,validation:ok?'가상 원문 일치':'문항 순서 대조 필요'}]});
  }
  claim(answer,paper,'최종정답',true,null);claim(answer,exam2,'최종정답',true,null);
  claim(sol,paper,'비공식해설',false,null);claim(sol,exam2,'비공식해설',false,null);
  claim(cross,paper,'가답안',true,'나');
  await p.goto(origin+'/seed.html');
  await p.evaluate(async({s,files})=>{
    const db=await import('/proof-src/db.js');await db.change(()=>s,files.map(([h,b])=>[h,new Blob([new Uint8Array(b)],{type:'application/pdf'})]));
  },{s,files});
  await p.goto(url);await p.locator('nav').getByRole('button',{name:'자료실',exact:true}).click();
  await p.locator('.library-filters summary').click();await p.locator('#link-coverage').click();await p.locator('#audit-review').waitFor();
  const repair=Buffer.from(JSON.stringify({format:'yu-study-link-repair',version:1,files:claims}));
  p.on('dialog',dialog=>dialog.accept());
  await p.locator('#audit-repair').setInputFiles({name:'연결복구.json',mimeType:'application/json',buffer:repair});
  await p.waitForFunction(()=>document.querySelector('#audit-note')?.textContent.includes('기기와 일치 3개'));
  async function report(){
    const waiting=p.waitForEvent('download');await p.locator('#missing-json').click();
    const download=await waiting;return JSON.parse(await readFile(await download.path(),'utf8'));
  }
  let result=await report();assert.equal(result.집계.정답지.연결완료,2);assert.equal(result.집계.해설지.후보검토,2);
  const split=result.시험지별.find(r=>r.문제지ID==='p');assert.equal(split.필요자료,'');assert.ok(split.정답지.후보.some(c=>c.id===cross.id&&!c.선택가능));
  await p.locator('#audit-review summary').click();
  for(const title of [paper.title,exam2.title]){
    const article=p.locator('#audit-review article').filter({has:p.getByText(title,{exact:true})});
    await article.locator('label').filter({hasText:sol.title}).locator('input').check();
  }
  await p.locator('#audit-apply').click();await p.waitForFunction(()=>document.querySelector('#audit-note')?.textContent.includes('2개 연결'));
  result=await report();assert.equal(result.집계.해설지.연결완료,2);
  await p.locator('#modal form button').click();const card=p.locator('[data-card="p"]');
  await card.locator('[data-open-material="s"]').waitFor();await card.locator('[data-open-material="a"]').waitFor();
  // Deterministic suspension at an unfinished transaction boundary; resume via installed UI after a reload.
  const checkpoint=await p.evaluate(async()=>{
    const {runAudit,auditJob}=await import('/proof-src/link-audit-job.js'),c=new AbortController();
    const done=await runAudit(c,n=>{if(n===5)c.abort()});return [done,(await auditJob()).cursor];
  });
  assert.deepEqual(checkpoint,[false,5]);await p.reload();
  await p.locator('nav').getByRole('button',{name:'자료실',exact:true}).click();
  if(!await p.locator('#link-coverage').isVisible())await p.locator('.library-filters summary').click();
  await p.locator('#link-coverage').click();await p.getByRole('button',{name:/점검 재개/}).click();
  await p.waitForFunction(()=>document.querySelector('#audit-note')?.textContent.includes('기존 자료 점검을 마쳤습니다.'));
  result=await report();assert.equal(result.집계.중복후보쌍,1);assert.equal(result.집계.정답지.원본누락,1);
  const actual=await p.evaluate(async()=>{
    const db=await import('/proof-src/db.js'),a=await db.state();
    return {refs:{questions:a.questions,events:a.events,sessions:a.sessions,books:a.books},ids:a.documents.map(d=>d.id),retired:a.documents.find(d=>d.id==='retired').deleted,
      bytes:await db.transaction(['files'],'readonly',({files},read,end)=>read(files.getAllKeys(),end)),last:await db.get('meta','link-audit:last')};
  });
  assert.deepEqual(actual.refs,refs);assert.deepEqual(actual.ids,s.documents.map(d=>d.id));assert.deepEqual(new Set(actual.bytes),new Set(files.map(([k])=>k)));assert.equal(actual.retired,true);
  assert.equal(actual.last.issues,1);assert.equal(actual.last.read,0);assert.ok(actual.last.reused>=s.documents.length-2);
  assert.ok(result.분류검토.some(d=>d.id===missing.id));
  await p.locator('#audit-run').click();await p.locator('#audit-note').filter({hasText:'마쳤습니다'}).waitFor();
  const repeat=await p.evaluate(async()=>(await import('/proof-src/link-audit-job.js')).lastAudit());assert.equal(repeat.total,1);
  assert.deepEqual(errors,[]);console.log((tablet?'WebKit touch':'Chromium')+' · hash repair, both subjects, manual batch, mismatch, orphan export, resumed/cached audit and unchanged source keys + study records passed.');
}finally{await engine.close();server.close()}
