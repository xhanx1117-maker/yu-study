import {initial,subjects,stats,themes,infer,classify} from './model.js';
import {get,state,change} from './db.js';
import {pdfPicker,savePdf,importError} from './import-pdf.js';
import {$,esc,options,action,on,pick,notice,guard,modal} from './ui.js';
import {download,backup,restore} from './backup.js';
import {notebookPdf} from './export.js';
import {reader} from './reader.js';
import {openPdf,paint} from './pdf.js';
const menus=['홈','자료실','오답노트','취약 영역','설정'],app=$('#app');
let section='홈',revision=0,cleanup,subject='',year='',exam='',query='',trash=false,theme='',filter='',undo=[];
const nav=$('nav');nav.innerHTML=menus.map((m,i)=>'<button data-menu="'+i+'">'+m+'</button>').join('');
nav.onclick=guard(e=>{const b=e.target.closest('button');if(b)return show(menus[b.dataset.menu])});
const stamp=()=>new Date().toISOString(),uid=()=>crypto.randomUUID(),allThemes=s=>themes({schemaVersion:1,books:s.books});
const header=(name,buttons='')=>'<div class="toolbar"><h1>'+name+'</h1><div class="row">'+buttons+'</div></div>';
function themePicker(ts,current){return '<option value="">미분류</option>'+ts.filter(t=>t.enabled).map(t=>'<option value="'+esc(t.id)+'" '+(t.id===current?'selected':'')+'>'+esc(t.path+' · '+(t.number||'')+' '+t.title+(t.page?' · p.'+t.page:''))+'</option>').join('')}
function empty(msg){return '<p class="empty">'+msg+'</p>'}
async function show(name=section,id){section=name;const turn=++revision;cleanup?.();cleanup=null;nav.querySelectorAll('button').forEach((b,i)=>{if(menus[i]===name)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current')});app.innerHTML='<p>자료를 불러오는 중…</p>';const s=await state();if(turn!==revision)return;const count=stats(s),qs=s.questions.filter(q=>count.has(q.id)),docs=s.documents.filter(d=>!d.deleted);
 if(id){
   try{
     const end=await reader(id,()=>turn===revision);
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
 app.innerHTML=header('학습 서재',pdfPicker())+'<p class="sub">자료는 현재 기기에 저장됩니다.</p>'+'<div class="grid">'+subjects.map((sub,i)=>'<button class="card" data-sub="'+i+'"><strong class="subjectmark">'+sub+'</strong><small>자료 '+docs.filter(d=>d.subject===sub).length+' · 오답 '+qs.filter(q=>s.documents.find(d=>d.id===q.doc)?.subject===sub).length+'</small></button>').join('')+'</div><h2>최근 열람한 PDF</h2>'+docList(docs.filter(d=>d.opened).sort((a,b)=>b.opened.localeCompare(a.opened)).slice(0,4))+'<h2>복습할 문제</h2><div class="row">'+action('unc','미분류 '+qs.filter(q=>!q.theme).length+'문항')+action('rep','반복 오답 '+qs.filter(q=>count.get(q.id)>1).length+'문항')+'</div><p class="sub">최근 백업 · '+esc(s.lastBackup?.slice(0,10)||'아직 없음')+'</p>';
 app.querySelectorAll('[data-sub]').forEach(b=>b.onclick=guard(()=>{subject=subjects[b.dataset.sub];year=exam=query='';trash=false;return show('자료실')}));on('unc',()=>{filter='미분류';theme='';return show('오답노트')});on('rep',()=>{filter='반복';theme='';return show('오답노트')});
 }else if(name==='자료실'){
 const filtered=s.documents.filter(d=>!!d.deleted===trash&&(!subject||d.subject===subject)&&(!year||d.year===year)&&(!exam||d.exam===exam)&&(!query||[d.title,d.tags].join(' ').includes(query)));
 app.innerHTML=header('자료실',action('trash',trash?'자료실 보기':'휴지통')+pdfPicker())+'<div class="row filters"><label>과목<select id="subject">'+options(['전체 과목',...subjects,'미분류'],subject)+'</select></label><label>연도<select id="year">'+options(['전체 연도',...new Set(docs.map(d=>d.year).filter(Boolean).sort().reverse())],year)+'</select></label><label>시험<select id="exam">'+options(['전체 시험',...s.examTypes],exam)+'</select></label><label>제목·태그 검색<input id="query" type="search" value="'+esc(query)+'"></label></div>'+docList(filtered.sort((a,b)=>Number(b.favorite)-Number(a.favorite)||b.year.localeCompare(a.year)),true);
 on('subject',e=>{subject=e.target.selectedIndex?e.target.value:'';return show()},'change');on('year',e=>{year=e.target.selectedIndex?e.target.value:'';return show()},'change');on('exam',e=>{exam=e.target.selectedIndex?e.target.value:'';return show()},'change');on('query',e=>{query=e.target.value;return show()},'change');on('trash',()=>{trash=!trash;return show()});
 app.querySelectorAll('[data-edit]').forEach(b=>b.onclick=guard(()=>editDoc(s,s.documents.find(d=>d.id===b.dataset.edit))));app.ondragover=e=>e.preventDefault();app.ondrop=guard(async e=>{e.preventDefault();await imports([...e.dataTransfer.files])});
 }else if(name==='설정'){await settings(s)}else if(name==='취약 영역'){const ts=allThemes(s),rows=[...new Set(qs.map(q=>q.theme))].map(id=>{const list=qs.filter(q=>q.theme===id);return {id,list,total:list.reduce((a,q)=>a+count.get(q.id),0)}}).sort((a,b)=>b.total-a.total);
 app.innerHTML=header('취약 영역')+'<p>고유 오답 '+qs.length+'문항 · 누적 오답 '+s.events.length+'회 · 반복 오답 '+qs.filter(q=>count.get(q.id)>1).length+'문항</p><h2>테마별 오답 빈도</h2>'+ (rows.map(r=>'<button data-theme="'+esc(r.id||'')+'" class="item">'+esc(ts.find(t=>t.id===r.id)?.title||'미분류')+' · '+r.list.length+'문항 / '+r.total+'회 · 미숙지 '+r.list.filter(q=>q.status!=='숙지 완료').length+'</button>').join('')||empty('오답을 기록하면 테마별 빈도가 표시됩니다.'));
 app.querySelectorAll('[data-theme]').forEach(b=>b.onclick=guard(()=>{theme=b.dataset.theme;filter=theme?'':'미분류';return show('오답노트')}));
 }else await notebook(s,qs,count,turn);
 on('pdf-files',e=>imports([...e.target.files]),'change');
 app.querySelectorAll('[data-doc]').forEach(b=>b.onclick=guard(()=>show('자료실',b.dataset.doc)));
 if(name!=='자료실'){app.ondragover=null;app.ondrop=null}
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
 on('apply',()=>{const a=values();return modify((x,v)=>{if(v.questions.some(q=>q.doc===x.id&&(q.number>a.count||((q.theme||q.secondary.length)&&x.subject!==a.subject))))throw Error('연결된 오답의 번호와 과목을 유지하세요.');Object.assign(x,a);if(a.exam&&!v.examTypes.includes(a.exam))v.examTypes.push(a.exam)})});on('fav',()=>modify(x=>{x.favorite=!x.favorite}));on('remove',()=>modify(x=>{x.deleted=!x.deleted}))}
async function settings(s){const ts=allThemes(s),space=await navigator.storage?.estimate?.();app.innerHTML=header('설정')+'<p class="sub">기기 저장 · v0.2.0</p>'+'<h2>교재 및 테마</h2><div class="row">'+action('seed','목차 JSON 가져오기')+action('custom','테마 추가')+'</div>'+s.books.map(b=>'<details class="box"><summary>'+esc(b.subject+' · '+b.title)+'</summary>'+ts.filter(t=>t.book===b.id).map(t=>'<p>'+esc(t.path+' / '+(t.number||'')+' '+t.title+(t.page?' · p.'+t.page:''))+'</p>').join('')+'</details>').join('')+'<h2>전체 백업 및 복원</h2><p>최근 백업 · '+esc(s.lastBackup?.slice(0,10)||'아직 없음')+'</p><p class="sub">사이트 데이터 삭제나 저장 공간 정리에 대비해 PDF가 포함된 ZIP을 파일 앱에 보관하세요.</p><div class="row">'+action('backup','전체 백업 저장','primary')+action('restore','백업 복원')+action('persist','영속 저장 요청')+'</div><p>사용 중인 공간 · '+(space?Math.round(space.usage/1048576)+' MB':'확인 불가')+'</p>';
 on('seed',async()=>{const [f]=await pick('.json');if(!f)return;const seed=JSON.parse(await f.text());themes(seed);await change(v=>{const books=[...v.books];for(const b of seed.books){const i=books.findIndex(x=>x.id===b.id);if(i<0)books.push(b);else books[i]=b}const rows=themes({schemaVersion:1,books});for(const q of v.questions)if([q.theme,...q.secondary].filter(Boolean).some(id=>!rows.some(t=>t.id===id&&t.enabled&&t.subject===v.documents.find(d=>d.id===q.doc)?.subject)))throw Error('기존 오답 테마 연결을 유지해야 합니다.');v.books=books});await show();notice('목차를 가져왔습니다.')});
 on('custom',()=>{modal('<h2>개인 테마 추가</h2><label>과목<select id="cs">'+options(subjects)+'</select></label><label>테마명<input id="ct"></label>'+action('csave','추가'));on('csave',async()=>{const title=$('#ct').value.trim(),sub=$('#cs').value;if(!title)return;await change(v=>{let b=v.books.find(x=>x.id==='custom-'+sub);if(!b){b={id:'custom-'+sub,title:'개인 목차',subject:sub,themes:[]};v.books.push(b)}b.themes.push({id:uid(),title,number:String(b.themes.length+1)})});$('#modal').close();await show()})});
 on('backup',async()=>{await backup();await show();notice('백업 ZIP을 생성했습니다.')});on('restore',async()=>{const [f]=await pick('.zip');if(f&&await restore(f)){await show();notice('복원했습니다.')}});on('persist',async()=>notice(await navigator.storage?.persist?.()?'영속 저장이 허용되었습니다.':'이 환경에서 영속 저장이 허용되지 않았습니다.'))}
async function notebook(s,qs,count,turn){const ts=allThemes(s),list=qs.filter(q=>(!theme||q.theme===theme||q.secondary.includes(theme))&&(!filter||filter==='전체'||filter==='미분류'&&!q.theme||filter==='반복'&&count.get(q.id)>1||filter==='미숙지'&&q.status!=='숙지 완료')).sort((a,b)=>count.get(b.id)-count.get(a.id)||a.number-b.number);
 app.innerHTML='<div class="noprint">'+header('오답노트',action('print','A4 PDF 출력','primary'))+'<div class="row"><label>분류<select id="filter">'+options(['전체','미분류','반복','미숙지'],filter)+'</select></label><label>교재 테마<select id="theme"><option value="">전체 테마</option>'+themePicker(ts,theme).split('</option>').slice(1).join('</option>')+'</select></label></div><details><summary>분석 및 일괄 분류</summary><div class="row">'+action('export','분석 자료 내보내기')+action('prompt','GPT 분류 요청')+action('result','분류 결과 가져오기')+(undo.length?action('revert','분류 실행 취소'):'')+'</div></details></div><h2 class="printhead">Yu: study · '+esc(ts.find(t=>t.id===theme)?.title||'누적 오답노트')+'</h2><p>'+list.length+'문항</p>'+ (list.map(q=>{const d=s.documents.find(x=>x.id===q.doc),t=ts.find(x=>x.id===q.theme);return '<article class="item" data-q="'+esc(q.id)+'"><div class="toolbar"><strong>'+esc(d.title)+' · '+q.number+'번</strong><button class="noprint" data-doc="'+esc(d.id)+'">원본 열기</button></div><p class="sub">'+esc([d.subject,d.year,d.exam,t?.title||'미분류',t?.page?'p.'+t.page:'',count.get(q.id)+'회',q.status].filter(Boolean).join(' · '))+'</p><div class="crops">'+(q.regions.length?'':'영역 미지정 · 원본에서 영역을 지정하세요.')+'</div><button class="noprint" data-detail="'+esc(q.id)+'">분류 및 복습</button></article>'}).join('')||empty('조건에 맞는 오답이 없습니다.'));
 on('filter',e=>{filter=e.target.value;return show()},'change');on('theme',e=>{theme=e.target.value;return show()},'change');
 const rendering=new WeakMap();async function render(el){if(rendering.has(el))return rendering.get(el);const work=(async()=>{const q=list.find(x=>x.id===el.dataset.q);if(!q.regions.length||turn!==revision)return;const d=s.documents.find(x=>x.id===q.doc),pdf=await openPdf(await get('files',d.hash));try{for(const r of q.regions){if(turn!==revision)return;const c=document.createElement('canvas');await paint(pdf,r.page,c,1600,r);el.querySelector('.crops').append(c)}}finally{await pdf.destroy()}})();rendering.set(el,work);return work}
 let queue=Promise.resolve();const elements=[...app.querySelectorAll('[data-q]')],obs=new IntersectionObserver(entries=>{for(const e of entries)if(e.isIntersecting){obs.unobserve(e.target);queue=queue.then(()=>render(e.target)).catch(err=>notice(err.message))}});elements.forEach(el=>obs.observe(el));cleanup=()=>obs.disconnect();
 on('print',async()=>{if(!list.length)return notice('출력할 문항이 없습니다.');if(list.some(q=>!q.regions.length)&&!confirm('영역 미지정 문항은 출처만 출력됩니다. 계속할까요?'))return;const btn=$('#print');btn.disabled=true;
 try{
   const file=await notebookPdf(s,list,'누적 오답노트 · '+(ts.find(t=>t.id===theme)?.title||'전체 테마'),(i,n)=>{btn.textContent='생성 중 '+i+' / '+n});
   const url=URL.createObjectURL(file);
   modal('<h2>A4 PDF</h2><a id="pdfpreview" class="btn" target="_blank" rel="noopener">PDF 미리보기</a>'+action('pdfsave','파일 저장','primary')+action('pdfshare','공유'));
   $('#pdfpreview').href=url;
   $('#modal').addEventListener('close',()=>setTimeout(()=>URL.revokeObjectURL(url),60000),{once:true});
   on('pdfsave',()=>download(file,file.name));
   on('pdfshare',async()=>{if(navigator.canShare?.({files:[file]}))await navigator.share({files:[file]});else download(file,file.name)});
 }finally{btn.disabled=false;btn.textContent='A4 PDF 출력'}});
 app.querySelectorAll('[data-detail]').forEach(b=>b.onclick=guard(()=>{const q=list.find(x=>x.id===b.dataset.detail),d=s.documents.find(x=>x.id===q.doc);modal('<h2>'+q.number+'번 복습</h2><label>주 테마<select id="qt">'+themePicker(ts.filter(t=>t.subject===d.subject),q.theme)+'</select></label><label>숙지 상태<select id="st">'+options(['미복습','복습 필요','부분 이해','숙지 완료'],q.status)+'</select></label><label>메모<textarea id="memo">'+esc(q.memo)+'</textarea></label>'+action('qsave','저장','primary'));on('qsave',async()=>{await change(v=>{const row=v.questions.find(x=>x.id===q.id);row.theme=$('#qt').value||null;row.status=$('#st').value;row.memo=$('#memo').value;v.reviews.push({id:uid(),q:q.id,date:stamp(),status:row.status})});$('#modal').close();await show()})}));
 function output(title,value){modal('<h2>'+title+'</h2><textarea id="out"></textarea><div class="row">'+action('copy','복사')+action('dl','파일 저장')+'</div>');$('#out').value=value;on('copy',async()=>{try{await navigator.clipboard.writeText(value);notice('복사했습니다.')}catch{$('#out').select();notice('선택한 내용을 복사하세요.')}});on('dl',()=>download(new Blob([value],{type:'text/plain;charset=utf-8'}),'Yu-study.txt'))}
 const rows=list.map(q=>{const d=s.documents.find(d=>d.id===q.doc);return {questionId:q.id,subject:d.subject,year:d.year,exam:d.exam,number:q.number,primaryThemeId:q.theme,count:count.get(q.id),status:q.status}});
 on('export',()=>output('분석 자료','오답 빈도와 반복 횟수를 바탕으로 복습 순서를 제안해 주세요.\n'+JSON.stringify(rows,null,2)));
 on('prompt',()=>output('GPT 분류 요청','다음 문항을 같은 과목의 목차 ID로 분류하세요. 불확실하면 primaryThemeId를 null로 두세요. JSON 형식 '+JSON.stringify({version:1,results:[{questionId:'문항 ID',primaryThemeId:null,secondaryThemeIds:[],confidence:0,reason:'근거',needsReview:true}]})+'\n'+JSON.stringify({themes:ts.filter(t=>t.enabled),questions:rows.map((r,i)=>({...r,text:list[i].text||''}))})));
 on('result',()=>{modal('<h2>GPT 분류 결과</h2><label>결과 JSON<textarea id="json"></textarea></label>'+action('read','파일 선택')+action('preview','미리보기'));on('read',async()=>{const [f]=await pick('.json');if(f)$('#json').value=await f.text()});on('preview',()=>{const data=JSON.parse($('#json').value),rs=classify(s,data);modal('<h2>분류 미리보기</h2>'+rs.map((r,i)=>'<label><span><input type="checkbox" data-i="'+i+'" '+(r.needsReview?'':'checked')+'> '+esc(r.questionId+' → '+(r.primaryThemeId||'미분류')+' · '+r.reason)+'</span></label>').join('')+action('approve','선택 항목 적용'));on('approve',async()=>{const chosen=[...document.querySelectorAll('[data-i]:checked')].map(x=>rs[x.dataset.i]);let previous=[];await change(v=>{classify(v,{version:1,results:chosen});for(const r of chosen){const q=v.questions.find(x=>x.id===r.questionId);previous.push({id:q.id,theme:q.theme,secondary:q.secondary});q.theme=r.primaryThemeId;q.secondary=r.secondaryThemeIds}});undo=previous;$('#modal').close();await show()})})});
 on('revert',async()=>{await change(v=>{for(const r of undo){const q=v.questions.find(x=>x.id===r.id);if(q)Object.assign(q,r)}});undo=[];await show()})
}
guard(()=>show())();if('serviceWorker' in navigator)navigator.serviceWorker.register(new URL('sw.js',document.baseURI),{scope:'./'}).catch(e=>notice('오프라인 준비 실패 · '+e.message));
