import {subjects} from './model.js';
import {change} from './db.js';
import {$,esc,guard,modal,notice,on} from './ui.js';
import {analysisControls,bindAnalysis} from './analysis-ui.js';
import {emptyFilters,notebookIndex,filterRows,groupCounts,totals,orders,statuses,setStatus,assignTheme} from './notebook-model.js';
import {openDetail,openTrash,confirmRemoval,selectOptions,themeName} from './notebook-detail.js';
import {openPrint} from './print-ui.js';

let filters=emptyFilters(), editing=false, page=0;
let filtersOpen=false, groupOpen=false, groupType='kind';
const chosen=new Set(), pageSize=28;
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

export function mountNotebook(app,archive,hooks){
  const index=notebookIndex(archive), globalCounts=groupCounts(index.rows);
  let list=[];
  let timer;
  function selected(){return list.filter(row=>chosen.has(row.id))}
  function counts(key){return globalCounts.get(key)?.unique||0}
  function changeFilters(patch){
    Object.assign(filters,patch);page=0;chosen.clear();draw();
  }
  function draw(){
    list=filterRows(index.rows,filters);
    page=Math.max(0,Math.min(page,Math.ceil(list.length/pageSize)-1));
    const subjectRows=index.rows.filter(row=>!filters.subject||row.doc.subject===filters.subject);
    const catalog=index.catalog.filter(t=>!filters.subject||t.subject===filters.subject);
    const bookThemes=catalog.filter(t=>!filters.book||t.book===filters.book);
    const partThemes=bookThemes.filter(t=>!filters.part||t.partId===filters.part);
    const available=catalog.filter(t=>eligible(t,filters));
    const visible=list.slice(page*pageSize,(page+1)*pageSize);
    const mainCount=totals(list);
    const selectedCount=selected().length;
    const tabs=['',...subjects].map(name=>{
      const count=name?counts('subject:'+name):counts('all');
      return '<button data-subject="'+name+'" aria-pressed="'+(filters.subject===name)+'">'+(name||'전체')+' <b>'+count+'</b></button>';
    }).join('');
    const themeMenu='<details class="theme-options"><summary>교재 테마'+(filters.themeIds.length?' · '+filters.themeIds.length+'개 선택':'')+'</summary><div class="check-list">'+
      (available.map(t=>'<label><input type="checkbox" data-ft="'+esc(t.id)+'" '+(filters.themeIds.includes(t.id)?'checked':'')+'> '+esc(t.path+' · '+themeName(t))+'</label>').join('')||'<p>등록된 테마가 없습니다.</p>')+'</div></details>';
    const filterPanel='<details id="filters" '+(filtersOpen?'open':'')+'><summary>필터 및 정렬</summary><div class="filter-grid">'+
      drop('f-year','시험 연도',plainOptions(subjectRows.map(r=>r.doc.year)),filters.year)+
      drop('f-exam','시험 종류',plainOptions(subjectRows.map(r=>r.doc.exam)),filters.exam)+
      drop('f-kind','오답 분류',Object.entries(kinds),filters.kind)+
      drop('f-status','숙지 상태',statuses.map(s=>[s,s]),filters.status)+
      drop('f-book','교재',archive.books.filter(b=>!filters.subject||b.subject===filters.subject).map(b=>[b.id,b.title]),filters.book)+
      (bookThemes.some(t=>t.partId)?drop('f-part','PART',uniquePairs(bookThemes.map(t=>[t.partId,t.partTitle])),filters.part):'')+
      (partThemes.some(t=>t.chapterId)?drop('f-chapter','CHAPTER',uniquePairs(partThemes.map(t=>[t.chapterId,t.chapterTitle])),filters.chapter):'')+
      '<label>정렬<select id="f-sort">'+Object.entries(orders).map(([id,name])=>'<option value="'+id+'" '+(filters.sort===id?'selected':'')+'>'+name+'</option>').join('')+'</select></label></div>'+
      themeMenu+'<label>문제 텍스트 검색<input id="f-search" type="search" value="'+esc(filters.search)+'" placeholder="문제 본문, 시험지명, 메모"></label>'+button('f-clear','필터 초기화')+'</details>';
    const scopedCounts=groupCounts(subjectRows);
    const groupChoices={kind:Object.entries(kinds),year:plainOptions(subjectRows.map(r=>r.doc.year)),book:uniquePairs(catalog.map(t=>[t.book,t.path.split(' › ')[0]])),
      part:uniquePairs(catalog.map(t=>[t.partId,t.partTitle])),chapter:uniquePairs(catalog.map(t=>[t.chapterId,t.chapterTitle])),theme:catalog.map(t=>[t.id,themeName(t)])};
    const groupPanel='<details id="group-panel" '+(groupOpen?'open':'')+'><summary>분류별 현황</summary><label>분류 기준<select id="group-type">'+Object.entries(facets).filter(([k])=>groupChoices[k].length).map(([k,name])=>'<option value="'+k+'" '+(groupType===k?'selected':'')+'>'+name+'</option>').join('')+'</select></label><div class="facet-list">'+
      (groupChoices[groupType]||[]).map(([key,name])=>{const n=scopedCounts.get(groupType+':'+key)||totals([]);return '<button data-group="'+esc(key)+'"><strong>'+esc(name)+'</strong><small>'+textCounts(n)+'</small></button>'}).join('')+'</div></details>';
    const cards=visible.map(row=>{
      const {question:q,doc}=row, preview=(q.text||doc.detected?.[q.number]?.text||'').trim().slice(0,120);
      return '<article class="notebook-card" data-q="'+esc(q.id)+'">'+(editing?'<label class="pick-row"><input type="checkbox" data-pick="'+esc(q.id)+'" aria-label="'+esc(doc.title+' '+q.number+'번 선택')+'" '+(chosen.has(q.id)?'checked':'')+'></label>':'')+
        '<button class="open-question" data-detail="'+esc(q.id)+'"><strong>'+esc(doc.title)+' · '+q.number+'번</strong><small>'+esc([doc.subject,doc.year,doc.exam,row.count+'회',q.status].filter(Boolean).join(' · '))+'</small>'+
        '<span class="theme-line">'+esc(row.linked.map(themeName).join(' · ')||'테마 미분류')+'</span>'+(preview?'<span class="question-text">'+esc(preview)+'</span>':'')+'</button></article>';
    }).join('');
    app.innerHTML='<div class="toolbar"><h1>오답노트</h1><div class="row">'+button('edit-notebook',editing?'편집 종료':'편집')+button('print','A4 PDF 출력','primary')+'</div></div>'+
      '<div class="subject-tabs" aria-label="오답 과목">'+tabs+'</div><div class="notebook-tools">'+filterPanel+groupPanel+'</div>'+
      '<p class="notebook-counts">'+textCounts(mainCount)+'</p>'+
      (editing?'<div class="bulk-bar"><span id="selection-count">선택 '+selectedCount+'문항</span>'+button('select-all','현재 목록 전체 선택')+button('select-none','선택 해제')+button('bulk-theme','테마 지정')+button('bulk-master','숙지 완료')+button('bulk-print','선택 PDF')+button('bulk-remove','선택 제거','danger')+'</div>':'')+
      '<div class="notebook-list">'+(cards||'<p class="empty">조건에 맞는 오답이 없습니다.</p>')+'</div>'+
      (list.length>pageSize?'<div class="row pager">'+button('nb-prev','이전')+'<span>'+(page+1)+' / '+Math.ceil(list.length/pageSize)+'</span>'+button('nb-next','다음')+'</div>':'')+
      '<div class="notebook-foot">'+button('mistake-trash','오답 휴지통'+(archive.removedMistakes?.length?' ('+archive.removedMistakes.length+')':''))+analysisControls()+'</div>';
    const bind=(selector,fn)=>app.querySelectorAll(selector).forEach(b=>b.onclick=guard(()=>fn(b)));
    bind('[data-subject]',b=>{resetNotebook({subject:b.dataset.subject});groupType='kind';draw()});
    $('#filters').ontoggle=e=>{if(e.target.isConnected)filtersOpen=e.target.open};
    $('#group-panel').ontoggle=e=>{if(e.target.isConnected)groupOpen=e.target.open};
    for(const key of ['year','exam','kind','status','book','part','chapter','sort']){
      on('f-'+key,e=>{
        const patch={[key]:e.target.value};
        if(key==='book')Object.assign(patch,{part:'',chapter:'',themeIds:[]});
        if(key==='part')Object.assign(patch,{chapter:'',themeIds:[]});
        if(key==='chapter')patch.themeIds=[];
        filtersOpen=true;changeFilters(patch);
      },'change');
    }
    const themesPanel=$('.theme-options');
    if(filters.themeIds.length)themesPanel.open=true;
    app.querySelectorAll('[data-ft]').forEach(b=>b.onchange=()=>{filtersOpen=true;changeFilters({themeIds:[...app.querySelectorAll('[data-ft]:checked')].map(b=>b.dataset.ft)});$('.theme-options').open=true});
    on('f-clear',()=>{resetNotebook({subject:filters.subject});filtersOpen=true;draw()});
    on('f-search',e=>{
      const input=e.target, value=input.value;clearTimeout(timer);
      timer=setTimeout(()=>{if(!input.isConnected)return;filtersOpen=true;changeFilters({search:value});const field=$('#f-search');field.focus();field.setSelectionRange(value.length,value.length)},180);
    },'input');
    on('group-type',e=>{groupType=e.target.value;groupOpen=true;draw()},'change');
    bind('[data-group]',b=>{filters={...emptyFilters(),subject:filters.subject};changeFilters(groupType==='theme'?{themeIds:[b.dataset.group]}:{[groupType]:b.dataset.group});groupOpen=false;$('#group-panel').open=false});
    on('edit-notebook',()=>{editing=!editing;chosen.clear();draw()});
    bind('[data-detail]',b=>openDetail(archive,index,index.byId.get(b.dataset.detail),hooks));
    app.querySelectorAll('[data-pick]').forEach(b=>b.onchange=()=>{if(b.checked)chosen.add(b.dataset.pick);else chosen.delete(b.dataset.pick);$('#selection-count').textContent='선택 '+selected().length+'문항';syncBulk()});
    function syncBulk(){for(const id of ['bulk-master','bulk-theme','bulk-print','bulk-remove','select-none'])if($('#'+id))$('#'+id).disabled=!chosen.size}
    syncBulk();
    on('select-all',()=>{list.forEach(r=>chosen.add(r.id));draw()});on('select-none',()=>{chosen.clear();draw()});
    on('bulk-remove',()=>confirmRemoval(selected().flatMap(row=>row.events),hooks.refresh));
    on('bulk-master',async()=>{await change(s=>{setStatus(s,[...chosen],'숙지 완료')});await hooks.refresh();notice('숙지 완료로 변경했습니다.')});
    on('bulk-theme',()=>{const rows=selected(),sub=rows[0].doc.subject;
      if(rows.some(r=>r.doc.subject!==sub))return notice('한 과목의 문항을 선택하세요.');
      modal('<h2>선택 '+rows.length+'문항의 주 테마</h2><select id="bulk-target">'+selectOptions(index.catalog.filter(t=>t.subject===sub).map(t=>[t.id,t.path+' · '+themeName(t)]),'','테마 연결 모두 해제')+'</select>'+button('bulk-apply','적용','primary'));
      on('bulk-apply',async()=>{const id=$('#bulk-target').value;await change(s=>{assignTheme(s,rows.map(r=>r.id),id)});$('#modal').close();await hooks.refresh()});
    });
    const print=rows=>openPrint(archive,rows,filters);
    on('print',()=>print(list));on('bulk-print',()=>print(selected()));
    on('mistake-trash',()=>openTrash(archive,hooks.refresh));
    on('nb-prev',()=>{page--;draw();app.scrollIntoView()});on('nb-next',()=>{page++;draw();app.scrollIntoView()});
    if($('#nb-prev')){$('#nb-prev').disabled=page===0;$('#nb-next').disabled=(page+1)*pageSize>=list.length}
    bindAnalysis(archive,list.map(r=>r.question),catalog,new Map(list.map(r=>[r.id,r.count])),hooks.refresh);
  }
  draw();
  return ()=>clearTimeout(timer);
}
