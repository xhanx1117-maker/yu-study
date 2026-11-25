export const $=(s,root=document)=>root.querySelector(s);
export const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const options=(values,value)=>values.map(x=>'<option '+(x===value?'selected':'')+'>'+esc(x)+'</option>').join('');
export function notice(msg){const el=$('#notice');el.hidden=false;el.textContent=msg;clearTimeout(notice.timer);notice.timer=setTimeout(()=>el.hidden=true,5000)}
export function guard(fn){return async(...args)=>{try{return await fn(...args)}catch(e){notice(e.name==='QuotaExceededError'?'저장 공간이 부족합니다. 파일을 백업하고 공간을 확보하세요.':e.message||'작업에 실패했습니다.');console.error(e)}}}
let dialogPolicy;
function values(section){
  return JSON.stringify([...section.querySelectorAll('input:not([type=file]),textarea,select')].map(el=>
    el.type==='checkbox'||el.type==='radio'?el.checked:el.value));
}
export function markModalSaved(){if(dialogPolicy)dialogPolicy.initial=values(dialogPolicy.section)}
export function mayLeaveModal(){
  const p=dialogPolicy;
  return !p?.protectEdits || values(p.section)===p.initial || confirm('저장하지 않은 변경 사항을 버리고 닫을까요?');
}
function bindDialog(d){
  const outside=e=>{
    const r=d.getBoundingClientRect();
    return e.target===d && (e.clientX<r.left || e.clientX>=r.right || e.clientY<r.top || e.clientY>=r.bottom);
  };
  function dismiss(implicit){
    if(!d.open || dialogPolicy?.section.getAttribute('aria-busy')==='true' || d.querySelector('form button').disabled)return;
    if(implicit&&dialogPolicy?.critical)return;
    if(mayLeaveModal())d.close();
  }
  let start=null,finish=false;
  d.addEventListener('pointerdown',e=>{finish=false;start=e.isPrimary&&e.button===0&&outside(e)?{id:e.pointerId,x:e.clientX,y:e.clientY}:null});
  d.addEventListener('pointermove',e=>{if(start && Math.hypot(e.clientX-start.x,e.clientY-start.y)>9)start=null});
  d.addEventListener('pointercancel',()=>{start=null;finish=false});
  d.addEventListener('pointerup',e=>{finish=!!start && e.pointerId===start.id && outside(e) && Math.hypot(e.clientX-start.x,e.clientY-start.y)<=9;start=null});
  d.addEventListener('click',e=>{
    if(!outside(e))return;
    e.preventDefault();e.stopPropagation();
    if(finish)dismiss(true);
    finish=false;
  });
  d.addEventListener('cancel',e=>{e.preventDefault();dismiss(true)});
  d.querySelector('form').addEventListener('submit',e=>{e.preventDefault();dismiss(false)});
}
export function modal(html,policy={}){
  const d=$('#modal');
  if(!d.dataset.bound){d.dataset.bound='true';bindDialog(d)}
  const section=document.createElement('section');section.innerHTML=html;
  d.querySelector('section').replaceWith(section);
  dialogPolicy={...policy,section,initial:values(section)};
  if(!d.open)d.showModal();
  return section;
}
export function pick(accept,multiple=false){
  return new Promise((resolve,reject)=>{
    const input=document.createElement('input');
    input.type='file';
    input.accept=accept;
    input.multiple=multiple;
    input.className='visually-hidden';
    // Safari must retain the input for the entire native file chooser interaction.
    (document.querySelector('dialog[open]')||document.body).append(input);
    function finish(files){
      input.remove();
      resolve(files);
    }
    input.onchange=()=>finish([...input.files]);
    input.oncancel=()=>finish([]);
    try{input.click()}catch(error){input.remove();reject(error)}
  });
}
export const action=(id,label,cls='')=>'<button id="'+id+'" class="'+cls+'">'+label+'</button>';
export function on(id,fn,event='click'){document.getElementById(id)?.addEventListener(event,guard(fn))}
