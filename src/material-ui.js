import {esc,guard,modal,notice} from './ui.js';
import {materialKind,kinds,answerLabel,missingMaterials} from './materials.js';
import {download} from './backup.js';
export function companionButtons(group,current=null,reader=false){
  if(!group)return '';
  return kinds.map((kind,i)=>{
    const list=[group.paper?[group.paper]:[],group.answers,group.solutions][i];
    const chosen=list.find(d=>d.id===current)||list[0];
    const attrs=chosen?'data-open-material="'+esc(chosen.id)+'" data-owner="'+esc(group.paper?.id)+'"':'disabled';
    return '<button '+attrs+(reader&&i===1&&chosen?' id="open-answer"':'')+(reader&&current===chosen?.id?' aria-pressed="true"':'')+'>'+kind+(chosen?'':' 미등록')+'</button>'+
      (list.length>1?'<button class="material-variants" data-variants="'+(i===1?'answers':'solutions')+'" data-owner="'+esc(group.paper?.id)+'" aria-label="'+kind+' 다른 자료 '+list.length+'개">▾</button>':'');
  }).join('');
}
export function chooseVariant(list,open){
  const panel=modal('<h2>연결 자료 선택</h2>'+list.map(d=>'<button data-choice="'+esc(d.id)+'">'+esc(d.title)+' · '+esc(materialKind(d)==='정답지'?answerLabel(d):d.type)+'</button>').join(''));
  panel.onclick=guard(e=>{const b=e.target.closest('[data-choice]');if(b){document.querySelector('#modal').close();return open(b.dataset.choice)}});
}
export function coverage(index,subject){
  const rows=missingMaterials(index,subject),pending=rows.filter(r=>r.필요자료||r.연결검토);
  const keys=rows.filter(r=>r.필요자료.includes('정답지')).length,solutions=rows.filter(r=>r.필요자료.includes('해설지')).length;
  const panel=modal('<h2>'+esc(subject||'전체 과목')+' 연결 현황</h2><p>문제지 '+rows.length+'개 · 연결 검토 '+rows.filter(r=>r.연결검토).length+'개</p><p>정답지 연결 '+(rows.length-keys)+'개 · 미보유 '+keys+'개<br>해설지 연결 '+(rows.length-solutions)+'개 · 미보유 '+solutions+'개</p>'+
    '<div class="row"><button id="missing-json">누락 목록 JSON 저장</button><button id="missing-copy">수집 요청 복사</button></div><div id="copy-fallback"></div>');
  panel.querySelector('#missing-json').onclick=()=>download(new Blob([JSON.stringify(pending,null,2)],{type:'application/json'}),'Yu-study-누락자료.json');
  panel.querySelector('#missing-copy').onclick=guard(async()=>{
    const message='다음 시험의 누락 자료를 찾아 주세요. 시험 회차·책형을 확인하고 공식 최종 정답을 우선해 주세요.\n'+pending.map(r=>[r.연도,r.시험,r.과목,r.회차&&r.회차+'회',r.책형&&r.책형+'형',r.제목,r.필요자료,r.연결검토&&'연결 검토'].filter(Boolean).join(' · ')).join('\n');
    try{await navigator.clipboard.writeText(message);notice('누락 자료 수집 요청을 복사했습니다.')}catch{const box=document.createElement('textarea');box.value=message;panel.querySelector('#copy-fallback').replaceChildren(box);box.focus();box.select()}
  });
}
