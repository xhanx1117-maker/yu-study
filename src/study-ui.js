import {$,esc,guard,modal,options} from './ui.js';
import {subjects,themes} from './model.js';
import {periodRange,validDay} from './study-events.js';
import {queryStudy,correctStudy} from './study-query.js';
import {studyReport,reportText,reportCsv} from './study-report.js';
import {download} from './backup.js';

const presets=['오늘','어제','최근 7일','최근 30일','이번 주','이번 달','직접 날짜 지정'];
const clock=new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',hour12:false});
export function openStudyLog(refresh,archive){
  let lookup;
  let changed=false,request=0,rows=[],report=null,offset=0,copyTimer;
  const panel=modal('<h2>학습 기록 추출</h2><div class="study-fields"><label>학습 기간<select id="study-period">'+options(presets,'오늘')+
    '</select></label><label>과목<select id="study-subject">'+options(['전체',...subjects,'미분류'],'전체')+'</select></label></div>'+
    '<div class="study-fields" id="study-dates" hidden><label>시작일<input type="date" id="study-from"></label><label>종료일<input type="date" id="study-to"></label></div>'+
    '<p id="study-summary" role="status"></p><label class="pick-row"><input id="study-prompt" type="checkbox">분석 요청 문구 포함</label>'+
    '<div class="row"><button class="primary" id="study-copy" disabled>ChatGPT 제출용 기록 복사</button><label>파일 형식<select id="study-format">'+options(['텍스트','Markdown','JSON','CSV'],'텍스트')+
    '</select></label><button id="study-export" disabled>파일 저장</button></div><span id="study-feedback" role="status" aria-live="polite"></span>'+
    '<details id="study-history"><summary>날짜별 기록 확인 · 정정</summary><div id="study-list"></div><div class="row" id="study-pages"></div></details>'+
    '<details id="study-preview"><summary>제출용 기록 미리보기</summary><textarea readonly aria-label="제출용 학습 기록"></textarea></details>');
  const field=id=>panel.querySelector('#study-'+id);
  function setRange(){const range=periodRange(field('period').value);field('from').value=range[0];field('to').value=range[1]}
  function showPreview(){if(field('preview').open)field('preview').querySelector('textarea').value=report?reportText(report,false,field('prompt').checked):''}
  function drawHistory(){
    if(!field('history').open)return;
    const items=rows.slice(offset,offset+24);
    field('list').innerHTML=items.map((r,i)=>'<div class="study-entry"><div><strong>'+esc(r.day+' · '+r.subject+' · '+(r.kind==='wrong'?r.number+'번':'풀이 완료'))+'</strong><small>'+
      esc([r.title,validDay(r.time)?'시각 미기록':clock.format(new Date(r.time)),r.sessionNumber+'회차',r.kind==='wrong'?(r.count===1?'신규':'반복')+' · 누적 '+r.count+'회':''].filter(Boolean).join(' · '))+
      '</small></div><button data-study-edit="'+(offset+i)+'">정정</button></div>').join('')||(report?'<p>이 기간에 저장된 기록이 없습니다.</p>':'');
    field('pages').innerHTML=rows.length>24?'<button data-turn="-1" '+(offset?'':'disabled')+'>이전</button><span>'+Math.floor(offset/24+1)+' / '+Math.ceil(rows.length/24)+'</span><button data-turn="1" '+(offset+24<rows.length?'':'disabled')+'>다음</button>':'';
  }
  function feedback(message){clearTimeout(copyTimer);field('feedback').textContent=message;copyTimer=setTimeout(()=>field('feedback').textContent='',2500)}
  async function load(){
    const n=++request,from=field('from').value,to=field('to').value,subject=field('subject').value;
    rows=[];report=null;field('copy').disabled=field('export').disabled=true;offset=0;drawHistory();showPreview();
    if(!validDay(from)||!validDay(to)||from>to){field('summary').textContent='시작일과 종료일을 확인하세요.';return}
    field('summary').textContent='학습 기록을 읽는 중…';
    try{
      const result=await queryStudy(from,to,subject==='전체'?'':subject);
      if(n!==request||!panel.closest('dialog[open]'))return;
      if(archive&&result.length){
        lookup??={questions:new Map(archive.questions.map(q=>[q.id,q])),themes:new Map(themes({schemaVersion:1,books:archive.books}).map(t=>[t.id,[t.number,t.title].filter(Boolean).join(' ')]))};
        for(const row of result){
          const q=lookup.questions.get(row.q);if(!q)continue;
          const theme=id=>({id,label:lookup.themes.get(id)||id});
          row.current={primary:q.theme?theme(q.theme):null,secondary:(q.secondary||[]).map(theme),status:q.status||''};
        }
      }
      report=studyReport(result,{from,to,subject});rows=result.slice().reverse();
      const s=report.summary;
      field('summary').textContent=rows.length?'고유 오답 '+s.unique+'문항 · 신규 '+s.new+'회 · 반복 '+s.repeated+'회 · 풀이 완료 시험지 '+s.completedPapers+'개':'이 기간에 저장된 학습 기록이 없습니다.';
      field('copy').disabled=field('export').disabled=!rows.length;showPreview();drawHistory();
    }catch(error){if(n===request)field('summary').textContent='기록을 읽지 못했습니다. '+error.message}
  }
  field('period').onchange=()=>{const custom=field('period').value===presets.at(-1);field('dates').hidden=!custom;if(!custom)setRange();load()};
  field('from').onchange=field('to').onchange=field('subject').onchange=load;
  field('prompt').onchange=field('preview').ontoggle=showPreview;field('history').ontoggle=drawHistory;
  field('pages').onclick=e=>{const b=e.target.closest('[data-turn]');if(b){offset+=Number(b.dataset.turn)*24;drawHistory()}};
  field('copy').onclick=guard(async()=>{
    const text=reportText(report,false,field('prompt').checked);
    try{await navigator.clipboard.writeText(text);feedback('학습 기록을 복사했습니다.')}
    catch{
      field('preview').open=true;const area=field('preview').querySelector('textarea');area.value=text;area.focus();area.select();area.setSelectionRange(0,text.length);
      feedback(document.execCommand('copy')?'학습 기록을 복사했습니다.':'선택된 학습 기록을 복사해 주세요.');
    }
  });
  field('export').onclick=()=>{
    const format=field('format').value,prompt=field('prompt').checked;
    const [body,ext,mime]=format==='JSON'?[JSON.stringify(report,null,2),'json','application/json']:format==='CSV'?[reportCsv(report),'csv','text/csv']:
      [reportText(report,format==='Markdown',prompt),format==='Markdown'?'md':'txt',format==='Markdown'?'text/markdown':'text/plain'];
    download(new Blob([body],{type:mime+';charset=utf-8'}),'Yu-study-학습기록-'+report.from+'_'+report.to+'.'+ext);
  };
  field('list').onclick=guard(async e=>{
    const edit=e.target.closest('[data-study-edit]'),line=e.target.closest('.study-entry');
    if(edit){
      const i=Number(edit.dataset.studyEdit),row=rows[i];
      line.insertAdjacentHTML('beforeend','<div class="row study-correction"><label>학습 날짜<input type="date" value="'+esc(row.day)+'"></label><button data-save-day="'+i+'">날짜 저장</button><button class="danger" data-withdraw="'+i+'">기록 취소</button><button data-stop>닫기</button></div>');
      edit.disabled=true;return;
    }
    if(e.target.closest('[data-stop]')){drawHistory();return}
    const b=e.target.closest('[data-save-day],[data-withdraw]');if(!b)return;
    const cancel=b.hasAttribute('data-withdraw'),row=rows[Number(cancel?b.dataset.withdraw:b.dataset.saveDay)],date=cancel?null:line.querySelector('input').value;
    if(cancel&&!confirm(row.title+' · '+(row.kind==='wrong'?row.number+'번 오답':'풀이 완료')+' 기록을 취소할까요?'+(row.kind==='wrong'?' 해당 회차의 오답 표시도 해제됩니다.':'')))return;
    await correctStudy(row,date);changed=true;await load();feedback(cancel?'기록을 취소했습니다.':'학습 날짜를 정정했습니다.');
  });
  $('#modal').addEventListener('close',()=>{request++;clearTimeout(copyTimer);if(changed)refresh?.()},{once:true});
  setRange();return load();
}
