// Same-URL history entries let Safari use its native back gesture. The stored
// browser state contains only a position; screen snapshots live in this tab.
export function navigation(capture,restore,allowDismiss){
  const token=crypto.randomUUID(),saved=new Map(),dialog=document.querySelector('#modal');
  let at=0,overlay=null,replaying=false,rebound=false,popping=false,closingFrom=null;
  const mark=()=>({yu:token,at});
  history.replaceState(mark(),'');history.scrollRestoration='manual';
  function remember(){
    const view=capture();if(overlay)view.overlay={...overlay,detail:dialog.querySelector('section')?.dataset.question||overlay.detail};
    saved.set(at,view);
  }
  function step(){
    if(replaying)return;
    remember();for(const key of saved.keys())if(key>at)saved.delete(key);
    at++;history.pushState(mark(),'');overlay=null;
  }
  function back(){
    if(!at||popping)return false;
    if(dialog.open&&!allowDismiss())return false;
    // The pop handler performs dismissal once, including the unsaved-work check.
    popping=true;history.back();return true;
  }
  function dismiss(){if(dialog.open)dialog.close()}
  window.addEventListener('yu-dialog-open',e=>{
    if(replaying)return;
    if(!overlay)step();overlay={opener:e.detail||''};
  });
  dialog.addEventListener('close',()=>{
    if(dialog.open||!overlay||replaying||popping)return;
    closingFrom=at;popping=true;history.back();
  });
  window.addEventListener('popstate',async e=>{
    if(e.state?.yu!==token)return;
    if(rebound){rebound=false;popping=false;return}
    const dest=e.state.at,wasOverlay=!!overlay,approved=popping;popping=false;
    if(closingFrom!==null&&dest===closingFrom-1){
      // Removing the history entry of a closed dialog is bookkeeping. An
      // import or save may already have taken the app to its result screen.
      const nextOverlay=overlay;closingFrom=null;at=dest;overlay=null;
      if(dialog.open){step();overlay=nextOverlay}
      return;
    }
    closingFrom=null;
    if(!approved&&dialog.open&&!allowDismiss()){
      rebound=true;history.go(at-dest);return;
    }
    remember();const target=saved.get(dest),before=saved.get(at);
    at=dest;overlay=target?.overlay||null;replaying=true;
    try{
      dismiss();
      if(target&&!(wasOverlay&&!overlay&&before.section===target.section&&before.reader?.id===target.reader?.id)){
        await restore(target);
        if(overlay&&!dialog.open&&overlay.opener)document.getElementById(overlay.opener)?.click();
      }
    }finally{replaying=false}
  });
  // In Safari browser tabs the OS already interprets edge swipes. Installed
  // apps use one completed single-finger gesture, never a PDF pan or a drag.
  let touch;
  const standalone=()=>navigator.standalone===true||matchMedia('(display-mode: standalone)').matches;
  document.addEventListener('touchstart',e=>{
    touch=null;
    if(!standalone()||!at||e.touches.length!==1||e.touches[0].clientX>26||window.visualViewport?.scale>1.01)return;
    const sheet=e.target.closest('.sheet');if(sheet&&sheet.scrollWidth>sheet.clientWidth+2)return;
    if(e.target.closest('input,textarea,select,[contenteditable],.check-list,.library-pick,.modal-panel,[data-pick]')||
      !dialog.open&&document.querySelector('.paper.edit,#library-batch:not([hidden]),.pick-row')||String(getSelection()||''))return;
    const t=e.touches[0];touch={x:t.clientX,y:t.clientY,id:t.identifier};
  },{passive:true});
  document.addEventListener('touchmove',e=>{
    if(!touch)return;const t=e.touches[0];
    if(e.touches.length!==1||Math.abs(t.clientY-touch.y)>40||t.clientX<touch.x-8)touch=null;
  },{passive:true});
  document.addEventListener('touchcancel',()=>{touch=null},{passive:true});
  document.addEventListener('touchend',e=>{
    if(!touch)return;const start=touch;touch=null;const t=e.changedTouches[0],dx=t.clientX-start.x;
    if(t.identifier!==start.id||e.touches.length||dx<85||dx<Math.abs(t.clientY-start.y)*2.5||!e.cancelable)return;
    e.preventDefault();back();
  },{passive:false});
  return {step,back,get depth(){return at},get replaying(){return replaying}};
}
