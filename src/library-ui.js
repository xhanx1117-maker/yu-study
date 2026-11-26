import {kinds,materialIndex,materialKind,answerLabel,coversSubject,setMaterialType} from './materials.js';
import {companionButtons,chooseVariant,coverage} from './material-ui.js';
import {subjects} from './model.js';
import {change,get,state} from './db.js';
import {searchKey,bindSearch} from './search.js';
import {esc,action,options,modal,notice,guard} from './ui.js';
import {studyStates,studyState,studyStats,commonExams} from './exam-catalog.js';
import {changeDocumentSubject} from './notebook-model.js';
import {download} from './backup.js';
import {makeZip} from './archive-zip.js';

const defaults={subject:'',year:'',exam:'',status:'',query:'',trash:false,review:false,kind:'문제지',extra:'',order:'연도순',page:0,filterOpen:false};
const filters={...defaults};
export function resetLibrary(subject=''){Object.assign(filters,defaults,{subject})}
export const librarySnapshot=()=>({...filters});
export function restoreLibrary(view){Object.assign(filters,defaults,view)}
export function paperCard(d,manage=false,group=null,inTrash=false){
  const id=esc(d.id),kind=materialKind(d),meta=[d.subject,d.year,d.exam,d.form&&d.form+'형',kind==='정답지'?answerLabel(d):d.type,d.lawReview].filter(Boolean);
  return '<article class="item material-card" data-card="'+id+'"><div class="toolbar"><button class="material-title" data-doc="'+id+'"><strong>'+esc(d.title)+'</strong><small>'+esc(meta.join(' · '))+(d.reviewReasons?.length?' · 분류 검토':'')+'</small></button>'+
    (manage&&!inTrash?'<button data-favorite="'+id+'" aria-label="'+esc(d.title)+' 즐겨찾기" aria-pressed="'+!!d.favorite+'">'+(d.favorite?'★':'☆')+'</button>':'')+'</div>'+
    (manage?'<div class="row material-actions">'+(inTrash?'<button data-restore-one="'+id+'">복원</button><button class="danger" data-purge-one="'+id+'">영구 삭제</button>':companionButtons(group,d.id))+'<button data-edit="'+id+'">자료 관리</button></div>':'')+'</article>';
}
export function spaceStats(s){
  const byHash=new Map(),bySubject=new Map();let bytes=0,keyBytes=0,unknown=0;
  for(const d of s.documents){
    if(byHash.has(d.hash))continue;byHash.set(d.hash,d);
    if(!Number.isFinite(d.size)){unknown++;continue}bytes+=d.size;
    bySubject.set(d.subject,(bySubject.get(d.subject)||0)+d.size);if(d.type==='정답지')keyBytes+=d.size;
  }
  return {byHash,bySubject,bytes,keyBytes,unknown};
}
const pageSize=48,titleOrder=new Intl.Collator('ko',{numeric:true});
export function mountLibrary(app,s,{open,edit,bring,refresh,inventory,checkpoint=()=>{},back}){
  const docs=s.documents,active=docs.filter(d=>!d.deleted),f=filters;
  const index=materialIndex(docs);
  const byId=new Map(docs.map(d=>[d.id,d])),stats=studyStats(s);
  const kindCounts=new Map(),subjectCounts=new Map();
  for(const d of docs){
    if(!!d.deleted!==f.trash)continue;
    const k=materialKind(d);
    for(const key of [k,'전체 자료'])kindCounts.set(key,(kindCounts.get(key)||0)+1);
    for(const sub of ['',...subjects,'통합','미분류']){
      if(!coversSubject(d,sub))continue;
      for(const group of [k,'전체 자료']){const key=group+'|'+sub;subjectCounts.set(key,(subjectCounts.get(key)||0)+1)}
    }
  }
  const rows=docs.map(d=>({d,text:searchKey([d.title,d.filename,d.tags,d.agency,d.form].filter(Boolean).join(' '))}))
    .sort((a,b)=>Number(!!b.d.favorite)-Number(!!a.d.favorite)||String(b.d.year||'').localeCompare(String(a.d.year||''))||titleOrder.compare(a.d.title||'',b.d.title||''));
  app.innerHTML='<div class="toolbar">'+action(f.trash?'trash-back':'scope-back','‹ 뒤로')+'<h1>'+(f.trash?'자료실 휴지통':'자료실')+'</h1><div class="row">'+action('bring','자료 가져오기','primary')+action('inventory','보유 현황')+action('library-edit','편집')+action('trash',f.trash?'자료실 보기':'휴지통')+'</div></div>'+
    '<div id="kind-tabs" class="subject-tabs" aria-label="자료 유형"></div><div id="lib-subjects" class="subject-tabs" aria-label="자료 과목"></div><label>제목·태그 검색<input id="query" type="search" value="'+esc(f.query)+'"></label><details class="box library-filters" '+(f.filterOpen?'open':'')+'><summary>필터 및 정렬</summary><div class="row filters"><label>과목<select id="subject">'+options(['전체 과목',...subjects,'통합','미분류'],f.subject)+'</select></label><label>연도<select id="year">'+options(['전체 연도',...new Set(active.map(d=>String(d.year||'')).filter(Boolean).sort().reverse())],f.year)+'</select></label>'+
    '<label>시험<select id="exam">'+options(['전체 시험',...new Set([...s.examTypes,...active.map(d=>d.exam).filter(Boolean)])],f.exam)+'</select></label><label>풀이 상태<select id="study-filter">'+options(['전체 상태',...studyStates],f.status)+'</select></label>'+
    '<label><input id="review-filter" type="checkbox" '+(f.review?'checked':'')+'> 분류 검토</label><label>추가 필터<select id="lib-extra">'+options(['전체','즐겨찾기','최근 열람','정답지 미보유','해설지 미보유','연결 검토 필요','미분류 자료','기타 자료'],f.extra)+'</select></label><label>정렬<select id="lib-order">'+options(['연도순','최근 열람순','제목순','즐겨찾기순'],f.order)+'</select></label>'+action('link-coverage','정답·해설 연결 현황')+'</div></details><div id="trash-actions" class="row"></div>'+
    '<div id="library-batch" class="box" hidden></div><div id="library-results"></div><div class="row" id="library-pages"></div>';
  const at=id=>app.querySelector('#'+id),results=at('library-results'),pages=at('library-pages'),tools=at('library-batch');
  let current=[],page=f.page,editing=false,selected=new Set();
  const trashActions=at('trash-actions');
  let journal;
  let paintedTabs;
  function tabs(){
    const scopeBack=at('scope-back');
    if(scopeBack)scopeBack.hidden=!(f.kind!=='문제지'||f.subject||f.year||f.exam||f.status||f.extra||f.query||f.review||f.order!==defaults.order||f.filterOpen);
    const tabState=[f.kind,f.subject,f.extra==='기타 자료'].join('|');
    if(tabState===paintedTabs)return;paintedTabs=tabState;
    at('kind-tabs').innerHTML=(f.trash?['전체 자료',...kinds]:kinds).map(k=>'<button data-kind="'+k+'" aria-pressed="'+(k===f.kind&&f.extra!=='기타 자료')+'">'+k+' '+(kindCounts.get(k)||0)+'</button>').join('');
    at('lib-subjects').innerHTML=['',...subjects].map(sub=>'<button data-lib-sub="'+sub+'" aria-pressed="'+(sub===f.subject)+'">'+(sub||'전체')+' '+(subjectCounts.get((f.extra==='기타 자료'?'기타 자료':f.kind)+'|'+sub)||0)+'</button>').join('');
  }
  function trashBar(){
    if(!f.trash)return;
    const count=kindCounts.get('전체 자료')||0;
    trashActions.innerHTML='<button id="trash-select-all">전체 선택</button><button id="restore-marked" '+(!selected.size?'disabled':'')+'>선택 복원</button><button id="purge-marked" '+(!selected.size?'disabled':'')+'>선택 영구 삭제</button><button id="empty-library-trash" class="danger" '+(!count?'disabled':'')+'>휴지통 비우기</button>'+
      (journal?'<button id="resume-purge">중단된 삭제 확인</button><button id="cancel-pending">삭제 대기 해제</button>':'');
  }
  if(f.trash)import('./trash-ui.js').then(async mod=>{journal=await mod.pendingPurge();if(app.contains(trashActions))trashBar()});
  async function purge(ids){return (await import('./trash-ui.js')).purgeDialog(ids,refresh)}
  async function restoreIds(ids){await change(v=>{for(const d of v.documents)if(ids.has(d.id))d.deleted=false});return refresh()}
  trashActions.onclick=guard(async e=>{
    const b=e.target.closest('button');if(!b)return;
    if(b.id==='trash-select-all'){selected=new Set(current.map(r=>r.d.id));paint()}
    if(b.id==='restore-marked')return restoreIds(selected);
    if(b.id==='purge-marked')return purge([...selected]);
    if(b.id==='empty-library-trash')return purge(docs.filter(d=>d.deleted).map(d=>d.id));
    if(b.id==='resume-purge')return purge();
    if(b.id==='cancel-pending'){await (await import('./trash-ui.js')).cancelPending(journal.id);return refresh()}
  });
  at('kind-tabs').onclick=e=>{const b=e.target.closest('[data-kind]');if(!b)return;checkpoint();f.kind=b.dataset.kind;if(f.extra==='기타 자료'){f.extra='';at('lib-extra').selectedIndex=0}draw()};
  at('lib-subjects').onclick=e=>{const b=e.target.closest('[data-lib-sub]');if(!b)return;checkpoint();f.subject=b.dataset.libSub;at('subject').value=f.subject||'전체 과목';draw()};
  const filterPanel=app.querySelector('.library-filters');
  filterPanel.querySelector('summary').addEventListener('click',()=>{if(!filterPanel.open)checkpoint()});
  filterPanel.ontoggle=e=>{if(e.target.isConnected){f.filterOpen=e.target.open;tabs()}};
  at('link-coverage').onclick=()=>coverage(index,f.subject);
  function editBar(){
    tools.hidden=!editing;if(!editing)return;
    tools.innerHTML='<div class="row"><strong>선택 '+selected.size+'개</strong>'+action('select-results','현재 필터 전체 선택')+action('select-none','선택 해제')+
      (f.trash?action('restore-docs','선택 복원'):action('edit-selected','분류·파일명 일괄 수정')+action('export-zip','선택 ZIP 저장')+action('export-one','원본 PDF 저장')+action('trash-docs','선택 삭제'))+'</div>';
  }
  function paint(){
    const max=Math.max(1,Math.ceil(current.length/pageSize));page=Math.max(0,Math.min(page,max-1));
    f.page=page;const slice=current.slice(page*pageSize,(page+1)*pageSize);
    results.innerHTML=slice.length?slice.map(({d})=>editing||f.trash?'<div class="library-pick"><input type="checkbox" aria-label="'+esc(d.title)+' 선택" data-select="'+esc(d.id)+'" '+(selected.has(d.id)?'checked':'')+'>'+paperCard(d,true,index.groupFor(d.id),f.trash)+'</div>':paperCard(d,true,index.groupFor(d.id),f.trash)).join(''):'<p class="empty">표시할 자료가 없습니다.</p>';
    pages.innerHTML=current.length?'<span class="sub">'+current.length+'건 · '+(page+1)+' / '+max+'쪽</span>'+
      (page>0?action('list-prev','이전 목록'):'')+(page+1<max?action('list-next','다음 목록'):''):'';
    editBar();trashBar();
  }
  function draw(reset=true){
    tabs();
    const needle=searchKey(f.query).trim();
    current=rows.filter(({d,text})=>!!d.deleted===f.trash&&(f.kind==='전체 자료'||materialKind(d)===(f.extra==='기타 자료'?'기타 자료':f.kind))&&coversSubject(d,f.subject)&&(!f.year||String(d.year)===f.year)&&
      (!f.exam||f.exam===d.exam)&&(!f.status||studyState(d,stats.get(d.id))===f.status)&&(!f.review||d.reviewReasons?.length||d.analysisState==='error'||d.analysisState==='manual')&&text.includes(needle)&&extraMatch(d));
    function extraMatch(d){
      const group=index.groups.get(d.id);
      switch(f.extra){
        case '즐겨찾기':return d.favorite;
        case '최근 열람':return d.opened;
        case '정답지 미보유':return group&&!group.answers.length;
        case '해설지 미보유':return group&&!group.solutions.length;
        case '연결 검토 필요':return group?.review||d.reviewReasons?.length;
        case '미분류 자료':return d.subject==='미분류'||d.reviewReasons?.length;
        default:return true;
      }
    }
    if(f.order==='제목순')current.sort((a,b)=>titleOrder.compare(a.d.title,b.d.title));
    else if(f.order==='최근 열람순')current.sort((a,b)=>String(b.d.opened||'').localeCompare(a.d.opened||''));
    else if(f.order==='연도순')current.sort((a,b)=>String(b.d.year||'').localeCompare(a.d.year||'')||titleOrder.compare(a.d.title||'',b.d.title||''));
    if(reset)page=0;selected.clear();paint();
  }
  const search=bindSearch(at('query'),value=>{if(!f.query&&value)checkpoint();f.query=value;draw()});
  for(const [id,key] of [['subject','subject'],['year','year'],['exam','exam'],['study-filter','status'],['lib-extra','extra'],['lib-order','order']])at(id).onchange=e=>{checkpoint();f[key]=e.target.selectedIndex||key==='order'?e.target.value:'';draw()};
  at('review-filter').onchange=e=>{checkpoint();f.review=e.target.checked;draw()};at('bring').onclick=guard(()=>bring());
  at('inventory').onclick=guard(()=>inventory(f.subject));at('trash').onclick=guard(()=>{if(f.trash&&back)return back();checkpoint();Object.assign(f,defaults,{trash:!f.trash,kind:f.trash?'문제지':'전체 자료'});return refresh()});at(f.trash?'trash-back':'scope-back').onclick=back;
  at('library-edit').onclick=()=>{editing=!editing;at('library-edit').textContent=editing?'편집 마침':'편집';selected.clear();paint()};
  pages.onclick=e=>{const b=e.target.closest('button');if(!b)return;page+=b.id==='list-next'?1:-1;paint();results.scrollIntoView({block:'start'})};
  results.onchange=e=>{const id=e.target.dataset.select;if(!id)return;if(e.target.checked)selected.add(id);else selected.delete(id);editBar();trashBar()};
  results.onclick=guard(async e=>{
    const b=e.target.closest('button'),card=e.target.closest('[data-card]');
    if(!card||e.target.closest('input'))return;
    const id=card.dataset.card,d=byId.get(id),g=index.groupFor(id);
    if(b?.dataset.edit)return edit(s,d);
    if(b?.dataset.restoreOne)return restoreIds(new Set([id]));
    if(b?.dataset.purgeOne)return purge([id]);
    if(b?.dataset.favorite){
      let value;await change(v=>{const doc=v.documents.find(x=>x.id===id);if(doc)value=doc.favorite=!doc.favorite});
      d.favorite=value;if(f.extra==='즐겨찾기'||f.order==='즐겨찾기순')return refresh();
      b.textContent=value?'★':'☆';b.setAttribute('aria-pressed',String(value));return;
    }
    if(b?.dataset.variants)return chooseVariant(g[b.dataset.variants],next=>open(next,g.paper?.id));
    if(!f.trash&&!editing||b?.dataset.doc||b?.dataset.openMaterial)return open(b?.dataset.openMaterial||id,g?.paper?.id);
  });
  tools.onclick=guard(async e=>{
    const b=e.target.closest('button');if(!b)return;
    if(b.id==='select-results'||b.id==='select-none'){selected=b.id==='select-results'?new Set(current.map(r=>r.d.id)):new Set();paint();return}
    if(!selected.size){notice('먼저 자료를 선택하세요.');return}
    const chosen=Array.from(selected,id=>byId.get(id));
    if(b.id==='edit-selected')return bulkEdit(chosen,s,refresh);
    if(b.id==='export-one'){if(chosen.length!==1){notice('한 개는 원본 PDF, 여러 개는 ZIP 저장을 선택하세요.');return}const d=chosen[0],blob=await get('files',d.hash);if(!blob)throw Error('원본 PDF가 없습니다.');download(blob,d.filename||d.title+'.pdf');return}
    if(b.id==='export-zip'){
      const section=modal('<h2>선택 자료 ZIP 저장</h2><p role="status"></p>');section.setAttribute('aria-busy','true');
      async function* files(){let i=0;for(const d of chosen){
        section.querySelector('p').textContent=(++i)+' / '+chosen.length+' · '+d.title;
        const blob=await get('files',d.hash);if(!blob)throw Error('원본 PDF가 없습니다.');
        const name=(d.filename||d.title+'.pdf').replace(/[\\/:*?"<>|\x00-\x1f]/g,'_');
        yield {path:String(i).padStart(4,'0')+'/'+name,blob};
      }}
      try{download(await makeZip(files()),'Yu-study-선택자료.zip')}finally{document.querySelector('#modal').close()}
      return;
    }
    const remove=b.id==='trash-docs';
    if(remove&&!confirmTrash(chosen,s))return;
    await change(v=>{for(const d of v.documents)if(selected.has(d.id))d.deleted=remove});await refresh();
  });
  app.ondragover=e=>e.preventDefault();app.ondrop=guard(e=>{e.preventDefault();return bring([...e.dataTransfer.files])});
  draw(false);return ()=>{app.ondrop=app.ondragover=null;search.dispose()};
}
export function confirmTrash(docs,s){
  const ids=new Set(docs.map(d=>d.id)),stats=studyStats(s);let count=0,events=0;
  for(const id of ids){const row=stats.get(id);count+=row?.wrong.size||0;events+=row?.attempts||0}
  return confirm('자료 '+ids.size+'개를 자료 휴지통으로 옮길까요? 연결된 고유 오답 '+count+'문항 · 이력 '+events+'건은 원본과 함께 보존되며 자료를 복원할 수 있습니다.');
}
function bulkEdit(docs,s,refresh){
  const section=modal('<h2>자료 '+docs.length+'개 일괄 수정</h2><label>과목<select id="bulk-sub">'+options(['변경 안 함',...subjects,'미분류'])+'</select></label><label>연도<input id="bulk-year" inputmode="numeric" placeholder="변경 안 함"></label>'+
    '<label>시험 종류<input id="bulk-exam" list="bulk-exams" placeholder="변경 안 함"><datalist id="bulk-exams">'+options([...new Set([...commonExams,...s.examTypes])])+'</datalist></label>'+
    '<label>자료 유형<select id="bulk-kind">'+options(['변경 안 함',...kinds])+'</select></label><label>파일명 형식<input id="bulk-name" placeholder="{연도}_{시험}_{과목}_{책형}"></label><small>{제목}, {번호}도 사용할 수 있습니다. 비워 두면 현재 이름을 유지합니다.</small>'+
    '<label><input id="bulk-reviewed" type="checkbox"> 선택 자료의 분류 검토 완료</label>'+action('apply-batch','적용','primary'),{protectEdits:true});
  section.querySelector('#apply-batch').onclick=guard(async()=>{
    const val=id=>section.querySelector('#'+id).value.trim(),sub=val('bulk-sub'),year=val('bulk-year'),exam=val('bulk-exam'),pattern=val('bulk-name'),verified=section.querySelector('#bulk-reviewed').checked;
    if(year&&!/^(?:19|20)\d{2}$/.test(year))throw Error('연도는 네 자리로 입력하세요.');
    const order=new Map(docs.map((d,i)=>[d.id,i+1]));
    const kind=val('bulk-kind'),changedIds=new Set(docs.filter(d=>materialKind(d)!==kind).map(d=>d.id));
    const affected=new Set(s.questions.filter(q=>changedIds.has(q.doc)).map(q=>q.id));
    const eventCount=s.events.filter(e=>affected.has(e.q)).length;
    if(kind!=='변경 안 함'&&changedIds.size&&!confirm('자료 '+changedIds.size+'개의 유형을 '+kind+'로 바꿀까요? 연결 문항 '+affected.size+'개 · 오답 이력 '+eventCount+'회를 보존합니다.'))return;
    await change(v=>{
      for(const d of v.documents)if(order.has(d.id)){
        if(kind!=='변경 안 함')setMaterialType(d,kind);
        if(sub!=='변경 안 함')changeDocumentSubject(v,d,sub);if(year)d.year=year;if(exam){d.exam=exam;const grade=exam.match(/[1-9]급/);if(grade)d.grade=grade[0]}
        if(verified)d.reviewReasons=[];
        if(pattern){const fields={'연도':d.year,'과목':d.subject,'시험':d.exam,'책형':d.form,'제목':d.title,'번호':order.get(d.id)};
          const next=pattern.replace(/\{(연도|과목|시험|책형|제목|번호)\}/g,(_,k)=>fields[k]||'').replace(/[\\/:*?"<>|\x00-\x1f]/g,'_').replace(/\.pdf$/i,'').trim();if(!next)throw Error('파일명이 비어 있습니다.');d.title=next;d.filename=next+'.pdf'}
      }
      if(exam&&!v.examTypes.includes(exam))v.examTypes.push(exam);
    });document.querySelector('#modal').close();await refresh();
  });
}
