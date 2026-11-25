import {subjects} from './model.js';
import {change,get,state} from './db.js';
import {searchKey,bindSearch} from './search.js';
import {esc,action,options,modal,notice,guard} from './ui.js';
import {studyStates,studyState,studyStats,commonExams} from './exam-catalog.js';
import {changeDocumentSubject} from './notebook-model.js';
import {download} from './backup.js';
import {makeZip} from './archive-zip.js';

const filters={subject:'',year:'',exam:'',status:'',query:'',trash:false,review:false};
export function resetLibrary(subject=''){Object.assign(filters,{subject,year:'',exam:'',status:'',query:'',trash:false,review:false})}
export function paperCard(d,manage=false){
  return '<article class="item toolbar"><div><strong>'+esc(d.title)+'</strong><div class="sub">'+esc([d.subject,d.year,d.exam,d.type].filter(Boolean).join(' · '))+
    (d.reviewReasons?.length?' · 분류 검토':'')+'</div></div><div class="row"><button data-doc="'+esc(d.id)+'">열기</button>'+
    (manage?'<button data-edit="'+esc(d.id)+'">자료 관리</button>':'')+'</div></article>';
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
export function mountLibrary(app,s,{open,edit,bring,refresh,inventory}){
  const docs=s.documents,active=docs.filter(d=>!d.deleted),f=filters;
  const byId=new Map(docs.map(d=>[d.id,d])),stats=studyStats(s);
  const rows=docs.map(d=>({d,text:searchKey([d.title,d.filename,d.tags,d.agency,d.form].filter(Boolean).join(' '))}))
    .sort((a,b)=>Number(!!b.d.favorite)-Number(!!a.d.favorite)||String(b.d.year||'').localeCompare(String(a.d.year||''))||titleOrder.compare(a.d.title||'',b.d.title||''));
  app.innerHTML='<div class="toolbar"><h1>자료실</h1><div class="row">'+action('bring','자료 가져오기','primary')+action('inventory','보유 현황')+action('library-edit','편집')+action('trash',f.trash?'자료실 보기':'휴지통')+'</div></div>'+
    '<div class="row filters"><label>과목<select id="subject">'+options(['전체 과목',...subjects,'통합','미분류'],f.subject)+'</select></label><label>연도<select id="year">'+options(['전체 연도',...new Set(active.map(d=>String(d.year||'')).filter(Boolean).sort().reverse())],f.year)+'</select></label>'+
    '<label>시험<select id="exam">'+options(['전체 시험',...new Set([...s.examTypes,...active.map(d=>d.exam).filter(Boolean)])],f.exam)+'</select></label><label>풀이 상태<select id="study-filter">'+options(['전체 상태',...studyStates],f.status)+'</select></label>'+
    '<label>제목·태그 검색<input id="query" type="search" value="'+esc(f.query)+'"></label><label><input id="review-filter" type="checkbox" '+(f.review?'checked':'')+'> 분류 검토</label></div>'+
    '<div id="library-batch" class="box" hidden></div><div id="library-results"></div><div class="row" id="library-pages"></div>';
  const at=id=>app.querySelector('#'+id),results=at('library-results'),pages=at('library-pages'),tools=at('library-batch');
  let current=[],page=0,editing=false,selected=new Set();
  function editBar(){
    tools.hidden=!editing;if(!editing)return;
    tools.innerHTML='<div class="row"><strong>선택 '+selected.size+'개</strong>'+action('select-results','현재 필터 전체 선택')+action('select-none','선택 해제')+
      (f.trash?action('restore-docs','선택 복원'):action('edit-selected','분류·파일명 일괄 수정')+action('export-zip','선택 ZIP 저장')+action('export-one','원본 PDF 저장')+action('trash-docs','선택 삭제'))+'</div>';
  }
  function paint(){
    const max=Math.max(1,Math.ceil(current.length/pageSize));page=Math.max(0,Math.min(page,max-1));
    const slice=current.slice(page*pageSize,(page+1)*pageSize);
    results.innerHTML=slice.length?slice.map(({d})=>editing?'<div class="library-pick"><input type="checkbox" aria-label="'+esc(d.title)+' 선택" data-select="'+esc(d.id)+'" '+(selected.has(d.id)?'checked':'')+'>'+paperCard(d,true)+'</div>':paperCard(d,true)).join(''):'<p class="empty">표시할 자료가 없습니다.</p>';
    pages.innerHTML=current.length?'<span class="sub">'+current.length+'건 · '+(page+1)+' / '+max+'쪽</span>'+
      (page>0?action('list-prev','이전 목록'):'')+(page+1<max?action('list-next','다음 목록'):''):'';
    editBar();
  }
  function draw(){
    const needle=searchKey(f.query).trim();
    current=rows.filter(({d,text})=>!!d.deleted===f.trash&&(!f.subject||f.subject===d.subject)&&(!f.year||String(d.year)===f.year)&&
      (!f.exam||f.exam===d.exam)&&(!f.status||studyState(d,stats.get(d.id))===f.status)&&(!f.review||d.reviewReasons?.length||d.analysisState==='error')&&text.includes(needle));
    page=0;selected.clear();paint();
  }
  const search=bindSearch(at('query'),value=>{f.query=value;draw()});
  for(const [id,key] of [['subject','subject'],['year','year'],['exam','exam'],['study-filter','status']])at(id).onchange=e=>{f[key]=e.target.selectedIndex?e.target.value:'';draw()};
  at('review-filter').onchange=e=>{f.review=e.target.checked;draw()};at('bring').onclick=guard(()=>bring());
  at('inventory').onclick=guard(()=>inventory(f.subject));at('trash').onclick=()=>{f.trash=!f.trash;at('trash').textContent=f.trash?'자료실 보기':'휴지통';draw()};
  at('library-edit').onclick=()=>{editing=!editing;at('library-edit').textContent=editing?'편집 마침':'편집';selected.clear();paint()};
  pages.onclick=e=>{const b=e.target.closest('button');if(!b)return;page+=b.id==='list-next'?1:-1;paint();results.scrollIntoView({block:'start'})};
  results.onchange=e=>{const id=e.target.dataset.select;if(!id)return;if(e.target.checked)selected.add(id);else selected.delete(id);editBar()};
  results.onclick=guard(e=>{const b=e.target.closest('button');if(b?.dataset.doc)return open(b.dataset.doc);if(b?.dataset.edit)return edit(s,byId.get(b.dataset.edit))});
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
  draw();return ()=>{app.ondrop=app.ondragover=null;search.dispose()};
}
export function confirmTrash(docs,s){
  const ids=new Set(docs.map(d=>d.id)),stats=studyStats(s);let count=0,events=0;
  for(const id of ids){const row=stats.get(id);count+=row?.wrong.size||0;events+=row?.attempts||0}
  return confirm('자료 '+ids.size+'개를 자료 휴지통으로 옮길까요? 연결된 고유 오답 '+count+'문항 · 이력 '+events+'건은 원본과 함께 보존되며 자료를 복원할 수 있습니다.');
}
function bulkEdit(docs,s,refresh){
  const section=modal('<h2>자료 '+docs.length+'개 일괄 수정</h2><label>과목<select id="bulk-sub">'+options(['변경 안 함',...subjects,'미분류'])+'</select></label><label>연도<input id="bulk-year" inputmode="numeric" placeholder="변경 안 함"></label>'+
    '<label>시험 종류<input id="bulk-exam" list="bulk-exams" placeholder="변경 안 함"><datalist id="bulk-exams">'+options([...new Set([...commonExams,...s.examTypes])])+'</datalist></label>'+
    '<label>파일명 형식<input id="bulk-name" placeholder="{연도}_{시험}_{과목}_{책형}"></label><small>{제목}, {번호}도 사용할 수 있습니다. 비워 두면 현재 이름을 유지합니다.</small>'+
    '<label><input id="bulk-reviewed" type="checkbox"> 선택 자료의 분류 검토 완료</label>'+action('apply-batch','적용','primary'),{protectEdits:true});
  section.querySelector('#apply-batch').onclick=guard(async()=>{
    const val=id=>section.querySelector('#'+id).value.trim(),sub=val('bulk-sub'),year=val('bulk-year'),exam=val('bulk-exam'),pattern=val('bulk-name'),verified=section.querySelector('#bulk-reviewed').checked;
    if(year&&!/^(?:19|20)\d{2}$/.test(year))throw Error('연도는 네 자리로 입력하세요.');
    const order=new Map(docs.map((d,i)=>[d.id,i+1]));
    await change(v=>{
      for(const d of v.documents)if(order.has(d.id)){
        if(sub!=='변경 안 함')changeDocumentSubject(v,d,sub);if(year)d.year=year;if(exam)d.exam=exam;
        if(verified)d.reviewReasons=[];
        if(pattern){const fields={'연도':d.year,'과목':d.subject,'시험':d.exam,'책형':d.form,'제목':d.title,'번호':order.get(d.id)};
          const next=pattern.replace(/\{(연도|과목|시험|책형|제목|번호)\}/g,(_,k)=>fields[k]||'').replace(/[\\/:*?"<>|\x00-\x1f]/g,'_').replace(/\.pdf$/i,'').trim();if(!next)throw Error('파일명이 비어 있습니다.');d.title=next;d.filename=next+'.pdf'}
      }
      if(exam&&!v.examTypes.includes(exam))v.examTypes.push(exam);
    });document.querySelector('#modal').close();await refresh();
  });
}
