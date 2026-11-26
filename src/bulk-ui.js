import {$,esc,modal,notice,guard} from './ui.js';
import {state,exclusive} from './db.js';
import {materialKind} from './materials.js';
import {discover,currentJob,jobRows,startJob,saveJob,preview,summary,register,analyse,finishJob} from './bulk-import.js';

const mb=n=>(n/1048576).toFixed(1)+' MB';
const btn=(id,label,primary=false)=>'<button id="'+id+'"'+(primary?' class="primary"':'')+'>'+label+'</button>';
const fileControl=(id,label,accept,folder=false)=>'<label class="btn file-picker">'+label+'<input type="file" id="'+id+'" aria-label="'+label+'" accept="'+accept+'" multiple '+(folder?'webkitdirectory':'')+'></label>';
export async function importMenu({refresh,restore,manual},initialFiles){
  const dialog=$('#modal');
  let job=await currentJob(),rows=job?await jobRows(job):[],sources=new Map(),busy=false,control,section,changed=false,lastDraw=0;
  if(job?.phase==='done'&&!rows.some(r=>['failed','ready','pending'].includes(r.status))){await exclusive(()=>finishJob(job));job=null;rows=[]}
  const queued=(await state()).documents.filter(d=>!d.deleted&&['queued','error'].includes(d.analysisState)).length;
  const folderSupported='webkitdirectory' in document.createElement('input');
  function bind(id,fn,event='click'){section.querySelector('#'+id)?.addEventListener(event,guard(fn))}
  function show(html){section=modal('<h2>자료 가져오기</h2>'+html);section.setAttribute('aria-busy',String(busy))}
  function closed(){
    control?.abort?.();sources.clear();
    if(changed){const kinds=new Set(rows.filter(r=>r.status==='registered'&&r.info).map(r=>materialKind(r.info)));guard(refresh)(kinds.size===1?[...kinds][0]:'문제지')}
  }
  dialog.addEventListener('close',closed,{once:true});
  function buttons(){
    return '<div class="row">'+fileControl('bulk-files','PDF·ZIP 선택','.pdf,.zip,application/pdf,application/zip')+
      (folderSupported?fileControl('bulk-folder','폴더 선택','',true):'')+'</div><p class="sub">하위 폴더의 PDF도 함께 찾습니다. 폴더 선택을 지원하지 않는 기기에서는 ZIP을 선택하세요.</p>';
  }
  async function choose(inputs){
    if(!inputs?.length)return;
    await running(async()=>{
      progressView('ZIP 목록 읽는 중');
      const input=await discover(inputs);
      if(job){
        const before=rows.length;sources=input.sources;
        const targets=rows.filter(r=>r.status==='pending'||r.status==='failed');
        if(targets.length&&!targets.some(r=>sources.has(r.id)))throw Error('이 작업에서 선택했던 원본 파일이나 ZIP을 다시 선택하세요.');
        if(!before)throw Error('작업 목록이 비어 있습니다.');
      }else{
        if(!input.sources.size)throw Error(input.problems.join('\n')||'선택한 항목 안에 PDF가 없습니다.');
        job=await startJob(input);sources=input.sources;rows=await jobRows(job);
      }
      const estimate=await navigator.storage?.estimate?.().catch(()=>null);
      if(estimate?.quota&&input.total>estimate.quota-estimate.usage)notice('예상 저장 한도가 작습니다. 중복 검사 후 남는 파일은 공간을 확보하고 재시도할 수 있습니다.');
      if(rows.some(r=>r.status==='pending'))await inspect(false);
      else if(rows.some(r=>r.status==='failed'))await inspect(true);
    });
  }
  function bindInputs(){for(const id of ['bulk-files','bulk-folder'])bind(id,e=>choose([...e.target.files]),'change')}
  function start(){
    show(buttons()+'<hr><div class="row">'+btn('manual-one','PDF 정보 직접 입력')+btn('restore-archive','전체 백업 복원')+(queued?btn('resume-scans','저장된 문항 분석 · '+queued):'')+'</div><p class="sub">전체 백업 복원은 Yu: study에서 만든 백업 ZIP을 사용합니다.</p>');
    bind('resume-scans',()=>running(async()=>{progressView('저장된 원본 문항 분석');await analyse(null,control,(d,i,total)=>paint('문항 분석',d.title,i,total),{retry:true});changed=true;dialog.close()}));
    bindInputs();bind('manual-one',manual);bind('restore-archive',restore);
  }
  function progressView(title){
    lastDraw=-Infinity;
    show('<p id="bulk-step" role="status">'+esc(title)+'</p><progress id="bulk-meter"></progress><p id="bulk-file"></p><p class="sub" id="bulk-numbers"></p>'+
      btn('bulk-pause','일시중지')+'<p class="sub">화면을 벗어나면 진행한 항목까지 저장합니다.</p>');
    bind('bulk-pause',()=>{control.abort();$('#bulk-pause').disabled=true;$('#bulk-step').textContent='현재 처리한 파일을 정리하고 있습니다…'});
  }
  function paint(label,path,done,total,detail='',force=false){
    if(!force&&performance.now()-lastDraw<95&&done<total)return;
    lastDraw=performance.now();$('#bulk-step').textContent=label;$('#bulk-file').textContent=path;
    $('#bulk-numbers').textContent=detail;$('#bulk-meter').max=total||1;$('#bulk-meter').value=done;
  }
  async function running(fn){
    if(busy)return;
    const controller=new AbortController();
    control={pause:false,signal:controller.signal,abort(){this.pause=true;controller.abort()}};
    const hide=()=>{if(document.hidden)control.abort()};
    busy=true;document.addEventListener('visibilitychange',hide);
    try{await exclusive(async()=>{
      const live=await currentJob(),stale=live?.id!==job?.id;
      job=live;rows=job?await jobRows(job):[];
      if(stale){sources.clear();throw Error('다른 창에서 가져오기 작업을 변경했습니다. 현재 목록을 확인하세요.')}
      await fn();
    })}
    catch(e){notice(e.message||'가져오기를 마칠 수 없습니다.');if(job)job=await currentJob()}
    finally{
      busy=false;document.removeEventListener('visibilitychange',hide);
      if(dialog.open){if(job){rows=await jobRows(job);await overview()}else start()}
    }
  }
  async function inspect(retry){
    progressView(retry?'실패한 파일 다시 검사':'PDF 자동 분류 및 중복 검사');
    const total=rows.length;
    await preview(job,rows,sources,control,row=>{
      if(performance.now()-lastDraw<95)return;const sum=summary(rows);
      paint('원본 확인 · '+(total-sum.pending)+' / '+total,row.path,total-sum.pending,total,'신규 '+sum.ready+' · 중복 '+sum.duplicate+' · 실패 '+sum.failed);
    },retry);
    if(!rows.some(r=>r.status==='pending')&&job.phase==='preview'){job.phase='review';await saveJob(job)}
  }
  async function analyseSaved(retry=false){
    progressView('저장 완료 · 문항 영역 분석');changed=true;
    const done=await analyse(job,control,(doc,i,total,page,pages)=>paint('문항 분석 '+(i+1)+' / '+total,doc.title,i,total,page?'PDF '+page+' / '+pages+'쪽':''),{retry});
    if(done){job.phase='done';await saveJob(job)}
  }
  async function commit(){
    await running(async()=>{
      const duplicates=rows.filter(r=>r.status==='duplicate').length;
      if(!job.options.skip&&duplicates&&!confirm('동일한 PDF '+duplicates+'개는 기존 자료와 기록을 유지합니다. 신규 파일만 등록할까요?'))return;
      progressView('기기에 등록 중');
      await register(job,rows,control,row=>{
        changed=true;const s=summary(rows);paint('기기에 등록 중',row.path,s.registered+s.duplicate+s.failed,rows.length,'등록 '+s.registered+' · 중복 '+s.duplicate+' · 실패 '+s.failed);
      });
      if(!control.pause&&job.phase==='analysis')await analyseSaved();
    });
  }
  async function overview(){
    const s=summary(rows),opts=job.options,docs=(await state()).documents.filter(d=>d.importId===job.id&&!d.deleted);
    const scanErrors=docs.filter(d=>d.analysisState==='error'),scanQueue=docs.filter(d=>d.analysisState==='queued'),manual=docs.filter(d=>d.analysisState==='manual').length,done=docs.filter(d=>d.scanned&&d.analysisState!=='manual').length;
    const checkbox=(key,label)=>'<label><input type="checkbox" data-bulk-option="'+key+'" '+(opts[key]?'checked':'')+'> '+label+'</label>';
    const describe=m=>[...m].map(([k,v])=>k+' '+v+'개').join(' · ')||'—';
    const failures=rows.filter(r=>r.error),reviews=rows.filter(r=>r.info?.reviewReasons?.length&&['ready','registered'].includes(r.status)),missing=rows.some(r=>(r.status==='pending'||r.status==='failed')&&!sources.has(r.id));
    const count='발견 '+rows.length+'개 · 신규 '+s.ready+' · 등록 '+s.registered+' · 중복 '+s.duplicate+' · 실패 '+s.failed;
    show('<p id="bulk-counts">'+count+'</p><p>시험지 '+s.papers+' · 정답지 '+s.keys+' · 해설지 '+s.solutions+' · 분류 검토 '+s.review+' · 예상 신규 원본 '+mb(s.bytes)+'</p>'+
      '<p class="sub">'+esc(describe(s.subjects))+'<br>'+esc(describe(s.years))+'</p>'+
      (reviews.length?'<details class="box"><summary>분류 검토 '+reviews.length+'개</summary><ul>'+reviews.slice(0,50).map(r=>'<li>'+esc(r.path)+' · '+esc(r.info.reviewReasons.join(' · '))+'</li>').join('')+'</ul>'+(reviews.length>50?'처음 50개를 표시합니다. 자료실에서 전체를 검토할 수 있습니다.':'')+'</details>':'')+
      (s.pending?'<p>원본 확인 대기 '+s.pending+'개</p>':'')+
      (missing?'<p>보류된 파일을 처리하려면 같은 원본을 다시 선택하세요.</p>'+buttons():'')+
      (s.ready||s.pending?'<details class="box"><summary>가져오기 설정</summary>'+checkbox('skip','동일 파일 자동 건너뛰기')+checkbox('classify','과목·연도 자동 분류')+checkbox('link','정답지·해설지 자동 연결')+checkbox('analyse','저장 후 문항 영역 분석')+'</details>':'')+
      (!opts.skip&&s.duplicate?'<details class="box" open><summary>동일 원본 '+s.duplicate+'개 · 기존 자료 유지</summary>'+esc(rows.filter(r=>r.status==='duplicate').slice(0,40).map(r=>r.path).join(' · '))+'</details>':'')+
      (failures.length||job.problems.length?'<details class="box"><summary>가져오기 오류</summary><ul>'+[...job.problems,...failures.map(r=>r.path+' · '+r.error)].slice(0,100).map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul></details>':'')+
      (docs.length?'<p id="scan-counts">문항 분석 완료 '+done+' · 대기 '+scanQueue.length+' · 직접 영역 확인 '+manual+' · 분석 오류 '+scanErrors.length+'</p>':'')+
      '<div class="row">'+(s.pending&&sources.size?btn('bulk-preview','미리보기 재개'):'')+
      (s.ready?btn('bulk-register','일괄 등록 · '+s.ready+'개',true):'')+(s.failed&&sources.size?btn('bulk-retry','실패한 파일만 재시도'):'')+
      (scanQueue.length||scanErrors.length?btn('bulk-analyse','문항 분석 재개'):'')+
      (s.registered?btn('bulk-library','자료실 열기'):'')+btn('bulk-finish',s.ready||s.pending?'이 가져오기 중단':'작업 마치기')+'</div>');
    bindInputs();
    for(const el of section.querySelectorAll('[data-bulk-option]'))el.onchange=guard(async()=>{
      const {bulkOption}=el.dataset,value=el.checked,wasOpen=el.closest('details').open;
      section.querySelectorAll('button,input').forEach(input=>{input.disabled=true});
      try{await exclusive(async()=>{
        const live=await currentJob();if(live?.id!==job.id)throw Error('다른 창에서 가져오기를 종료했습니다.');
        live.options[bulkOption]=value;await saveJob(live);job=live;
      })}finally{
        job=await currentJob();
        if(dialog.open&&job){rows=await jobRows(job);await overview();const setting=section.querySelector('[data-bulk-option]');if(setting)setting.closest('details').open=wasOpen}
        else if(dialog.open)start();
      }
    });
    bind('bulk-preview',()=>running(()=>inspect(false)));bind('bulk-retry',()=>running(()=>inspect(true)));
    bind('bulk-register',commit);bind('bulk-analyse',()=>running(()=>analyseSaved(scanErrors.length>0)));
    bind('bulk-library',async()=>{
      if(job.phase==='done'&&!s.failed&&!s.ready&&!s.pending&&!scanErrors.length)await exclusive(()=>finishJob(job));
      changed=true;dialog.close();
    });
    bind('bulk-finish',async()=>{
      if((s.ready||s.pending||scanQueue.length||s.failed)&&!confirm('이 작업의 대기 목록과 임시 PDF를 정리할까요? 이미 등록한 원본과 오답은 보존됩니다.'))return;
      await exclusive(()=>finishJob(job));job=null;sources.clear();if(s.registered){changed=true;dialog.close()}else start();
    });
  }
  if(job)await overview();else start();
  if(initialFiles?.length)await choose(initialFiles);
}
