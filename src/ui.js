export const $=(s,root=document)=>root.querySelector(s);
export const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const options=(values,value)=>values.map(x=>'<option '+(x===value?'selected':'')+'>'+esc(x)+'</option>').join('');
export function notice(msg){const el=$('#notice');el.hidden=false;el.textContent=msg;clearTimeout(notice.timer);notice.timer=setTimeout(()=>el.hidden=true,5000)}
export function guard(fn){return async(...args)=>{try{return await fn(...args)}catch(e){notice(e.name==='QuotaExceededError'?'���� ������ �����մϴ�. ������ ����ϰ� ������ Ȯ���ϼ���.':e.message||'�۾��� �����߽��ϴ�.');console.error(e)}}}
export function modal(html){const d=$('#modal');d.querySelector('section').innerHTML=html;if(!d.open)d.showModal();return d.querySelector('section')}
export function pick(accept,multiple=false){return new Promise(resolve=>{const i=document.createElement('input');i.type='file';i.accept=accept;i.multiple=multiple;i.onchange=()=>resolve([...i.files]);i.oncancel=()=>resolve([]);i.click()})}
export const action=(id,label,cls='')=>'<button id="'+id+'" class="'+cls+'">'+label+'</button>';
export function on(id,fn,event='click'){document.getElementById(id)?.addEventListener(event,guard(fn))}
