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
  const changed=p?.isDirty?p.isDirty():p?.protectEdits&&values(p.section)!==p.initial;
  return !changed || confirm('저장하지 않은 변경 사항을 버리고 닫을까요?');
}
function bindDialog(d){
  const backdrop=d.querySelector('.modal-backdrop');
  function dismiss(implicit){
    if(!d.open || dialogPolicy?.section.getAttribute('aria-busy')==='true' || d.querySelector('form button').disabled)return;
    if(implicit&&dialogPolicy?.critical)return;
    if(mayLeaveModal())d.close();
  }
  let start=null,allowClick=null;
  function begin(point,id,valid){
    allowClick=false;
    start=valid?{id,x:point.clientX,y:point.clientY}:null;
  }
  function track(point,id){
    if(start && (start.id!==id || Math.hypot(point.clientX-start.x,point.clientY-start.y)>9))start=null;
  }
  function finish(point,id){
    track(point,id);
    const tapped=Boolean(start) && document.elementFromPoint(point.clientX,point.clientY)===backdrop;
    start=null;return tapped;
  }
  d.addEventListener('pointerdown',e=>{
    if(e.pointerType!=='touch')begin(e,e.pointerId,e.target===backdrop&&e.isPrimary&&e.button===0);
  });
  d.addEventListener('pointermove',e=>{if(e.pointerType!=='touch')track(e,e.pointerId)});
  d.addEventListener('pointerup',e=>{if(e.pointerType!=='touch')allowClick=finish(e,e.pointerId)});
  d.addEventListener('pointercancel',()=>{start=null;allowClick=false});
  d.addEventListener('touchstart',e=>{
    const t=e.changedTouches[0];begin(t,t.identifier,e.target===backdrop&&e.touches.length===1);
  },{passive:true});
  d.addEventListener('touchmove',e=>{
    const t=e.changedTouches[0];track(t,t.identifier);
  },{passive:true});
  d.addEventListener('touchcancel',()=>{start=null;allowClick=false});
  // WebKit can deliver a completed touch without a compatibility click. Consume
  // its native default before removing the backdrop so the tap cannot pass through.
  backdrop.addEventListener('touchend',e=>{
    const t=e.changedTouches[0],tapped=finish(t,t.identifier)&&e.touches.length===0;
    e.stopPropagation();
    if(!e.cancelable){allowClick=tapped;return}
    e.preventDefault();allowClick=false;
    if(tapped)dismiss(true);
  },{passive:false});
  backdrop.addEventListener('click',e=>{
    e.preventDefault();e.stopPropagation();
    const tapped=allowClick!==false;allowClick=null;
    if(tapped)dismiss(true);
  });
  d.addEventListener('cancel',e=>{e.preventDefault();dismiss(true)});
  d.querySelector('form').addEventListener('submit',e=>{e.preventDefault();dismiss(false)});
}
export function modal(html,policy={}){
  const d=$('#modal');
  if(!d.dataset.bound){d.dataset.bound='true';bindDialog(d)}
  const section=document.createElement('section');section.innerHTML=html;
  d.querySelector('section').replaceWith(section);
  const heading=section.querySelector('h2');
  if(heading){heading.id||='modal-heading';d.setAttribute('aria-labelledby',heading.id)}
  else d.removeAttribute('aria-labelledby');
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
