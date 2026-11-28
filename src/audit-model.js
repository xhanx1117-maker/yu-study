import {materialKind,materialIndex,roles,setMaterialType,missingMaterials,coversSubject} from './materials.js';
import {identity,conflict,subjectName,compact,sitting} from './exam-identity.js';
import {manifestEvidence,mergeEvidence} from './link-evidence.js';
import {protectedRegion} from './region-records.js';
import {subjects} from './model.js';

export function readRepair(data){
  if(!Array.isArray(data?.files)||data.files.length>25000)throw Error('수집 manifest 또는 연결 복구 JSON을 선택하세요.');
  const claims=new Map();
  for(const row of data.files){
    const hash=String(row?.sha256||'').toLowerCase(),incoming=manifestEvidence(row,hash);
    if(incoming.length)claims.set(hash,mergeEvidence(claims.get(hash),incoming));
  }
  if(!claims.size)throw Error('원본 PDF 해시와 대상 문제지 해시가 함께 있는 연결 정보가 없습니다.');
  return claims;
}
export function protectedPapers(s){
  return new Set([...s.questions.map(q=>q.doc),
    ...s.sessions.filter(x=>x.solvedAt).map(x=>x.doc),...s.documents.filter(d=>Object.values(d.detected||{}).some(protectedRegion)||
      d.answerIds||d.answerId||d.solutionIds||d.studyState||d.favorite).map(d=>d.id)]);
}
export function applyProof(d,claims,protectedIds){
  if(d.deleted||!claims?.length)return false;
  const combined=mergeEvidence(d.linkEvidence,claims),kinds=new Set(combined.map(e=>e.kind));
  if(JSON.stringify(combined)===JSON.stringify(d.linkEvidence))return false;
  d.linkEvidence=combined;
  const kind=combined[0].kind;
  if(kinds.size!==1||materialKind(d)!==kind&&(d.classificationLocked||protectedIds.has(d.id))){
    d.auditIssue='수집 목록의 자료 유형과 현재 분류가 다릅니다. 자료 관리에서 확인하세요.';return true;
  }
  if(materialKind(d)!==kind)setMaterialType(d,kind);
  if(!d.classificationLocked){
    const subs=[...new Set(combined.map(e=>e.subject))];
    if(kind==='정답지'&&(subs.length>1||d.combined)){d.combined=true;d.subject='통합';d.answerSubjects=subs}
    else if(!d.subject||d.subject==='미분류')d.subject=subs[0];
    if(!d.exam)d.exam=combined[0].exam;
    if(!d.year)d.year=combined[0].year;
    if(!d.grade)d.grade=combined[0].grade;
    const role=combined[0].role;
    if(kind==='정답지'){
      if(/비공식/.test(role))d.authority='비공식';
      if(/최종/.test(role))d.answerEdition='최종';
      else if(/가답안/.test(role))d.answerEdition='잠정';
      else if(/미확정|미상/.test(role))d.answerEdition='';
    }
  }
  return true;
}
export function attachRepair(s,claims){
  const protectedIds=protectedPapers(s),seen=new Set();let modified=0;
  for(const d of s.documents)if(!d.deleted&&claims.has(d.hash)){
    seen.add(d.hash);if(applyProof(d,claims.get(d.hash),protectedIds))modified++;
  }
  return {matched:seen.size,modified,absent:claims.size-seen.size};
}
// Hold only small fingerprints. Exact question samples are also useful when a
// combined exam contains just the subject excerpt, or questions were reordered.
export function questionSketch(texts){
  const values=new Set();
  for(const text of texts){
    const s=compact(String(text||'').replace(/^\s*(?:문제?|제)?\s*\d{1,3}\s*[.)번]\s*/,''));if(s.length<20)continue;
    const piece=s.slice(0,90);let h=2166136261;
    for(let n=0;n<piece.length;n++)h=Math.imul(h^piece.charCodeAt(n),16777619);
    values.add(h>>>0);if(values.size>=300)break;
  }return [...values].sort((a,b)=>a-b);
}
export function duplicateGroups(index,subject=''){
  const lists=new Map(),seen=new Set(),result=[];
  function put(key,d){if(!lists.has(key))lists.set(key,[]);lists.get(key).push(d)}
  for(const {paper:d} of index.groups.values()){
    const i=index.identities.get(d.id);if(subject&&i.subject!==subject||!i.exam||!subjects.includes(i.subject))continue;
    const scope=i.exam+'|'+i.subject+'|';if(i.year)put(scope+'y'+i.year,d);if(i.cohort)put(scope+'c'+i.cohort,d);
  }
  for(const list of lists.values())for(let n=0;n<list.length;n++)for(let m=0;m<n;m++){
    const a=list[m],b=list[n],key=JSON.stringify([a.id,b.id].sort());if(seen.has(key))continue;seen.add(key);
    const x=index.identities.get(a.id),y=index.identities.get(b.id);
    if(conflict({...x,forms:[]},{...y,forms:[]}))continue;
    const qa=a.questionSketch||[],qb=b.questionSketch||[],sa=a.signature||[],sb=b.signature||[];
    const overlap=(as,bs)=>{const set=new Set(as);return bs.filter(v=>set.has(v)).length};
    let reason;
    if(Math.min(qa.length,qb.length)>=3){
      const same=overlap(qa,qb);if(same>=3&&same>=Math.min(qa.length,qb.length)*.65)reason='문항 본문 '+same+'개 일치';
      else continue;
    }else if(Math.min(sa.length,sb.length)>=10&&overlap(sa,sb)>=Math.min(sa.length,sb.length)*.8)reason='첫 페이지 본문 유사';
    else if(x.cohort&&x.cohort===y.cohort&&/발췌|변환|순수|통합|공식원본/.test((a.title||'')+' '+(b.title||'')))reason='같은 기수·판본 후보 · 본문 대조 필요';
    if(reason)result.push({ids:[a.id,b.id],titles:[a.title,b.title],reason,booklets:[a.form||'',b.form||'']});
  }
  return result;
}
export function diagnostics(index,subject=''){
  const docs=[...index.byId.values()].filter(d=>coversSubject(d,subject)),papers=[...index.groups.values()].filter(g=>coversSubject(g.paper,subject));
  const stats={},orphans=[],rows=missingMaterials(index,subject),duplicates=duplicateGroups(index,subject);
  for(const [kind,field] of roles){
    const registered=docs.filter(d=>materialKind(d)===kind),unlinked=registered.filter(d=>!index.parents.has(d.id));
    const counts={등록:registered.length,연결완료:0,등록후미연결:unlinked.length,후보검토:0,기기내후보없음:0,판정보류:0,연결해제:0};
    const states={'연결 완료':'연결완료','후보 검토':'후보검토','기기 내 후보 없음':'기기내후보없음','판정 보류':'판정보류','연결 해제':'연결해제'};
    const reverse=new Map();
    for(const g of index.groups.values())for(const c of g.status[field].candidates){
      if(!reverse.has(c.id))reverse.set(c.id,[]);reverse.get(c.id).push({문제지:g.paper.id,사유:c.reason});
    }
    for(const g of papers)counts[states[g.status[field].state]]++;
    for(const d of unlinked)orphans.push({자료:d.id,제목:d.title,유형:kind,원본해시:d.hash,후보:reverse.get(d.id)||[],
      사유:d.auditIssue||(d.autoLink===false?'자동 연결 해제':reverse.has(d.id)?'대상 문제지 검토 필요':d.linkEvidence?.length?'대조표 대상 원본 또는 분류 확인 필요':'시험 식별 정보가 맞는 문제지 없음')});
    stats[kind]=counts;
  }
  rows.forEach((r,i)=>{
    const g=papers[i];r.문제지ID=g.paper.id;r.원본해시=g.paper.hash;
    for(const [kind,field] of roles)r[kind]={상태:g.status[field].state,사유:g.status[field].reason,연결:g[field].map(d=>({id:d.id,제목:d.title})),
      후보:g.status[field].candidates.map(c=>({id:c.id,제목:index.byId.get(c.id)?.title,사유:c.reason,선택가능:c.selectable}))};
  });
  return {format:'yu-study-link-diagnostics',version:2,과목:subject||'전체',집계:{문제지:papers.length,...stats,중복후보쌍:duplicates.length},
    누락목록:rows.filter(r=>r.필요자료||r.연결검토||[r.정답상태,r.해설상태].includes('연결 해제')),시험지별:rows,미연결자료:orphans,
    중복후보:duplicates,분류검토:docs.filter(d=>d.auditIssue||d.reviewReasons?.length).map(d=>({id:d.id,제목:d.title,사유:[...(d.reviewReasons||[]),...(d.auditIssue?[d.auditIssue]:[])]}))};
}
export function confirmCandidates(s,choices){
  const index=materialIndex(s.documents),updates=new Map();
  for(const {paper,field,id} of choices){
    const role=roles.find(r=>r[1]===field),g=index.groups.get(paper);
    if(!role||!g||g.status[field].state!=='후보 검토'||!g.status[field].candidates.some(c=>c.id===id&&c.selectable))throw Error('연결 상태가 바뀌었습니다. 새 목록에서 다시 선택하세요.');
    const key=JSON.stringify([paper,field]);
    if(!updates.has(key))updates.set(key,{d:g.paper,key:role[2],ids:new Set()});
    const entry=updates.get(key);entry.ids.add(id);if(field==='answers'&&entry.ids.size>1)throw Error('한 문제지의 정답을 한 개만 선택하세요.');
  }
  for(const u of updates.values())u.d[u.key]=[...u.ids];
  return updates.size;
}
