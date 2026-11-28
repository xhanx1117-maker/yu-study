import {identity,timeKeys,conflict,subjectName} from './exam-identity.js';
import {evidenceConflict} from './link-evidence.js';
import {subjects} from './model.js';

export const kinds=['문제지','정답지','해설지'];
export const mixedType='문제·해설 혼합';
export const lawFlags=['법령 개정 검토 필요','판례 변경 검토 필요','과거 정답 확인 필요','검토 완료'];
export const storedType=kind=>kind==='문제지'?'기출문제지':kind;
export function materialKind(doc){
  if(!doc.type||['기출문제지','기출문제','시험지','문제지','모의고사'].includes(doc.type))return '문제지';
  if(doc.type==='정답지')return '정답지';
  if(/해설|풀이집/.test(doc.type))return '해설지';
  return '기타 자료';
}
export function coversSubject(d,subject){
  return !subject||subjectName(d.subject)===subjectName(subject)||d.linkEvidence?.some(e=>e.subject===subject)||
    d.combined&&subjects.includes(subject)&&(!d.answerSubjects?.length||d.answerSubjects.includes(subject));
}
export function answerLabel(d){
  if(d.authority==='비공식')return '비공식 정답'+(d.answerEdition?' · '+d.answerEdition:'');
  if(d.answerEdition==='잠정')return '가답안';
  if(d.answerEdition==='최종')return d.authority==='공식'?'공식 최종 정답':'최종 정답 · 출처 미확인';
  return d.authority==='공식'?'공식 정답 · 판본 미확인':'출처·판본 미확인';
}
function priority(d){
  if(d.authority==='공식'&&d.answerEdition==='최종')return 4;
  if(d.authority==='비공식')return 0;
  if(d.answerEdition==='최종')return 3;
  if(d.authority==='공식')return 2;
  return d.answerEdition==='잠정'?1:0;
}
const count=d=>d.countKnown||d.countLocked?Number(d.count):0;
function append(map,key,value){const items=map.get(key);if(items)items.push(value);else map.set(key,[value])}
const displayOrder=(a,b)=>priority(b)-priority(a)||String(a.title||'').localeCompare(b.title||'','ko')||String(a.id).localeCompare(b.id);
export const roles=[['정답지','answers','answerIds'],['해설지','solutions','solutionIds']];
const dimensions=['grade','round','date','recruitmentYear','rank','cohort','schedule'];
const blocking=d=>(d.reviewReasons||[]).find(r=>!/^(중복 후보|텍스트 없는 PDF|분류 정보 부족$)/.test(r));
const scope=(sub,exam,time,kind)=>[sub,exam,time,kind].join('|');
function missingDimension(a,b){
  const labels=['급수','회차','시행일','선발연도','계급','기수','채용 구분'];
  for(const [n,key] of dimensions.entries())if(a[key]!==b[key]){
    if(key==='recruitmentYear'&&a.cohort&&a.cohort===b.cohort)continue;
    if(key==='schedule'&&[a[key],b[key]].every(x=>!x||x==='정규'))continue;
    return labels[n]+' 대조 필요';
  }
  return '';
}
export function materialIndex(documents){
  const byId=new Map(),ids=new Map(),broad=new Map(),proofs=new Map(),papers=new Map(),unidentified=new Map();
  const groups=new Map(),parents=new Map();
  for(const d of documents){
    if(d.deleted)continue;
    byId.set(d.id,d);const id=identity(d),kind=materialKind(d);ids.set(d.id,id);
    if(kind==='문제지'){
      for(const t of timeKeys(id))append(papers,scope(id.subject,id.exam,t,id.forms[0]||''),d);
      continue;
    }
    if(!['정답지','해설지'].includes(kind))continue;
    for(const e of d.linkEvidence||[])if(e.kind===kind)append(proofs,e.paper,{d,e});
    if(d.linkEvidence?.length)continue;
    const subs=subjects.filter(sub=>coversSubject(d,sub));
    if(!id.exam||!timeKeys(id).length||!subs.length){
      for(const sub of subs.length?subs:subjects)append(unidentified,sub+'|'+kind,d);
    }
    for(const sub of subs)for(const t of timeKeys(id))append(broad,scope(sub,id.exam,t,kind),d);
  }
  for(const p of byId.values()){
    if(materialKind(p)!=='문제지')continue;
    const a=ids.get(p.id),times=timeKeys(a),group={paper:p,answers:[],solutions:[],review:false,candidates:[],status:{}};
    groups.set(p.id,group);
    for(const [kind,field,choice] of roles){
      const manual=p[choice]??(kind==='정답지'&&p.answerId?[p.answerId]:undefined);
      const candidates=new Map(),verified=new Set(),exact=[];
      function candidate(d,reason,ok=true){
        const prev=candidates.get(d.id);
        if(!prev||!ok)candidates.set(d.id,{id:d.id,reason,selectable:ok});
      }
      const peerBucket=new Set(times.flatMap(t=>papers.get(scope(a.subject,a.exam,t,a.forms[0]||''))||[]));
      let hasPeer;
      function ambiguousPeer(){
        if(hasPeer===undefined)hasPeer=[...peerBucket].some(q=>q.id!==p.id&&!conflict(a,ids.get(q.id))&&(!count(q)||!count(p)||count(q)===count(p)));
        return hasPeer;
      }
      for(const {d,e} of proofs.get(p.hash)||[]){
        if(e.kind!==kind)continue;
        const mismatch=evidenceConflict(p,a,e)||((d.classificationLocked||!d.combined)&&ids.get(d.id).forms.length&&a.forms.length&&
          !a.forms.some(v=>ids.get(d.id).forms.includes(v))?'등록 자료 책형 불일치':'');
        candidate(d,mismatch||e.reason,!mismatch&&d.autoLink!==false);
        if(mismatch||!e.allow||d.autoLink===false)verified.delete(d);
        else verified.add(d);
      }
      const direct=Array.from(verified).filter(d=>{
        // A conflicting or withheld claim for the same bytes/target always wins.
        return candidates.get(d.id)?.selectable&&!(d.linkEvidence||[]).some(e=>e.paper===p.hash&&e.kind===kind&&!e.allow);
      });
      const possible=new Set(times.flatMap(t=>broad.get(scope(a.subject,a.exam,t,kind))||[]));
      for(const d of possible){
        const b=ids.get(d.id),mismatch=conflict(a,b);
        if(mismatch||count(p)&&count(d)&&count(p)!==count(d))continue;
        const reason=d.autoLink===false?'자료 자동 연결 해제':!a.exam||!a.year?'시험 식별 정보 부족':
          missingDimension(a,b)||(kind==='정답지'||a.forms.length||b.forms.length)&&(!a.forms.length||!b.forms.length)&&'책형 대조 필요'||
          blocking(d)||blocking(p)||(ambiguousPeer()?'같은 시험의 문제지 판본 여러 개':'');
        candidate(d,reason||'과목·시험·판본 일치',d.autoLink!==false);
        if(!reason)exact.push(d);
      }
      const options=(direct.length?direct:exact).sort(displayOrder);
      let state,reason;
      if(Array.isArray(manual)){
        group[field]=[...new Set(manual)].map(id=>byId.get(id)).filter(d=>d&&materialKind(d)===kind);
        state=group[field].length?'연결 완료':manual.length?'판정 보류':'연결 해제';
        reason=manual.length!==group[field].length?'직접 지정한 자료 누락 또는 유형 변경':'사용자 직접 지정';
        if(manual.length!==group[field].length)group.review=true;
      }else if(p.autoLink===false){state='연결 해제';reason='문제지 자동 연결 해제'}
      else if(options.length&&(kind==='해설지'||options.length===1||priority(options[0])>priority(options[1]))){
        group[field]=options;state='연결 완료';reason=direct.length?'원본 해시와 대조표 검증 일치':'시험 식별 정보와 책형 일치';
      }else if(candidates.size){
        state='후보 검토';reason=options.length?'동일 우선순위 자료 여러 개':candidates.values().next().value.reason;
      }else{
        const uncertain=!a.exam||(!a.year&&!a.cohort)||!subjects.includes(a.subject)||(unidentified.get(a.subject+'|'+kind)||[]).some(d=>{
          const b=ids.get(d.id);return !conflict(a,b);
        });
        state=uncertain?'판정 보류':'기기 내 후보 없음';
        reason=uncertain?'시험·과목·연도 정보가 부족한 자료가 있습니다.':'등록 자료에서 이 시험과 일치하는 후보를 찾지 못했습니다.';
      }
      const items=Array.from(candidates.values());
      if(state==='후보 검토'||state==='판정 보류')group.review=true;
      if(!group[field].length)group.candidates.push(...items.map(item=>byId.get(item.id)));
      group.status[field]={state,reason,candidates:items};
      for(const d of group[field])append(parents,d.id,p);
    }
  }
  function groupFor(id,anchor){
    const d=byId.get(id);if(!d)return;
    if(groups.has(id))return groups.get(id);
    const list=parents.get(id)||[],paper=list.find(p=>p.id===anchor)||(list.length===1?list[0]:null);
    return paper?groups.get(paper.id):{paper:null,answers:materialKind(d)==='정답지'?[d]:[],solutions:materialKind(d)==='해설지'?[d]:[],review:list.length>1};
  }
  return {byId,groups,parents,groupFor,identities:ids};
}
export function missingMaterials(index,subject=''){
  const rows=[];
  for(const g of index.groups.values()){
    const p=g.paper;if(subject&&p.subject!==subject)continue;
    const missing=roles.filter(([,field])=>g.status[field].state==='기기 내 후보 없음').map(([kind])=>kind);
    rows.push({과목:p.subject,연도:p.year||'',시험:p.exam||'',회차:p.round||'',책형:p.form||'',제목:p.title,필요자료:missing.join(' · '),연결검토:g.review,
      정답상태:g.status.answers.state,해설상태:g.status.solutions.state});
  }
  return rows;
}
export function setMaterialType(d,kind){
  if(!kinds.includes(kind))throw Error('자료 유형을 확인하세요.');
  if(materialKind(d)===kind)return;
  d.type=storedType(kind);
  if(kind!=='문제지'&&['queued','error'].includes(d.analysisState))d.analysisState='off';
}
