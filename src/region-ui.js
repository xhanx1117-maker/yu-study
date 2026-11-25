import {get,change} from './db.js';
import {detect,openPdf,paint} from './pdf.js';
import {regionRecord,regionStamp,protectedRegion,applyRegionChanges} from './region-records.js';
import {$,esc,modal,notice,on,guard} from './ui.js';

export async function compareRegions(rows,{refresh,openOriginal}){
  if(!rows.length)return;
  const section=modal('<h2>문항 영역 재분석</h2><p id="region-status" role="status">원본 PDF를 확인하고 있습니다.</p>'+
    '<button id="region-stop">분석 취소</button><div id="region-review"></div>');
  const dialog=$('#modal'),controller=new AbortController(),{signal}=controller;
  let current=0,revision=0;
  dialog.addEventListener('close',()=>{controller.abort();revision++},{once:true});
  on('region-stop',()=>{controller.abort();dialog.close()});
  const groups=new Map(),entries=rows.map(row=>{
    const prior=regionRecord(row.doc,row.question);
    const entry={row,prior,selected:false,protected:protectedRegion(prior),stamp:regionStamp(prior)};
    if(!groups.has(row.doc.id))groups.set(row.doc.id,[]);
    groups.get(row.doc.id).push(entry);
    return entry;
  });
  function status(text){$('#region-status',section).textContent=text}
  section.setAttribute('aria-busy','true');
  try{
    for(const group of groups.values()){
      signal.throwIfAborted();const doc=group[0].row.doc,pdf=await openPdf(await get('files',doc.hash));
      try{
        const map=await detect(pdf,doc.count,{signal,progress:(label,n,total)=>status(doc.title+' · '+label+' '+n+'/'+total)});
        for(const entry of group){entry.next=map[entry.row.question.number];entry.selected=!entry.protected && !!entry.next?.regions.length}
      }finally{await pdf.destroy()}
    }
  }catch(error){if(!signal.aborted)status(error.message);return}
  finally{section.removeAttribute('aria-busy');if(!signal.aborted)$('#region-stop',section).hidden=true}
  if(signal.aborted)return;
  status('기존 영역과 새 영역을 비교한 뒤 적용할 문항을 고르세요.');
  const review=$('#region-review',section);
  review.innerHTML='<label>비교할 문항<select id="region-which">'+entries.map((e,i)=>'<option value="'+i+'">'+esc(e.row.doc.title+' · '+e.row.question.number+'번')+'</option>').join('')+'</select></label>'+
    '<div class="region-comparison"><div><strong>기존 영역</strong><div class="crops" id="region-old"></div></div>'+
    '<div><strong>새 자동 영역</strong><div class="crops" id="region-new"></div></div></div>'+
    '<p id="region-message"></p><label class="tick"><input type="checkbox" id="region-pick"> 이 문항에 새 영역 적용</label>'+
    '<div class="row"><button id="region-manual">원본에서 직접 수정</button><button id="region-apply" class="primary"></button></div>';
  function count(){
    const n=entries.filter(e=>e.selected).length;
    $('#region-apply',review).textContent='선택 '+n+'문항 적용';$('#region-apply',review).disabled=!n;
  }
  async function show(){
    const version=++revision,entry=entries[current],{row}=entry;
    const pick=$('#region-pick',review);pick.disabled=entry.protected||!entry.next?.regions.length;pick.checked=entry.selected;
    $('#region-message',review).textContent=entry.protected?'수동으로 검수한 영역입니다. 변경하려면 원본에서 직접 수정하세요.':entry.next?.regions.length?'':'자동으로 찾지 못했습니다. 원본에서 직접 지정할 수 있습니다.';
    count();
    const panels=[$('#region-old',review),$('#region-new',review)];
    panels.forEach(el=>el.replaceChildren());
    const pdf=await openPdf(await get('files',row.doc.hash));
    try{
      for(const [idx,record] of [entry.prior,entry.next].entries()){
        if(!record?.regions?.length){panels[idx].textContent='지정된 영역 없음';continue}
        for(const area of record.regions){
          if(signal.aborted || revision!==version)return;
          const canvas=document.createElement('canvas');await paint(pdf,area.page,canvas,760,area);
          if(signal.aborted || revision!==version){canvas.width=canvas.height=1;return}
          canvas.setAttribute('aria-label',area.page+'쪽 문항 영역');panels[idx].append(canvas);
        }
      }
    }finally{await pdf.destroy()}
  }
  on('region-which',e=>{current=Number(e.target.value);return show()},'change');
  on('region-pick',e=>{entries[current].selected=e.target.checked;count()},'change');
  on('region-manual',()=>{const {row}=entries[current];dialog.close();return openOriginal(row.doc.id,row.question.number)});
  on('region-apply',async()=>{
    const selected=entries.filter(e=>e.selected);
    await change(s=>{applyRegionChanges(s,selected.map(({row,next,stamp})=>({docId:row.doc.id,id:row.id,hash:row.doc.hash,next,stamp})))});
    dialog.close();await refresh();notice(selected.length+'문항의 자동 영역을 적용했습니다.');
  });
  await guard(show)();
}
