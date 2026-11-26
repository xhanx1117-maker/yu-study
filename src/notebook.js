import {subjects} from './model.js';
import {change} from './db.js';
import {$,esc,guard,modal,notice,on} from './ui.js';
import {analysisControls,bindAnalysis} from './analysis-ui.js';
import {emptyFilters,notebookIndex,filterCandidates,searchRows,groupCounts,totals,orders,statuses,setStatus,assignTheme} from './notebook-model.js';
import {openDetail,openTrash,confirmRemoval,selectOptions,themeName} from './notebook-detail.js';
import {bindSearch,searchKey} from './search.js';
import {openPrint} from './print-ui.js';
import {compareRegions} from './region-ui.js';

let filters=emptyFilters(), editing=false, page=0;
let filtersOpen=false, groupOpen=false, groupType='kind';
const chosen=new Set(), pageSize=28;
export const notebookSnapshot=()=>({filters:structuredClone(filters),page,filtersOpen,groupOpen,groupType});
export function restoreNotebook(view){resetNotebook(view.filters);page=view.page;filtersOpen=view.filtersOpen;groupOpen=view.groupOpen;groupType=view.groupType}
export function resetNotebook(values={}){
  filters={...emptyFilters(),...values};chosen.clear();page=0;editing=false;groupType='kind';
}
const button=(id,label,style='')=>'<button id="'+id+'" class="'+style+'">'+label+'</button>';
const facets={kind:'분류',year:'연도',book:'교재',part:'PART',chapter:'CHAPTER',theme:'테마'};
const kinds={unassigned:'미분류', repeated:'반복 오답', learning:'미숙지'};
const textCounts=t=>'고유 '+t.unique+'문항 · 누적 '+t.events+'회 · 반복 '+t.repeated+'문항 · 미숙지 '+t.learning+'문항';
const eligible=(t,f)=>(!f.subject||t.subject===f.subject)&&(!f.book||t.book===f.book)&&(!f.part||t.partId===f.part)&&(!f.chapter||t.chapterId===f.chapter);
function uniquePairs(pairs){return [...new Map(pairs.filter(([key])=>key)).entries()]}
function plainOptions(values){return [...new Set(values.filter(Boolean))].sort().reverse().map(s=>[s,s])}
const drop=(id,label,choices,current,placeholder='전체')=>'<label>'+label+'<select id="'+id+'">'+selectOptions(choices,current,placeholder)+'</select></label>';

function questionCard(row){
      const {question:q,doc}=row, preview=(q.text||doc.detected?.[q.number]?.text||'').trim().slice(0,120);
      return '<article class="notebook-card" data-q="'+esc(q.id)+'">'+(editing?'<label class="pick-row"><input type="checkbox" data-pick="'+esc(q.id)+'" aria-label="'+esc(doc.title+' '+q.number+'번 선택')+'" '+(chosen.has(q.id)?'checked':'')+'></label>':'')+
        '<button class="open-question" data-detail="'+esc(q.id)+'"><strong>'+esc(doc.title)+' · '+q.number+'번</strong><small>'+esc([doc.subject,doc.year,doc.exam,row.count+'회',q.status].filter(Boolean).join(' · '))+'</small>'+
        '<span class="theme-line">'+esc(row.linked.map(themeName).join(' · ')||'테마 미분류')+'</span>'+(preview?'<span class="question-text">'+esc(preview)+'</span>':'')+'</button></article>';

}

