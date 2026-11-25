import {change,get} from './db.js';
import {openPdf,paint} from './pdf.js';
import {assignTheme,setStatus,statuses,removeEvents,restoreEvents} from './notebook-model.js';
import {$,esc,modal,on,notice,guard,mayLeaveModal} from './ui.js';
import {compareRegions} from './region-ui.js';

export function selectOptions(entries, selected='', placeholder='전체'){
  return '<option value="">'+esc(placeholder)+'</option>'+entries.map(([key,label])=>
    '<option value="'+esc(key)+'" '+(key===selected?'selected':'')+'>'+esc(label)+'</option>').join('');
}
export const themeName=t=>[t.number,t.title].filter(x=>x!==undefined&&x!=='').join(' ');
const close=()=>$('#modal').close();

export function confirmRemoval(events, refresh){
  const affected=new Set(events.map(e=>e.q)).size;
  modal('<h2>오답 기록 제거</h2><p>문항 <b>'+affected+'개</b>의 오답 이력 <b>'+events.length+'회</b>를 휴지통으로 옮깁니다. 원본 PDF와 문항 영역은 보관됩니다.</p><div class="row"><button id="confirm-remove" class="danger">휴지통으로 이동</button><button id="cancel-remove">취소</button></div>',{critical:true});
  on('cancel-remove',close);
  on('confirm-remove',async()=>{
    await change(s=>{removeEvents(s,events)});
    close();await refresh();notice('오답 휴지통에서 복구할 수 있습니다.');
  });
}

export function openTrash(archive,refresh){
  const docs=new Map(archive.documents.map(d=>[d.id,d.title]));
  const questions=new Map(archive.questions.map(q=>[q.id,q]));
  const batches=archive.removedMistakes||[];
  const section=modal('<h2>오답 휴지통</h2>'+ (batches.length?batches.map(batch=>{
    const ids=[...new Set(batch.events.map(e=>e.q))], first=questions.get(ids[0]);
    const title=(docs.get(first?.doc)||'시험지')+' '+(first?.number||'')+'번';
    return '<article class="item"><strong>'+esc(title)+(ids.length>1?' 외 '+(ids.length-1)+'문항':'')+'</strong><p>'+esc(new Date(batch.date).toLocaleDateString('ko-KR'))+' · 문항 '+ids.length+'개 · 이력 '+batch.events.length+'회</p><button data-restore="'+esc(batch.id)+'">복구</button></article>';
  }).join(''):'<p>휴지통이 비었습니다.</p>'));
  section.querySelectorAll('[data-restore]').forEach(button=>button.onclick=guard(async()=>{
    await change(s=>{restoreEvents(s,button.dataset.restore)});close();await refresh();notice('오답 기록을 복구했습니다.');
  }));
}

export async function renderRegions(container, row, width=1100){
  if(!row.question.regions.length){container.textContent='영역 미지정 · 원본에서 문항 영역을 지정하세요.';return}
  const pdf=await openPdf(await get('files',row.doc.hash));
  try{
    const regions=row.question.regions;
    for(const region of [...regions.filter(r=>r.shared),...regions.filter(r=>!r.shared)]){
      if(!container.isConnected)return;
      const canvas=document.createElement('canvas');
      await paint(pdf,region.page,canvas,width,region);
      if(!container.isConnected){canvas.width=canvas.height=1;return}
      canvas.setAttribute('aria-label',row.question.number+'번 추출 영역');
      container.append(canvas);
    }
  }finally{await pdf.destroy()}
}

