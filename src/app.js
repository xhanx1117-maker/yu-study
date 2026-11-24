import {subjects,themes,infer} from './model.js';
import {bindSearch,searchKey} from './search.js';
import {state,change} from './db.js';
import {pdfPicker,savePdf,importError} from './import-pdf.js';
import {$,esc,options,action,on,pick,notice,guard,modal} from './ui.js';
import {backup,restore} from './backup.js';
import {mountNotebook, resetNotebook} from './notebook.js';
import {changeDocumentSubject,notebookIndex,groupCounts,totals} from './notebook-model.js';
import {reader} from './reader.js';
const menus=['홈','자료실','오답노트','취약 영역','설정'],app=$('#app');
let section='홈',revision=0,cleanup,subject='',year='',exam='',query='',trash=false;
const nav=$('nav');nav.innerHTML=menus.map((m,i)=>'<button data-menu="'+i+'">'+m+'</button>').join('');
nav.onclick=guard(e=>{const b=e.target.closest('button');if(b)return show(menus[b.dataset.menu])});
const uid=()=>crypto.randomUUID(),allThemes=s=>themes({schemaVersion:1,books:s.books});
const header=(name,buttons='')=>'<div class="toolbar"><h1>'+name+'</h1><div class="row">'+buttons+'</div></div>';
function empty(msg){return '<p class="empty">'+msg+'</p>'}
async function show(name=section,id,number){section=name;app.ondrop=app.ondragover=null;const turn=++revision;cleanup?.();cleanup=null;nav.querySelectorAll('button').forEach((b,i)=>{if(menus[i]===name)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current')});app.innerHTML='<p>자료를 불러오는 중…</p>';const s=await state();if(turn!==revision)return;const docs=s.documents.filter(d=>!d.deleted);
 if(id){
   try{
     const end=await reader(id,()=>turn===revision,number);
     if(turn===revision)cleanup=end;else end?.();
   }catch(error){
     if(turn===revision){
       await show('자료실');
       modal('<h2>PDF를 열지 못했습니다</h2><p>'+esc(
         error.name==='PasswordException'
           ?'암호가 설정된 PDF입니다. 파일 앱에서 암호를 해제한 사본을 저장한 뒤 가져오세요.'
           :'파일 앱에서 원본 PDF가 열리는지 확인해 주세요. '+(error.message||'원본 읽기 실패')
       )+'</p>');
     }
   }
   return;
 }
 if(name==='홈'){
 const groups=groupCounts(notebookIndex(s).rows),unique=key=>groups.get(key)?.unique||0;
 app.innerHTML=header('학습 서재',pdfPicker())+'<p class="sub">자료는 현재 기기에 저장됩니다.</p>'+'<div class="grid">'+subjects.map((sub,i)=>'<button class="card" data-sub="'+i+'"><strong class="subjectmark">'+sub+'</strong><small>자료 '+docs.filter(d=>d.subject===sub).length+' · 오답 '+unique('subject:'+sub)+'</small></button>').join('')+'</div><h2>최근 열람한 PDF</h2>'+docList(docs.filter(d=>d.opened).sort((a,b)=>b.opened.localeCompare(a.opened)).slice(0,4))+'<h2>복습할 문제</h2><div class="row">'+action('unc','미분류 '+unique('kind:unassigned')+'문항')+action('rep','반복 오답 '+unique('kind:repeated')+'문항')+'</div><p class="sub">최근 백업 · '+esc(s.lastBackup?.slice(0,10)||'아직 없음')+'</p>';
 app.querySelectorAll('[data-sub]').forEach(b=>b.onclick=guard(()=>{subject=subjects[b.dataset.sub];year=exam=query='';trash=false;return show('자료실')}));on('unc',()=>{resetNotebook({kind:'unassigned'});return show('오답노트')});on('rep',()=>{resetNotebook({kind:'repeated'});return show('오답노트')});
 }else if(name==='자료실'){
 cleanup=mountLibrary(s,docs);
 }else if(name==='설정'){await settings(s,()=>turn===revision)}else if(name==='취약 영역'){
 const index=notebookIndex(s),counts=groupCounts(index.rows),all=totals(index.rows);
 const groups=[...index.catalog.map(t=>({id:t.id,title:t.title,count:counts.get('theme:'+t.id)})),{id:'',title:'미분류',count:counts.get('kind:unassigned')}]
   .filter(row=>row.count).sort((a,b)=>b.count.events-a.count.events);
 app.innerHTML=header('취약 영역')+'<p>고유 오답 '+all.unique+'문항 · 누적 오답 '+all.events+'회 · 반복 오답 '+all.repeated+'문항</p><h2>테마별 오답 빈도</h2>'+
   (groups.map(({id,title,count})=>'<button data-theme="'+esc(id)+'" class="item">'+esc(title)+' · '+count.unique+'문항 / '+count.events+'회 · 미숙지 '+count.learning+'문항</button>').join('')||empty('오답을 기록하면 테마별 빈도가 표시됩니다.'));
 app.querySelectorAll('[data-theme]').forEach(b=>b.onclick=guard(()=>{resetNotebook(b.dataset.theme?{themeIds:[b.dataset.theme]}:{kind:'unassigned'});return show('오답노트')}));
 }else{
   app.ondrop=app.ondragover=null;
   cleanup=mountNotebook(app,s,{refresh:()=>show('오답노트'),openOriginal:(doc,n)=>show('자료실',doc,n)});
   return;
 }
 if(turn!==revision)return;
 on('pdf-files',e=>imports([...e.target.files]),'change');
 if(name==='홈')app.querySelectorAll('[data-doc]').forEach(b=>b.onclick=guard(()=>show('자료실',b.dataset.doc)));
 if(name!=='자료실'){app.ondragover=null;app.ondrop=null}
}
function mountLibrary(s,docs){
 app.innerHTML=header('자료실',action('trash',trash?'자료실 보기':'휴지통')+pdfPicker())+'<div class="row filters"><label>과목<select id="subject">'+options(['전체 과목',...subjects,'미분류'],subject)+'</select></label><label>연도<select id="year">'+options(['전체 연도',...new Set(docs.map(d=>d.year).filter(Boolean).sort().reverse())],year)+'</select></label><label>시험<select id="exam">'+options(['전체 시험',...s.examTypes],exam)+'</select></label><label>제목·태그 검색<input id="query" type="search" value="'+esc(query)+'"></label></div>'+'<div id="library-results"></div>';
 const results=$('#library-results'),byId=new Map(s.documents.map(d=>[d.id,d]));
 const rows=s.documents.map(doc=>({doc,text:searchKey([doc.title,doc.tags].join(' ')),card:null}))
   .sort((a,b)=>Number(!!b.doc.favorite)-Number(!!a.doc.favorite)||String(b.doc.year??'').localeCompare(String(a.doc.year??'')));
 let previous;
 function draw(){
   const needle=searchKey(query).trim();
   const next=rows.filter(({doc:d,text})=>!!d.deleted===trash&&(!subject||d.subject===subject)&&
     (!year||String(d.year)===year)&&(!exam||d.exam===exam)&&text.includes(needle));
   if(previous?.length===next.length&&next.every((row,i)=>row===previous[i]))return;
   previous=next;
   if(!next.length){results.innerHTML=docList([]);return}
   // Create a document card once per archive snapshot. Searching only changes membership.
   const fresh=next.filter(row=>!row.card);
   if(fresh.length){
     const template=document.createElement('template');template.innerHTML=docList(fresh.map(r=>r.doc),true);
     Array.from(template.content.children).forEach((card,i)=>{fresh[i].card=card});
   }
   const fragment=document.createDocumentFragment();
   for(const row of next)fragment.append(row.card);
   results.replaceChildren(fragment);
 }
 const search=bindSearch($('#query'),value=>{query=value;draw()});
 on('subject',e=>{subject=e.target.selectedIndex?e.target.value:'';draw()},'change');
 on('year',e=>{year=e.target.selectedIndex?e.target.value:'';draw()},'change');
 on('exam',e=>{exam=e.target.selectedIndex?e.target.value:'';draw()},'change');
 on('trash',()=>{trash=!trash;$('#trash').textContent=trash?'자료실 보기':'휴지통';draw()});
 results.onclick=guard(e=>{
   const button=e.target.closest('[data-doc],[data-edit]');if(!button)return;
   if(button.dataset.doc)return show('자료실',button.dataset.doc);
   editDoc(s,byId.get(button.dataset.edit));
 });
 app.ondragover=e=>e.preventDefault();app.ondrop=guard(async e=>{e.preventDefault();await imports([...e.dataTransfer.files])});
 draw();
 return ()=>search.dispose();
}
function docList(docs,edit=false){return docs.length?docs.map(d=>'<article class="item toolbar"><div><strong>'+esc(d.title)+'</strong><div class="sub">'+esc([d.subject,d.year,d.exam,d.type].filter(Boolean).join(' · '))+'</div></div><div class="row"><button data-doc="'+esc(d.id)+'">열기</button>'+(edit?'<button data-edit="'+esc(d.id)+'">자료 관리</button>':'')+'</div></article>').join(''):empty('표시할 자료가 없습니다. PDF 가져오기에서 시험지를 등록하세요.')}
function fields(d,s){return '<label>제목<input id="title" value="'+esc(d.title)+'"></label><div class="row"><label>과목<select id="sub">'+options(['미분류',...subjects],d.subject)+'</select></label><label>연도<input id="yr" value="'+esc(d.year)+'" size="5"></label><label>시험 종류<input id="et" list="ets" value="'+esc(d.exam)+'"><datalist id="ets">'+options(s.examTypes)+'</datalist></label></div><label>유형<select id="type">'+options(['기출문제지','정답지','해설지','모의고사','기본서','요약서','개인 정리자료','기타'],d.type)+'</select></label><label>문항 수 (1~300)<input id="num" type="number" min="1" max="300" value="'+d.count+'"></label><label>태그<input id="tags" value="'+esc(d.tags)+'"></label>'}
function values(){const count=+$('#num').value,title=$('#title').value.trim();if(!title||!Number.isInteger(count)||count<1||count>300)throw Error('제목과 문항 수를 확인하세요.');return {title,count,year:$('#yr').value.trim(),exam:$('#et').value.trim(),subject:$('#sub').value,type:$('#type').value,tags:$('#tags').value.trim()}}
async function imports(files){
  if(!files.length||$('#modal').open)return;
  const dialog=$('#modal'),picker=$('#pdf-files');
  let index=0,saved=0,busy=false,controller;
  function preventBusyClose(e){if(busy)e.preventDefault()}
  dialog.addEventListener('cancel',preventBusyClose);
  dialog.addEventListener('close',()=>{
    dialog.removeEventListener('cancel',preventBusyClose);
    if(picker)picker.value='';
    if(saved)guard(async()=>{
      // An earlier subject/year/trash filter must not hide newly imported files.
      subject=year=exam=query='';
      trash=false;
      await show('자료실');
      notice(saved+'개 PDF를 이 기기에 저장했습니다.');
    })();
  },{once:true});

  async function next(){
    if(index>=files.length){dialog.close();return}
    const file=files[index++];
    modal('<h2>PDF 가져오기 · '+index+' / '+files.length+'</h2><p>자료 정보를 불러오는 중…</p>');
    const archive=await state();
    if(!dialog.open)return;
    const defaults={title:file.name.replace(/\.pdf$/i,''),...infer(file.name),count:20};
    modal('<h2>PDF 가져오기 · '+index+' / '+files.length+'</h2>'+
      '<p class="sub">'+esc(file.name)+' · '+(file.size/1048576).toFixed(1)+' MB</p>'+
      fields(defaults,archive)+
      '<p id="import-progress" role="status" aria-live="polite">과목과 문항 수를 확인한 뒤 등록하세요. 선택한 PDF는 이 기기에 저장됩니다.</p>'+
      '<progress id="import-meter" max="100" hidden></progress>'+
      '<p id="import-error" class="import-error" role="alert" hidden></p>'+
      '<div class="row">'+action('add','등록','primary')+
      action('skip','건너뛰기')+action('read-cancel','읽기 취소')+'</div>');
    $('#read-cancel').hidden=true;
    on('skip',next);
    on('read-cancel',()=>controller?.abort());
    on('add',async()=>{
      if(busy)return;
      const error=$('#import-error'),message=$('#import-progress'),meter=$('#import-meter');
      error.hidden=true;
      let metadata;
      try{metadata=values()}catch(e){error.textContent=e.message;error.hidden=false;return}
      busy=true;
      controller=new AbortController();
      const add=$('#add'),skip=$('#skip'),cancel=$('#read-cancel'),close=$('form button',dialog);
      const inputs=[...dialog.querySelectorAll('section input,section select')];
      add.disabled=skip.disabled=close.disabled=true;
      inputs.forEach(input=>input.disabled=true);
      cancel.hidden=false;
      let complete=false;
      try{
        await savePdf(file,metadata,{
          signal:controller.signal,
          onProgress(label,percent){
            message.textContent=label+(percent==null?'…':' · '+percent+'%');
            meter.hidden=false;
            if(percent==null)meter.removeAttribute('value');else meter.value=percent;
            if(label==='기기에 저장 중')cancel.disabled=true;
          }
        });
        saved++;
        complete=true;
      }catch(e){
        error.textContent=importError(e);
        error.hidden=false;
        message.textContent='파일을 다시 선택하려면 닫기를 누른 뒤 PDF 가져오기를 누르세요.';
        add.textContent='다시 시도';
      }finally{
        busy=false;
        add.disabled=skip.disabled=close.disabled=false;
        inputs.forEach(input=>input.disabled=false);
        cancel.hidden=true;
        cancel.disabled=false;
        meter.hidden=true;
      }
      if(complete)await next();
    });
  }
  await next();
}
function editDoc(s,d){modal('<h2>자료 관리</h2>'+fields(d,s)+action('apply','변경 저장','primary')+action('fav',d.favorite?'즐겨찾기 해제':'즐겨찾기 추가')+action('remove',d.deleted?'복구':'휴지통으로 이동'));async function modify(fn){await change(v=>fn(v.documents.find(x=>x.id===d.id),v));$('#modal').close();await show()}
 on('apply',()=>{const a=values();return modify((x,v)=>{if(v.questions.some(q=>q.doc===x.id&&q.number>a.count))throw Error('기록된 문항 번호보다 문항 수를 줄일 수 없습니다.');changeDocumentSubject(v,x,a.subject);Object.assign(x,a);if(a.exam&&!v.examTypes.includes(a.exam))v.examTypes.push(a.exam)})});on('fav',()=>modify(x=>{x.favorite=!x.favorite}));on('remove',()=>modify(x=>{x.deleted=!x.deleted}))}
async function settings(s,active){const ts=allThemes(s),space=await navigator.storage?.estimate?.();if(!active())return;app.innerHTML=header('설정')+'<p class="sub">기기 저장 · v0.3.1</p>'+'<h2>교재 및 테마</h2><div class="row">'+action('seed','목차 JSON 가져오기')+action('custom','테마 추가')+'</div>'+s.books.map(b=>'<details class="box"><summary>'+esc(b.subject+' · '+b.title)+'</summary>'+ts.filter(t=>t.book===b.id).map(t=>'<p>'+esc(t.path+' / '+(t.number||'')+' '+t.title+(t.page?' · p.'+t.page:''))+'</p>').join('')+'</details>').join('')+'<h2>전체 백업 및 복원</h2><p>최근 백업 · '+esc(s.lastBackup?.slice(0,10)||'아직 없음')+'</p><p class="sub">사이트 데이터 삭제나 저장 공간 정리에 대비해 PDF가 포함된 ZIP을 파일 앱에 보관하세요.</p><div class="row">'+action('backup','전체 백업 저장','primary')+action('restore','백업 복원')+action('persist','영속 저장 요청')+'</div><p>사용 중인 공간 · '+(space?Math.round(space.usage/1048576)+' MB':'확인 불가')+'</p>';
 on('seed',async()=>{const [f]=await pick('.json');if(!f)return;const seed=JSON.parse(await f.text());themes(seed);await change(v=>{const books=[...v.books];for(const b of seed.books){const i=books.findIndex(x=>x.id===b.id);if(i<0)books.push(b);else books[i]=b}const rows=themes({schemaVersion:1,books});for(const q of v.questions)if([q.theme,...q.secondary].filter(Boolean).some(id=>!rows.some(t=>t.id===id&&t.enabled&&t.subject===v.documents.find(d=>d.id===q.doc)?.subject)))throw Error('기존 오답 테마 연결을 유지해야 합니다.');v.books=books});await show();notice('목차를 가져왔습니다.')});
 on('custom',()=>{modal('<h2>개인 테마 추가</h2><label>과목<select id="cs">'+options(subjects)+'</select></label><label>테마명<input id="ct"></label>'+action('csave','추가'));on('csave',async()=>{const title=$('#ct').value.trim(),sub=$('#cs').value;if(!title)return;await change(v=>{let b=v.books.find(x=>x.id==='custom-'+sub);if(!b){b={id:'custom-'+sub,title:'개인 목차',subject:sub,themes:[]};v.books.push(b)}b.themes.push({id:uid(),title,number:String(b.themes.length+1)})});$('#modal').close();await show()})});
 on('backup',async()=>{await backup();await show();notice('백업 ZIP을 생성했습니다.')});on('restore',async()=>{const [f]=await pick('.zip');if(f&&await restore(f)){await show();notice('복원했습니다.')}});on('persist',async()=>notice(await navigator.storage?.persist?.()?'영속 저장이 허용되었습니다.':'이 환경에서 영속 저장이 허용되지 않았습니다.'))}
guard(()=>show())();if('serviceWorker' in navigator)navigator.serviceWorker.register(new URL('sw.js',document.baseURI),{scope:'./'}).catch(e=>notice('오프라인 준비 실패 · '+e.message));