export function mountNotebook(app,archive,hooks){
  const index=notebookIndex(archive,{searchable:true}),globalCounts=groupCounts(index.rows);
  const scopes=new Map([['',{rows:index.rows,counts:globalCounts,catalog:index.catalog}]]);
  let scope, candidates=[],list=[],themeChoices=[],themeQuery='';
  function selected(){return list.filter(row=>chosen.has(row.id))}
  const tabs=['',...subjects].map(name=>{
    const count=globalCounts.get(name?'subject:'+name:'all')?.unique||0;
    return '<button data-subject="'+name+'">'+(name||'전체')+' <b>'+count+'</b></button>';
  }).join('');
  app.innerHTML='<h1>오답노트</h1>'+
    '<div class="subject-tabs" aria-label="오답 과목">'+tabs+'</div><div class="notebook-tools">'+
    '<details id="filters"><summary>필터 및 정렬</summary><div class="filter-grid"></div>'+
    '<details class="theme-options"><summary>교재 테마</summary><label>테마 검색<input type="search" id="f-theme-search" placeholder="테마 번호, 이름"></label><div class="check-list"></div><p id="empty-themes" hidden></p></details>'+
    '<label>문제 텍스트 검색<input id="f-search" type="search" value="'+esc(filters.search)+'" placeholder="문제 본문, 시험지명, 메모"></label>'+button('f-clear','필터 초기화')+'</details>'+
    '<details id="group-panel"><summary>분류별 현황</summary><label>분류 기준<select id="group-type"></select></label><div class="facet-list"></div></details></div>'+
    '<div class="notebook-summary"><p class="notebook-counts"></p><div class="row">'+button('edit-notebook','편집')+button('print','A4 PDF 출력','primary')+'</div></div><div class="bulk-bar" hidden><span id="selection-count"></span>'+button('select-all','현재 목록 전체 선택')+button('select-none','선택 해제')+button('bulk-theme','테마 지정')+button('bulk-master','숙지 완료')+button('bulk-print','선택 PDF')+button('bulk-regions','영역 재분석')+button('bulk-remove','선택 제거','danger')+'</div>'+
    '<div class="notebook-list"></div><div class="row pager" hidden>'+button('nb-prev','이전')+'<span id="nb-page"></span>'+button('nb-next','다음')+'</div>'+
    '<div class="notebook-foot">'+button('mistake-trash','오답 휴지통'+(archive.removedMistakes?.length?' ('+new Set(archive.removedMistakes.flatMap(b=>b.events.map(e=>e.q))).size+')':''))+analysisControls()+'</div>';

  const filterPanel=$('#filters'),groupPanel=$('#group-panel'),themesPanel=$('.theme-options');
  const panels=[themesPanel,filterPanel,groupPanel];
  function dismissFilters(e){
    if($('#modal').open || e.isComposing || e.keyCode===229)return;
    if(e.type==='keydown' && e.key==='Escape'){
      const panel=panels.find(p=>p.open&&p.contains(e.target));
      if(panel){panel.open=false;panel.querySelector('summary').focus();e.preventDefault()}
    }else if(e.type==='click' && !e.target.closest('button,label,input,textarea,select,a,summary,.notebook-tools,dialog')){
      for(const panel of panels)panel.open=false;
    }
  }
  app.addEventListener('keydown',dismissFilters);app.addEventListener('click',dismissFilters);
  const field=$('#f-search'),themeField=$('#f-theme-search'),grid=$('.filter-grid'),cards=$('.notebook-list');
  filterPanel.open=filtersOpen;groupPanel.open=groupOpen;
  filterPanel.ontoggle=()=>{if(filterPanel.isConnected)filtersOpen=filterPanel.open};
  groupPanel.ontoggle=()=>{if(groupPanel.isConnected)groupOpen=groupPanel.open};

  function updateSelection(){
    $('#selection-count').textContent='선택 '+chosen.size+'문항';
    for(const id of ['bulk-master','bulk-theme','bulk-print','bulk-regions','bulk-remove','select-none'])$('#'+id).disabled=!chosen.size;
  }
  function drawList(){
    page=Math.max(0,Math.min(page,Math.ceil(list.length/pageSize)-1));
    cards.innerHTML=list.slice(page*pageSize,(page+1)*pageSize).map(questionCard).join('')||'<p class="empty">조건에 맞는 오답이 없습니다.</p>';
    $('.pager').hidden=list.length<=pageSize;
    $('#nb-page').textContent=(page+1)+' / '+Math.max(1,Math.ceil(list.length/pageSize));
    $('#nb-prev').disabled=page===0;$('#nb-next').disabled=(page+1)*pageSize>=list.length;
    $('.bulk-bar').hidden=!editing;$('#edit-notebook').textContent=editing?'편집 종료':'편집';updateSelection();
  }
  function updateResults(){
    list=searchRows(candidates,filters.search);
    if(chosen.size){
      const ids=new Set(list.map(row=>row.id));
      for(const id of chosen)if(!ids.has(id))chosen.delete(id);
    }
    $('.notebook-counts').textContent=textCounts(totals(list));drawList();
  }
  const search=bindSearch(field,value=>{
    const changed=searchKey(filters.search).trim()!==searchKey(value).trim();
    filters.search=value;
    if(changed){page=0;chosen.clear();updateResults()}
  });

  function showThemes(){
    const needle=searchKey(themeQuery).trim();let matches=0;
    for(const {label,text} of themeChoices){
      const hidden=!text.includes(needle);
      if(label.hidden!==hidden)label.hidden=hidden;
      if(!hidden)matches++;
    }
    const empty=$('#empty-themes');empty.hidden=matches>0;
    empty.textContent=themeChoices.length?'검색된 테마가 없습니다.':'등록된 테마가 없습니다.';
  }
  const themeSearch=bindSearch(themeField,value=>{themeQuery=value;showThemes()});
  function themeSummary(){themesPanel.querySelector('summary').textContent='교재 테마'+(filters.themeIds.length?' · '+filters.themeIds.length+'개 선택':'')}
  function drawFilters(){
    const {rows:subjectRows,catalog}=scope;
    const bookThemes=catalog.filter(t=>!filters.book||t.book===filters.book);
    const partThemes=bookThemes.filter(t=>!filters.part||t.partId===filters.part);
    const available=catalog.filter(t=>eligible(t,filters));
    grid.innerHTML=
      drop('f-year','시험 연도',plainOptions(subjectRows.map(r=>r.doc.year)),filters.year)+
      drop('f-exam','시험 종류',plainOptions(subjectRows.map(r=>r.doc.exam)),filters.exam)+
      drop('f-kind','오답 분류',Object.entries(kinds),filters.kind)+
      drop('f-status','숙지 상태',statuses.map(s=>[s,s]),filters.status)+
      drop('f-book','교재',archive.books.filter(b=>!filters.subject||b.subject===filters.subject).map(b=>[b.id,b.title]),filters.book)+
      (bookThemes.some(t=>t.partId)?drop('f-part','PART',uniquePairs(bookThemes.map(t=>[t.partId,t.partTitle])),filters.part):'')+
      (partThemes.some(t=>t.chapterId)?drop('f-chapter','CHAPTER',uniquePairs(partThemes.map(t=>[t.chapterId,t.chapterTitle])),filters.chapter):'')+
      '<label>정렬<select id="f-sort">'+Object.entries(orders).map(([id,name])=>'<option value="'+id+'" '+(filters.sort===id?'selected':'')+'>'+name+'</option>').join('')+'</select></label>';
    const checks=$('.check-list',themesPanel);
    checks.innerHTML=available.map(t=>'<label><input type="checkbox" data-ft="'+esc(t.id)+'" '+(filters.themeIds.includes(t.id)?'checked':'')+'> '+esc(t.path+' · '+themeName(t))+'</label>').join('');
    themeChoices=Array.from(checks.children,label=>({label,text:searchKey(label.textContent)}));
    if(filters.themeIds.length)themesPanel.open=true;
    themeSummary();showThemes();
  }
  function drawGroups(){
    const {rows:subjectRows,catalog,counts:scopedCounts}=scope;
    const groupChoices={kind:Object.entries(kinds),year:plainOptions(subjectRows.map(r=>r.doc.year)),book:uniquePairs(catalog.map(t=>[t.book,t.path.split(' › ')[0]])),
      part:uniquePairs(catalog.map(t=>[t.partId,t.partTitle])),chapter:uniquePairs(catalog.map(t=>[t.chapterId,t.chapterTitle])),theme:catalog.map(t=>[t.id,themeName(t)])};
    $('#group-type').innerHTML=Object.entries(facets).filter(([k])=>groupChoices[k].length).map(([k,name])=>'<option value="'+k+'" '+(groupType===k?'selected':'')+'>'+name+'</option>').join('');
    $('.facet-list').innerHTML=(groupChoices[groupType]||[]).map(([key,name])=>{
      const n=scopedCounts.get(groupType+':'+key)||totals([]);
      return '<button data-group="'+esc(key)+'"><strong>'+esc(name)+'</strong><small>'+textCounts(n)+'</small></button>';
    }).join('');
  }
  function applyFilters(){
    candidates=filterCandidates(scope.rows,filters);updateResults();
  }
  function drawScope(){
    if(!scopes.has(filters.subject)){
      const rows=index.rows.filter(row=>row.doc.subject===filters.subject);
      scopes.set(filters.subject,{rows,counts:groupCounts(rows),catalog:index.catalog.filter(t=>t.subject===filters.subject)});
    }
    scope=scopes.get(filters.subject);
    for(const tab of app.querySelectorAll('[data-subject]'))tab.setAttribute('aria-pressed',String(tab.dataset.subject===filters.subject));
    drawFilters();drawGroups();applyFilters();
  }
  function reset(values){
    hooks.checkpoint?.();resetNotebook(values);search.reset(filters.search);themeSearch.reset();themeQuery='';themesPanel.open=false;drawScope();
  }
  $('.subject-tabs').onclick=guard(e=>{const b=e.target.closest('[data-subject]');if(b)reset({subject:b.dataset.subject})});
  grid.onchange=guard(e=>{
    hooks.checkpoint?.();const key=e.target.id.slice(2);filters[key]=e.target.value;page=0;chosen.clear();
    if(['book','part','chapter'].includes(key)){
      if(key==='book')filters.part='';
      if(key!=='chapter')filters.chapter='';
      filters.themeIds=[];drawFilters();
    }
    applyFilters();
  });
  $('.check-list',themesPanel).onchange=guard(e=>{
    const input=e.target.closest('[data-ft]');if(!input)return;
    hooks.checkpoint?.();const ids=new Set(filters.themeIds);if(input.checked)ids.add(input.dataset.ft);else ids.delete(input.dataset.ft);
    filters.themeIds=[...ids];themeSummary();page=0;chosen.clear();applyFilters();
  });
  on('f-clear',()=>reset({subject:filters.subject}));
  on('group-type',e=>{groupType=e.target.value;drawGroups()},'change');
  $('.facet-list').onclick=guard(e=>{
    const b=e.target.closest('[data-group]');if(!b)return;
    hooks.checkpoint?.();filters={...emptyFilters(),subject:filters.subject,...(groupType==='theme'?{themeIds:[b.dataset.group]}:{[groupType]:b.dataset.group})};
    page=0;chosen.clear();search.reset();themeSearch.reset();themeQuery='';drawFilters();applyFilters();groupPanel.open=false;
  });
  on('edit-notebook',()=>{editing=!editing;chosen.clear();drawList()});
  cards.onclick=guard(e=>{const b=e.target.closest('[data-detail]');if(b)return openDetail(archive,index,index.byId.get(b.dataset.detail),hooks)});
  cards.onchange=e=>{const b=e.target.closest('[data-pick]');if(!b)return;if(b.checked)chosen.add(b.dataset.pick);else chosen.delete(b.dataset.pick);updateSelection()};
  on('select-all',()=>{list.forEach(r=>chosen.add(r.id));drawList()});on('select-none',()=>{chosen.clear();drawList()});
  on('bulk-regions',()=>compareRegions(selected(),hooks));
  on('bulk-remove',()=>confirmRemoval(selected().flatMap(row=>row.events),hooks.refresh));
  on('bulk-master',async()=>{await change(s=>{setStatus(s,[...chosen],'숙지 완료')});await hooks.refresh();notice('숙지 완료로 변경했습니다.')});
  on('bulk-theme',()=>{const rows=selected(),sub=rows[0].doc.subject;
    if(rows.some(r=>r.doc.subject!==sub))return notice('한 과목의 문항을 선택하세요.');
    modal('<h2>선택 '+rows.length+'문항의 주 테마</h2><select id="bulk-target">'+selectOptions(index.catalog.filter(t=>t.subject===sub).map(t=>[t.id,t.path+' · '+themeName(t)]),'','테마 연결 모두 해제')+'</select>'+button('bulk-apply','적용','primary'),{protectEdits:true});
    on('bulk-apply',async()=>{const id=$('#bulk-target').value;await change(s=>{assignTheme(s,rows.map(r=>r.id),id)});$('#modal').close();await hooks.refresh()});
  });
  on('print',()=>openPrint(archive,list,filters));on('bulk-print',()=>openPrint(archive,selected(),filters));
  on('mistake-trash',()=>openTrash(archive,hooks.refresh));
  on('nb-prev',()=>{page--;drawList();app.scrollIntoView()});on('nb-next',()=>{page++;drawList();app.scrollIntoView()});
  bindAnalysis(archive,()=>list,()=>scope.catalog,hooks.refresh);
  drawScope();
  if(hooks.detail&&index.byId.has(hooks.detail))openDetail(archive,index,index.byId.get(hooks.detail),hooks);
  return ()=>{app.removeEventListener('keydown',dismissFilters);app.removeEventListener('click',dismissFilters);search.dispose();themeSearch.dispose()};
}