export function openDetail(archive,index,row,{refresh,openOriginal}){
  const {question:q,doc}=row, catalog=index.catalog.filter(t=>t.subject===doc.subject);
  const themeOpts=catalog.map(t=>[t.id,t.path+' · '+themeName(t)]);
  const sessions=archive.sessions.filter(s=>s.doc===doc.id);
  const attempts=new Map(sessions.map((s,i)=>[s.id,i+1]));
  const material=archive.documents.filter(d=>!d.deleted&&d.subject===doc.subject&&['정답지','해설지'].includes(d.type));
  const section=modal('<h2>'+esc(doc.title)+' · '+q.number+'번</h2><div id="detail-crops" class="crops"></div>'+
    '<div class="row"><button id="goto-original">원본 시험지 열기</button><button id="reanalyze">영역 재분석</button><button id="master">숙지 완료</button></div>'+
    '<label>주 테마<select id="qt">'+selectOptions(themeOpts,q.theme,'미분류')+'</select></label>'+
    '<details><summary>보조 테마</summary><div class="check-list">'+catalog.map(t=>'<label><input type="checkbox" data-secondary="'+esc(t.id)+'" '+(q.secondary.includes(t.id)?'checked':'')+'> '+esc(themeName(t))+'</label>').join('')+'</div></details>'+
    '<label>숙지 상태<select id="st">'+statuses.map(s=>'<option '+(s===q.status?'selected':'')+'>'+s+'</option>').join('')+'</select></label>'+
    '<label>개인 메모<textarea id="memo">'+esc(q.memo)+'</textarea></label>'+
    '<details><summary>정답·해설 연결</summary><label>정답 또는 해설<textarea id="solution-text">'+esc(q.solution?.text)+'</textarea></label>'+
    '<label>연결할 자료<select id="solution-doc">'+selectOptions(material.map(d=>[d.id,d.title]),q.solution?.doc,'연결 없음')+'</select></label>'+
    '<label>부록에 넣을 자료의 페이지<input id="solution-page" type="number" min="1" value="'+esc(q.solution?.page||1)+'"></label></details>'+
    '<div class="row"><button id="qsave" class="primary">변경 저장</button><button id="unlink">테마 연결 모두 해제</button></div>'+
    '<details><summary>오답 이력 '+row.count+'회</summary>'+row.events.map(e=>'<p class="toolbar">'+(attempts.get(e.session)||'?')+'회차 · '+esc((e.date||'').slice(0,10))+'<button data-event="'+esc(e.id)+'">이 회차 제거</button></p>').join('')+'</details>'+
    '<button id="remove-all" class="danger">이 문항의 전체 오답 이력 제거</button>',{protectEdits:true});
  const crops=$('#detail-crops');renderRegions(crops,row).catch(error=>{if(crops.isConnected)crops.textContent=error.message});
  on('reanalyze',()=>{if(mayLeaveModal())return compareRegions([row],{refresh,openOriginal})});
  on('goto-original',()=>{if(!mayLeaveModal())return;close();return openOriginal(doc.id,q.number)});
  async function update(fn){await change(fn);close();await refresh()}
  on('master',()=>update(s=>{setStatus(s,[q.id],'숙지 완료')}));
  on('unlink',()=>update(s=>{assignTheme(s,[q.id],null)}));
  on('qsave',async()=>{
    const theme=$('#qt').value, secondary=[...section.querySelectorAll('[data-secondary]:checked')].map(b=>b.dataset.secondary).filter(id=>id!==theme);
    const status=$('#st').value,memo=$('#memo').value, text=$('#solution-text').value.trim(), link=$('#solution-doc').value, page=Number($('#solution-page').value);
    if(link && (!Number.isInteger(page)||page<1))throw Error('연결할 자료의 페이지를 확인하세요.');
    if(link){
      const linkedDoc=index.docs.get(link),pdf=await openPdf(await get('files',linkedDoc.hash));
      try{if(page>pdf.numPages)throw Error('연결한 PDF는 '+pdf.numPages+'쪽까지입니다.')}finally{await pdf.destroy()}
    }
    await update(s=>{
      const target=s.questions.find(item=>item.id===q.id);
      const current=s.documents.find(item=>item.id===target.doc);
      if(current.subject!==doc.subject)throw Error('원본 과목이 바뀌었습니다. 목록을 다시 여세요.');
      const allowed=new Set(catalog.map(t=>t.id));
      if(secondary.some(id=>!allowed.has(id)))throw Error('보조 테마 과목을 확인하세요.');
      assignTheme(s,[q.id],theme);target.secondary=secondary;target.memo=memo;
      if(text||link)target.solution={text,doc:link||null,page:link?page:null};else delete target.solution;
      setStatus(s,[q.id],status);
    });
  });
  on('remove-all',()=>confirmRemoval(row.events,refresh));
  section.querySelectorAll('[data-event]').forEach(b=>b.onclick=()=>confirmRemoval(row.events.filter(e=>e.id===b.dataset.event),refresh));
}
