const controls='button,summary,label.btn';
export function bindPress(){
  let active;
  const passive={passive:true};
  function mode(kind){
    if(document.documentElement.dataset.pointer!==kind)document.documentElement.dataset.pointer=kind;
  }
  function clear(){
    if(!active)return;
    active.element.removeAttribute('data-pressed');
    active=null;
    document.removeEventListener('pointermove',move);
  }
  function move(e){
    if(active&&e.pointerId===active.id&&Math.hypot(e.clientX-active.x,e.clientY-active.y)>7)clear();
  }
  // No pointer capture or synthetic clicks. Native scrolling, pinching and PDF
  // selection retain their defaults; only a currently pressed control tracks movement.
  document.addEventListener('pointerover',e=>{if(e.pointerType==='mouse')mode('mouse')},passive);
  document.addEventListener('pointerdown',e=>{
    clear();mode(e.pointerType==='mouse'?'mouse':'touch');
    if(e.pointerType==='mouse'||!e.isPrimary||e.button!==0)return;
    const element=e.target.closest?.(controls);
    if(!element||element.matches(':disabled,[aria-disabled=true]')||element.querySelector('input:disabled'))return;
    active={element,id:e.pointerId,x:e.clientX,y:e.clientY};
    element.dataset.pressed='';
    document.addEventListener('pointermove',move,passive);
  },passive);
  document.addEventListener('pointerup',clear,passive);
  document.addEventListener('pointercancel',clear,passive);
  window.addEventListener('blur',clear);
}
export function enterView(main){
  main.querySelector('h1')?.classList.add('enter-view');
}
