import {state,change} from './db.js';
import {subjects} from './model.js';
import {commonExams,studyState,studyStats} from './exam-catalog.js';
import {esc,options,action,guard,modal,notice} from './ui.js';
import {download} from './backup.js';

const statuses=['확인되지 않음','미등록','미시행·미출제'];
const cellKey=(subject,year,exam)=>JSON.stringify([subject,String(year),exam]);
const csvCell=value=>'"'+String(value).replace(/^[=+@\-\t\r]/,"'$&").replace(/"/g,'""')+'"';
export function holdings(s,scope){
  const docs=new Map(),stats=studyStats(s),cells=[];
  for(const d of s.documents)if(!d.deleted&&d.type!=='정답지'&&d.subject===scope.subject){
    const key=cellKey(d.subject,d.year,d.exam);if(!docs.has(key))docs.set(key,[]);docs.get(key).push(d);
  }
  for(let y=scope.to;y>=scope.from;y--)for(const exam of scope.exams){
    const key=cellKey(scope.subject,y,exam),papers=docs.get(key)||[],states=[...new Set(papers.map(d=>studyState(d,stats.get(d.id))))];
    cells.push({key,subject:scope.subject,year:y,exam,docs:papers,status:papers.length?states.map(st=>st==='미풀이'?'보유·미풀이':st).join(' / '):s.inventoryMarks?.[key]||statuses[0]});
  }return cells;
}
export async function inventory(open,initialSubject){
  let s=await state();
  const now=new Date().getFullYear(),stored=s.inventoryScope,subject=subjects.includes(initialSubject)?initialSubject:stored?.subject||'행정법';
  let scope={subject,from:stored?.from||now-4,to:stored?.to||now,exams:stored?.exams||['국가직 9급','지방직 9급']};
  function render(){
    const cells=holdings(s,scope),years=[...new Set(cells.map(c=>c.year))],available=[...new Set([...commonExams,...s.examTypes,...scope.exams])];
    const section=modal('<h2>기출문제 보유 현황</h2><label>과목<select id="holding-sub">'+options(subjects,scope.subject)+'</select></label>'+
      '<details class="box"><summary>수집 범위</summary><div class="row"><label>시작 연도<input id="collect-from" type="number" value="'+scope.from+'"></label><label>끝 연도<input id="collect-to" type="number" value="'+scope.to+'"></label></div>'+
      '<div class="row">'+available.map((e,i)=>'<label><input type="checkbox" data-exam="'+i+'" '+(scope.exams.includes(e)?'checked':'')+'>'+esc(e)+'</label>').join('')+'</div>'+action('collect-save','범위 적용')+'</details>'+
      '<p class="sub">빈 칸을 눌러 시행 여부를 지정하세요. 미등록 목록에는 직접 미등록으로 표시한 시험만 포함됩니다.</p>'+
      '<div class="holdings-scroll"><table><thead><tr><th>연도</th>'+scope.exams.map(e=>'<th>'+esc(e)+'</th>').join('')+'</tr></thead><tbody>'+
      years.map((y,i)=>'<tr><th>'+y+'</th>'+scope.exams.map((_,j)=>{const index=i*scope.exams.length+j,c=cells[index];return '<td><button data-cell="'+index+'">'+esc(c.status)+(c.docs.length>1?' ('+c.docs.length+')':'')+'</button></td>'}).join('')+'</tr>').join('')+'</tbody></table></div><div class="row">'+
      action('copy-held','보유 목록 복사')+action('copy-missing','미등록 목록 복사')+action('get-csv','CSV 저장')+action('get-json','JSON 저장')+action('collect-gpt','수집 요청 복사')+'</div><div id="cell-editor"></div>',{protectEdits:true});
    const sel=q=>section.querySelector(q);
    async function save(){await change(a=>{a.inventoryScope=scope});s=await state();render()}
    sel('#holding-sub').onchange=guard(async e=>{scope={...scope,subject:e.target.value};await save()});
    sel('#collect-save').onclick=guard(async()=>{
      const from=+sel('#collect-from').value,to=+sel('#collect-to').value;
      const exams=[...section.querySelectorAll('[data-exam]:checked')].map(el=>available[+el.dataset.exam]);
      if(!Number.isInteger(from)||!Number.isInteger(to)||from<1900||to<from||to>now+5||to-from>60||!exams.length)throw Error('연도 범위와 시험 한 개 이상을 선택하세요.');
      scope={...scope,from,to,exams};await save();
    });
    section.querySelector('tbody').onclick=guard(async e=>{
      const b=e.target.closest('[data-cell]');if(!b)return;const cell=cells[+b.dataset.cell],edit=sel('#cell-editor');
      async function openDoc(id){document.querySelector('#modal').close();await open(id)}
      if(cell.docs.length===1)return openDoc(cell.docs[0].id);
      if(cell.docs.length){edit.innerHTML=cell.docs.map((d,i)=>'<button data-held="'+i+'">'+esc(d.title)+'</button>').join('');edit.onclick=guard(ev=>{const btn=ev.target.closest('[data-held]');if(btn)return openDoc(cell.docs[+btn.dataset.held].id)});return}
      edit.innerHTML='<p>'+esc(cell.year+' '+cell.exam)+'</p><label>시행·보유 확인<select>'+options(statuses,cell.status)+'</select></label>'+action('mark-cell','상태 저장');
      sel('#mark-cell').onclick=guard(async()=>{const value=edit.querySelector('select').value;await change(a=>{(a.inventoryMarks??={})[cell.key]=value});s=await state();render()});
      edit.scrollIntoView({block:'nearest'});
    });
    const rows=cells.map(c=>({과목:c.subject,연도:c.year,시험:c.exam,상태:c.status,자료:c.docs.map(d=>d.title).join(' / ')}));
    const list=predicate=>cells.filter(predicate).map(c=>[c.year,c.exam,c.subject,c.status].join(' · ')).join('\n')||'없음';
    async function copy(value){try{await navigator.clipboard.writeText(value);notice('복사했습니다.')}catch{const el=document.createElement('textarea');el.value=value;sel('#cell-editor').replaceChildren(el);el.focus();el.select();notice('선택된 내용을 복사하세요.')}}
    sel('#copy-held').onclick=guard(()=>copy(list(c=>c.docs.length)));sel('#copy-missing').onclick=guard(()=>copy(list(c=>c.status==='미등록')));
    sel('#collect-gpt').onclick=guard(()=>copy(scope.subject+' 기출문제를 수집하고 있습니다. 다음 미등록 시험의 공식 공개 문제지와 최종 정답지 링크를 찾아 주세요. 시행 여부가 불분명하면 확인 필요로 표시해 주세요.\n미등록\n'+list(c=>c.status==='미등록')+'\n이미 보유\n'+list(c=>c.docs.length)));
    sel('#get-json').onclick=()=>download(new Blob([JSON.stringify(rows,null,2)],{type:'application/json'}),'Yu-study-보유현황.json');
    sel('#get-csv').onclick=()=>download(new Blob(['\ufeff'+[Object.keys(rows[0]),...rows.map(Object.values)].map(row=>row.map(csvCell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}),'Yu-study-보유현황.csv');
  }
  render();
}
