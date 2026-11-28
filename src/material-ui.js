import {esc,guard,modal,notice} from './ui.js';
import {materialKind,kinds,answerLabel} from './materials.js';
export function companionButtons(group,current=null,reader=false){
  if(!group)return '';
  return kinds.map((kind,i)=>{
    const list=[group.paper?[group.paper]:[],group.answers,group.solutions][i];
    const chosen=list.find(d=>d.id===current)||list[0];
    const status=group.status?.[i===1?'answers':'solutions']?.state;
    const review=i>0&&!chosen&&status==='후보 검토'&&!reader;
    const label=chosen?'':i===0?' 미등록':status==='후보 검토'?' 연결 검토':status==='판정 보류'?' 판정 보류':status==='연결 해제'?' 연결 해제':' 미등록';
    const attrs=chosen?'data-open-material="'+esc(chosen.id)+'" data-owner="'+esc(group.paper?.id)+'"':review?'data-link-review="'+esc(group.paper.id)+'"':'disabled';
    return '<button '+attrs+(reader&&i===1&&chosen?' id="open-answer"':'')+(reader&&current===chosen?.id?' aria-pressed="true"':'')+'>'+kind+label+'</button>'+
      (list.length>1?'<button class="material-variants" data-variants="'+(i===1?'answers':'solutions')+'" data-owner="'+esc(group.paper?.id)+'" aria-label="'+kind+' 다른 자료 '+list.length+'개">▾</button>':'');
  }).join('');
}
export function chooseVariant(list,open){
  const panel=modal('<h2>연결 자료 선택</h2>'+list.map(d=>'<button data-choice="'+esc(d.id)+'">'+esc(d.title)+' · '+esc(materialKind(d)==='정답지'?answerLabel(d):d.type)+'</button>').join(''));
  panel.onclick=guard(e=>{const b=e.target.closest('[data-choice]');if(b){document.querySelector('#modal').close();return open(b.dataset.choice)}});
}
export async function coverage(index,subject,refresh,focusId){
  const {showAudit}=await import('./link-audit-ui.js');return showAudit(index,subject,refresh,focusId);
}
