import {esc,modal,guard,notice} from './ui.js';
import {state,change,exclusive} from './db.js';
import {materialIndex,roles} from './materials.js';
import {diagnostics,confirmCandidates,attachRepair} from './audit-model.js';
import {auditJob,lastAudit,runAudit,repairInput} from './link-audit-job.js';
import {mergeEvidence} from './link-evidence.js';
import {download} from './backup.js';

export async function showAudit(index,subject,refresh,focusId=''){
  const dialog=document.querySelector('#modal');
  let changed=false,report=diagnostics(index,subject),offset=0,controller,selected=new Map(),section;
  let saved=await auditJob(),last=await lastAudit(),message='';
  const key=c=>JSON.stringify([c.paper,c.field,c.id]);
  async function reload(){
    index=materialIndex((await state()).documents);report=diagnostics(index,subject);
    selected.clear();saved=await auditJob();last=await lastAudit();draw();
  }
  const stop=()=>{if(document.hidden)controller?.abort()};
  document.addEventListener('visibilitychange',stop);
  dialog.addEventListener('close',()=>{controller?.abort();document.removeEventListener('visibilitychange',stop);if(changed)guard(refresh)()},{once:true});
  function draw(){
    const stats=report.집계,review=report.시험지별.filter(r=>r.연결검토&&(!focusId||r.문제지ID===focusId));
    offset=Math.min(offset,Math.max(0,Math.ceil(review.length/15)-1)*15);
    const page=review.slice(offset,offset+15),choices=[];
    function item(r){
      return '<article class="box"><strong>'+esc(r.제목)+'</strong>'+roles.map(([kind,field])=>{
        const st=r[kind];if(!['후보 검토','판정 보류'].includes(st.상태))return '';
        return '<p>'+kind+' · '+esc(st.상태)+' · '+esc(st.사유)+'</p>'+st.후보.map(c=>{
          const v={paper:r.문제지ID,field,id:c.id},i=choices.push(v)-1;
          return '<label class="audit-pick"><input type="checkbox" data-proof-pick="'+i+'" '+(selected.has(key(v))?'checked ':'')+(c.선택가능?'':'disabled')+'> '+esc(c.제목)+'<small>'+esc(c.사유)+'</small></label>';
        }).join('');
      }).join('')+'</article>';
    }
    section=modal('<h2>'+esc(subject||'전체 과목')+' 연결 현황</h2><p>등록 문제지 '+stats.문제지+'개 · 중복 후보 '+stats.중복후보쌍+'쌍</p>'+
      '<div class="holdings-scroll"><table><thead><tr><th>자료</th><th>등록 파일</th><th>미연결 파일</th><th>연결된 시험지</th><th>후보 검토</th><th>기기 내 후보 없음</th><th>판정 보류</th><th>연결 해제</th></tr></thead><tbody>'+
      roles.map(([k])=>'<tr><th>'+k+'</th>'+['등록','등록후미연결','연결완료','후보검토','기기내후보없음','판정보류','연결해제'].map(label=>'<td>'+stats[k][label]+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>'+
      '<p class="sub">등록·미연결은 기기의 파일 수입니다. 나머지 열은 문제지 수이며, 한 정답표가 여러 시험지에 연결될 수 있습니다.</p>'+
      '<div class="row"><button id="audit-run">'+(saved?'점검 재개 ('+saved.cursor+' / '+saved.items.length+')':'기존 자료 재점검')+'</button>'+
      '<label class="btn file-picker">연결 정보 적용<input id="audit-repair" type="file" accept=".json,.zip" multiple aria-label="연결 정보 적용"></label>'+
      '<button id="missing-json">누락·연결 진단 JSON 저장</button><button id="missing-copy">수집 요청 복사</button></div>'+
      '<p class="sub">연결 정보 적용은 수집 ZIP의 manifest 또는 연결 복구 JSON을 읽어 기기에 있는 원본과 대조합니다.</p>'+
      (last?'<small>최근 점검 '+esc(new Date(last.date).toLocaleString('ko-KR'))+' · 처리 '+last.total+'개 · PDF 읽기 '+last.read+'개 · 메타데이터·기존 분석 사용 '+last.reused+'개 · 오류 '+last.issues+'개</small>':'')+
      '<p id="audit-note" role="status">'+esc(message)+'</p><div id="copy-fallback"></div>'+
      '<details class="box" '+(focusId||selected.size?'open':'')+' id="audit-review"><summary>문제지별 연결 검토 '+review.length+'개</summary>'+
      (focusId?'<button id="audit-all">모든 문제지 보기</button>':'')+page.map(item).join('')+
      '<div class="row"><button id="audit-apply" '+(!selected.size?'disabled':'')+'>선택 연결 '+selected.size+'건</button>'+
      (offset?'<button id="audit-prev">이전</button>':'')+(offset+15<review.length?'<button id="audit-next">다음</button>':'')+'</div></details>'+
      '<details class="box"><summary>미연결 파일 '+report.미연결자료.length+'개</summary>'+report.미연결자료.slice(0,40).map(r=>'<p>'+esc(r.유형+' · '+r.제목)+'<small>'+esc(r.사유)+'</small></p>').join('')+
      (report.미연결자료.length>40?'<small>전체 목록은 진단 JSON에서 확인하세요.</small>':'')+'</details>'+
      '<details class="box"><summary>중복 문제지 후보 '+stats.중복후보쌍+'쌍</summary>'+report.중복후보.slice(0,40).map(r=>'<p>'+esc(r.titles.join(' / '))+'<small>'+esc([r.reason,...r.booklets.map(v=>v?v+'형':'책형 미상')].join(' · '))+'</small></p>').join('')+
      (stats.중복후보쌍>40?'<small>전체 후보는 진단 JSON에 포함됩니다.</small>':'')+'</details>');
    const at=id=>section.querySelector('#'+id);
    at('audit-run').onclick=guard(async()=>{
      controller=new AbortController();const ac=controller;changed=true;
      const screen=modal('<h2>기존 자료 점검</h2><progress id="audit-progress"></progress><p id="audit-progress-text" role="status"></p><button id="audit-pause">일시중지</button>');
      screen.setAttribute('aria-busy','true');screen.querySelector('button').onclick=()=>ac.abort();
      let tick=0;
      try{
        const finished=await exclusive(()=>runAudit(ac,(n,total,title)=>{
          if(n!==total&&performance.now()-tick<100)return;tick=performance.now();
          const bar=screen.querySelector('progress');bar.max=total||1;bar.value=n;
          screen.querySelector('p').textContent=n+' / '+total+' · '+title;
        }));
        message=finished?'기존 자료 점검을 마쳤습니다.':'점검 위치를 저장했습니다.';
      }finally{controller=null;await reload()}
    });
    at('audit-repair').onchange=guard(async e=>{
      const files=[...e.target.files];e.target.value='';if(!files.length)return;
      const all=new Map();
      for(const file of files)for(const [h,claims] of await repairInput(file))all.set(h,mergeEvidence(all.get(h),claims));
      const snapshot=await state(),matches=new Set(snapshot.documents.filter(d=>!d.deleted&&all.has(d.hash)).map(d=>d.hash));
      if(!matches.size){message='현재 기기에서 대조표와 해시가 일치하는 정답·해설 PDF가 없습니다.';draw();return}
      if(!confirm('기존 파일 '+matches.size+'개의 연결 정보를 적용할까요? 기기에 없는 파일 '+(all.size-matches.size)+'개는 건너뜁니다.'))return;
      let result;await exclusive(()=>change(s=>{result=attachRepair(s,all)}));
      changed=true;message='기기와 일치 '+result.matched+'개 · 연결 정보 갱신 '+result.modified+'개 · 기기에 없는 파일 '+result.absent+'개';await reload();
    });
    at('missing-json').onclick=()=>download(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}),'Yu-study-누락자료.json');
    at('missing-copy').onclick=guard(async()=>{
      const rows=report.누락목록.filter(r=>r.필요자료);
      const request=rows.length?'다음 시험의 기기 내 후보가 없는 자료를 찾아 주세요. 책형을 확인해 주세요.\n'+rows.map(r=>r.제목+' · '+r.필요자료).join('\n'):'기기 내 후보가 없는 자료가 없습니다.';
      try{await navigator.clipboard.writeText(request);notice('수집 요청을 복사했습니다.')}catch{const box=document.createElement('textarea');box.value=request;at('copy-fallback').replaceChildren(box);box.select()}
    });
    at('audit-review').onchange=e=>{
      if(e.target.dataset.proofPick===undefined)return;const c=choices[+e.target.dataset.proofPick];
      if(e.target.checked)selected.set(key(c),c);else selected.delete(key(c));const b=at('audit-apply');b.disabled=!selected.size;b.textContent='선택 연결 '+selected.size+'건';
    };
    at('audit-apply').onclick=guard(async()=>{
      if(!selected.size||!confirm('선택한 연결 '+selected.size+'건을 직접 지정할까요? 과목·회차·책형을 확인하세요.'))return;
      let count;await change(s=>{count=confirmCandidates(s,[...selected.values()])});changed=true;
      message=count+'개 연결을 저장했습니다.';await reload();
    });
    for(const [id,move] of [['audit-prev',-15],['audit-next',15],['audit-all',0]])if(at(id))at(id).onclick=()=>{if(id==='audit-all')focusId='';offset+=move;draw();at('audit-review').open=true};
  }
  draw();
}
