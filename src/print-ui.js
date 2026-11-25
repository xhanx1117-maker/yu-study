import {change} from './db.js';
import {download} from './backup.js';
import {$,esc,on,modal,notice,markModalSaved} from './ui.js';
import {orders} from './notebook-model.js';
import {printSettings,layouts} from './workbook-layout.js';
import {prepareWorkbook,renderArea} from './workbook-source.js';
import {writeWorkbook} from './export.js';
import {openPdf} from './pdf.js';

const toggles={divider:'중앙 구분선',source:'원본 시험 출처',number:'원래 문항 번호',serial:'연속 번호',theme:'교재 테마',bookPage:'교재 페이지',
  sections:'테마별로 묶고 제목 표시',count:'누적 오답 횟수',memo:'개인 메모',answers:'연결된 정답·해설을 부록에 포함'};
function select(id,values,current){
  return '<select id="'+id+'">'+Object.entries(values).map(([key,name])=>'<option value="'+key+'" '+(key===current?'selected':'')+'>'+name+'</option>').join('')+'</select>';
}

export function openPrint(archive,rows,filters,{readFile,saveSettings=true}={}){
  if(!rows.length)return notice('출력할 문항이 없습니다.');
  const opts=printSettings(archive.printSettings),missing=rows.filter(r=>!r.question.regions.length);
  const subjects=[...new Set(rows.map(r=>r.doc.subject).filter(Boolean))];
  const themes=rows.flatMap(r=>r.linked),theme=filters.themeIds?.length===1 && themes.find(t=>t.id===filters.themeIds[0]);
  const group=theme?[theme.number,theme.title].filter(Boolean).join(' '):
    filters.chapter?themes.find(t=>t.chapterId===filters.chapter)?.chapterTitle:
    filters.part?themes.find(t=>t.partId===filters.part)?.partTitle:'';
  const title=[filters.subject||subjects.join('·'),group,'오답 문제집'].filter(Boolean).join(' · ');
  const section=modal('<h2>시험지형 PDF 출력</h2><p><strong>'+esc(title)+'</strong> · '+rows.length+'문항 · A4 세로</p>'+
    '<div class="print-grid"><label>레이아웃'+select('print-mode',layouts,opts.mode)+'</label><label>용지 맞춤 기준 배율 (%)<input id="print-scale" type="number" min="50" max="150" value="'+opts.scale+'"></label></div>'+
    '<details class="print-more"><summary>출력 세부 설정</summary><div class="print-grid"><label>페이지 여백 (mm)<input id="print-margin" type="number" min="5" max="24" value="'+opts.margin+'"></label>'+
    '<label>문항 간격'+select('print-gap',Object.fromEntries([...new Set([2,3,6,opts.gap])].sort((a,b)=>a-b).map(n=>[n,({2:'좁게',3:'기본',6:'넓게'}[n]||'사용자 지정')+' · '+n+' mm'])),String(opts.gap))+'</label><label>정렬'+select('print-order',{current:'현재 목록 순서',...orders},opts.order)+'</label></div>'+
    '<div class="print-checks">'+Object.entries(toggles).map(([k,v])=>'<label><input data-option="'+k+'" type="checkbox" '+(opts[k]?'checked':'')+'> '+v+'</label>').join('')+'</div></details>'+
    (missing.length?'<label class="tick"><input id="skip-missing" type="checkbox"> 영역 미지정 '+missing.length+'문항 제외</label><small>'+esc(missing.slice(0,4).map(r=>r.doc.title+' '+r.question.number+'번').join(', '))+'</small>':'')+
    '<div class="row"><button id="make-proof" class="primary">미리보기 생성</button><button id="stop-print" hidden>생성 취소</button></div>'+
    '<p id="print-status" role="status"></p><progress id="print-meter" hidden></progress><div id="proof-result"></div>',{protectEdits:true});
  const dialog=$('#modal');
  let controller,proof,url,renderController,revision=0,index=1,readyFile;
  function discard(){
    renderController?.abort();renderController=null;
    if(proof){proof.destroy().catch(()=>{});proof=null}
    if(url){URL.revokeObjectURL(url);url=null}readyFile=null;
    const result=$('#proof-result',section);if(result)result.innerHTML='';
  }
  function abort(){revision++;controller?.abort();discard();section.removeEventListener('change',optionChanged)}
  dialog.addEventListener('close',abort,{once:true});
  function optionChanged(){if(readyFile){discard();$('#print-status').textContent='설정이 변경되었습니다. 미리보기를 다시 생성하세요.'}}
  section.addEventListener('change',optionChanged);
  on('stop-print',()=>controller?.abort());
  function busy(active){
    section.setAttribute('aria-busy',String(active));
    section.querySelectorAll('select,input,#make-proof').forEach(el=>el.disabled=active);
    $('#stop-print').hidden=!active;$('#print-meter').hidden=!active;
  }
  function progress(label,n,total){$('#print-status').textContent=label+' · '+n+' / '+total;const m=$('#print-meter');m.max=Math.max(1,total);m.value=n}
  async function display(){
    const doc=proof,which=index;
    if(!doc)return;
    renderController?.abort();const rendering=new AbortController();renderController=rendering;
    try{
      const p=await doc.getPage(which),canvas=await renderArea(p,{x:0,y:0,w:1,h:1},1.4,rendering.signal,1300000);
      if(proof!==doc || index!==which || !dialog.open){canvas.width=canvas.height=1;return}
      $('#proof-canvas').replaceChildren(canvas);$('#proof-page').textContent=which+' / '+doc.numPages;
      $('#proof-prev').disabled=which===1;$('#proof-next').disabled=which===doc.numPages;p.cleanup();
    }catch(error){if(!rendering.signal.aborted)throw error}
  }
  on('make-proof',async()=>{
    discard();
    const fields=['scale','margin','gap'];
    if(fields.some(k=>!$('#print-'+k).reportValidity()||!$('#print-'+k).value))return;
    if(missing.length&&!$('#skip-missing').checked){$('#print-status').textContent='미지정 문항을 제외하거나 원본에서 영역을 지정하세요.';return}
    const targets=rows.filter(r=>r.question.regions.length);
    if(!targets.length){$('#print-status').textContent='출력 가능한 문항 영역이 없습니다.';return}
    const selected={settingsVersion:2,mode:$('#print-mode').value,order:$('#print-order').value};
    for(const key of fields)selected[key]=Number($('#print-'+key).value);
    section.querySelectorAll('[data-option]').forEach(el=>{selected[el.dataset.option]=el.checked});
    const token=++revision;controller=new AbortController();const signal=controller.signal;busy(true);
    try{
      const book=await prepareWorkbook(archive,targets,filters,selected,signal,progress,readFile);
      const {file}=await writeWorkbook(book,title,signal,progress,readFile);signal.throwIfAborted();
      proof=await openPdf(file);if(signal.aborted){discard();return}
      readyFile=file;url=URL.createObjectURL(file);index=1;
      $('#proof-result').innerHTML='<div class="row"><button id="proof-prev">이전 쪽</button><span id="proof-page"></span><button id="proof-next">다음 쪽</button></div>'+
        '<div id="proof-canvas" class="proof"></div><div class="row"><button id="pdfsave" class="primary">PDF 파일 저장</button><button id="pdfshare">공유</button><a class="btn" id="pdfpreview" rel="noopener" target="_blank">PDF 크게 열기</a></div>';
      $('#pdfpreview').href=url;on('pdfsave',()=>download(file,file.name));on('pdfshare',async()=>{if(navigator.canShare?.({files:[file]}))await navigator.share({files:[file]});else download(file,file.name)});
      on('proof-prev',()=>{index=Math.max(1,index-1);return display()});on('proof-next',()=>{index=Math.min(proof.numPages,index+1);return display()});
      await display();signal.throwIfAborted();
      if(saveSettings){await change(s=>{s.printSettings=selected});archive.printSettings=selected}
      markModalSaved();
      if(token===revision)$('#print-status').textContent=book.questionCount+'문항 · '+book.plan.pages.length+'쪽';
    }catch(error){if(token===revision){discard();$('#print-status').textContent=signal.aborted?'출력을 취소했습니다.':error.message}}
    finally{if(token===revision)busy(false)}
  });
}
