import {get,state} from './db.js';
import {subjects} from './model.js';
import {detect,openPdf} from './pdf.js';
import {openPrint} from './print-ui.js';
import {$,esc,modal,on,pick} from './ui.js';

const filename=name=>String(name||'').normalize('NFC').replace(/\s*\(\d+\)(?=\.pdf$)/i,'').toLocaleLowerCase();

export async function openSample(fragment){
  const query=new URLSearchParams(fragment.slice('#sample?'.length));
  const name=query.get('file'),subject=query.get('subject')||'',numbers=[...new Set((query.get('questions')||'').split(',').map(Number))];
  if(!name||name.length>240||!subjects.includes(subject)||!numbers.length||numbers.length>300||
      numbers.some(n=>!Number.isInteger(n)||n<1||n>300))throw Error('샘플의 과목, 원본 파일명과 문항 번호를 확인하세요.');
  const archive=await state(),matches=archive.documents.filter(d=>!d.deleted&&filename(d.filename)===filename(name));
  const section=modal('<h2>시험지형 샘플 PDF</h2><p>'+esc(subject+' · '+numbers.map(n=>n+'번').join(', '))+'</p>'+
    '<p class="sub">원본 '+esc(name)+'</p>'+
    (matches.length?'<label>기기에 등록된 원본<select id="sample-source">'+matches.map((d,i)=>'<option value="'+i+'">'+esc([d.year,d.exam,d.title].filter(Boolean).join(' · '))+'</option>').join('')+'</select></label><button id="sample-local" class="primary">등록된 원본으로 생성</button>':'')+
    '<button id="sample-file">파일 앱에서 원본 선택</button><p id="sample-status" role="status"></p><button id="sample-cancel" hidden>분석 취소</button>');
  const dialog=$('#modal');
  const controller=new AbortController(),{signal}=controller;
  dialog.addEventListener('close',()=>controller.abort(),{once:true});
  on('sample-cancel',()=>{controller.abort();dialog.close()});
  async function generate(blob,doc){
    if(!blob)throw Error('원본 PDF를 찾을 수 없습니다. 파일 앱에서 선택하세요.');
    const status=$('#sample-status',section);
    section.setAttribute('aria-busy','true');$('#sample-cancel',section).hidden=false;
    section.querySelectorAll('select,#sample-local,#sample-file').forEach(el=>el.disabled=true);
    status.textContent='원본에서 문항을 찾고 있습니다.';
    let pdf;
    try{
      pdf=await openPdf(blob);signal.throwIfAborted();
      const found=await detect(pdf,Math.max(doc.count||300,...numbers),{signal,progress:(label,n,total)=>{status.textContent=label+' · '+n+' / '+total}});
      const missing=numbers.filter(n=>!found[n]?.regions.length);
      if(missing.length)throw Error(missing.join(', ')+'번을 찾지 못했습니다. 시험지를 확인하거나 오답노트에서 영역을 직접 지정하세요.');
      const source={...doc,id:'sample',hash:'sample',subject,detected:found};
      const rows=numbers.map(n=>{
        const question={id:'sample#'+n,doc:'sample',number:n,...found[n],secondary:[],memo:'',status:'미복습'};
        return {id:question.id,doc:source,question,linked:[],events:[],count:0,latest:''};
      });
      openPrint({documents:[source]},rows,{subject,themeIds:[]},{readFile:async()=>blob,saveSettings:false});
      $('#make-proof').click();
    }catch(error){if(!signal.aborted)status.textContent=error.message}
    finally{
      if(pdf)await pdf.destroy();
      section.removeAttribute('aria-busy');$('#sample-cancel',section).hidden=true;
      section.querySelectorAll('select,#sample-local,#sample-file').forEach(el=>el.disabled=false);
    }
  }
  on('sample-local',async()=>{const doc=matches[Number($('#sample-source',section).value)];await generate(await get('files',doc.hash),doc)});
  on('sample-file',async()=>{
    const [file]=await pick('.pdf,application/pdf');
    if(file && !signal.aborted)await generate(file,{title:file.name.replace(/\.pdf$/i,''),year:query.get('year')||'',exam:query.get('exam')||''});
  });
}
