export const $=(s,root=document)=>root.querySelector(s);
export const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const options=(values,value)=>values.map(x=>'<option '+(x===value?'selected':'')+'>'+esc(x)+'</option>').join('');
export function notice(msg){const el=$('#notice');el.hidden=false;el.textContent=msg;clearTimeout(notice.timer);notice.timer=setTimeout(()=>el.hidden=true,5000)}
export function guard(fn){return async(...args)=>{try{return await fn(...args)}catch(e){notice(e.name==='QuotaExceededError'?'저장 공간이 부족합니다. 파일을 백업하고 공간을 확보하세요.':e.message||'작업에 실패했습니다.');console.error(e)}}}
export function modal(html){const d=$('#modal');d.querySelector('section').innerHTML=html;if(!d.open)d.showModal();return d.querySelector('section')}
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
