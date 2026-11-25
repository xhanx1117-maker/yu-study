import {get,exclusive} from './db.js';
import {spaceStats} from './library-ui.js';
import {cleanRestoreStage} from './backup.js';
import {action,esc,guard,notice,modal} from './ui.js';

const size=n=>n<1048576?Math.round(n/1024)+' KB':(n/1048576).toFixed(1)+' MB';
export function storageTools(app,s){
  const area=document.createElement('div');app.append(area);
  area.innerHTML='<details class="box"><summary>저장 공간 관리</summary><p role="status">계산 중…</p>'+action('clean-temporary','임시 캐시 정리')+'</details><h2>앱 업데이트</h2><div class="row">'+action('check-update','최신 버전 확인')+action('apply-update','업데이트 적용')+'</div><p class="sub" id="update-result"></p>';
  const details=area.querySelector('details');let measured=false;
  async function measure(){
    if(!details.open||measured)return;measured=true;
    const {byHash,bySubject,bytes,keyBytes,unknown}=spaceStats(s);let total=bytes,answers=keyBytes,unavailable=0;
    if(unknown)for(const d of byHash.values())if(!Number.isFinite(d.size)){
      const blob=await get('files',d.hash);if(!blob){unavailable++;continue}
      total+=blob.size;bySubject.set(d.subject,(bySubject.get(d.subject)||0)+blob.size);if(d.type==='정답지')answers+=blob.size;
    }
    const estimate=await navigator.storage?.estimate?.().catch(()=>null);
    const pending=await get('meta','bulk:active');
    let staged=0;if(pending){
      const {jobRows}=await import('./bulk-import.js');for(const row of await jobRows(pending))if(row.status==='ready'&&!byHash.has(row.hash))staged+=row.size;
    }
    const {printCacheSize}=await import('./workbook-source.js');
    const meta=new Blob([JSON.stringify(s)]).size+s.documents.reduce((n,d)=>n+(d.externalRegions?d.analysisBytes||0:0),0);
    details.querySelector('p').innerHTML='등록 원본 '+byHash.size+'개 · '+size(total)+(unavailable?' · 크기 확인 불가 '+unavailable+'개':'')+'<br>'+[...bySubject].map(([sub,n])=>esc(sub)+' '+size(n)).join(' · ')+
      '<br>정답지 '+size(answers)+' · 오답·메타데이터 약 '+size(meta)+'<br>가져오기 임시 원본 '+size(staged)+' · 저장된 썸네일 0 KB · 메모리의 인쇄 좌표 '+printCacheSize()+'건<br>브라우저 추정 사용량 '+(estimate?size(estimate.usage):'확인 불가')+
      ' / 추정 한도 '+(estimate?.quota?size(estimate.quota):'확인 불가')+'<br>최근 백업 '+esc(s.lastBackup?.slice(0,10)||'아직 없음');
  }
  details.ontoggle=guard(measure);
  area.querySelector('#clean-temporary').onclick=guard(async()=>{
    const {clearPrintCache}=await import('./workbook-source.js');clearPrintCache();await exclusive(cleanRestoreStage);
    measured=false;await measure();
    notice('임시 계산 캐시를 정리했습니다. 진행 중인 가져오기와 오프라인 앱 파일은 유지됩니다.');
  });
  const result=area.querySelector('#update-result');
  async function check(){
    if(!('serviceWorker' in navigator))throw Error('이 환경에서는 오프라인 앱 업데이트를 지원하지 않습니다.');
    const reg=await navigator.serviceWorker.getRegistration();if(!reg)throw Error('오프라인 앱을 준비 중입니다.');
    await reg.update();const installing=reg.installing;
    if(installing)await new Promise(resolve=>{function onState(){if(['installed','activated','redundant'].includes(installing.state)){installing.removeEventListener('statechange',onState);resolve()}}installing.addEventListener('statechange',onState);onState()});
    result.textContent=reg.waiting?'업데이트가 준비되었습니다.':'현재 배포 버전을 사용 중입니다.';return reg;
  }
  area.querySelector('#check-update').onclick=guard(check);
  area.querySelector('#apply-update').onclick=guard(async()=>{
    const reg=await check();if(!reg.waiting)return;
    if(!confirm('저장된 학습 자료를 유지하고 앱을 새 버전으로 다시 열까요?'))return;
    const worker=reg.waiting;if(!worker)return;
    const channel=new MessageChannel();
    function finish(message){
      clearTimeout(timer);worker.removeEventListener('statechange',onState);channel.port1.close();
      if(message)result.textContent=message;
    }
    function onState(){
      if(worker.state==='activated'){finish();location.reload()}
      else if(worker.state==='redundant')finish('업데이트를 다시 확인하세요.');
    }
    const timer=setTimeout(()=>finish('열려 있는 Yu: study 창을 모두 닫았다가 다시 열어 주세요.'),12000);
    worker.addEventListener('statechange',onState);
    channel.port1.onmessage=e=>{if(!e.data.applied)finish('다른 Yu: study 창을 닫고 다시 적용하세요.');else onState()};
    worker.postMessage({type:'APPLY_UPDATE'},[channel.port2]);
  });
}
