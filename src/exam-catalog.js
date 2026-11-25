import {subjects} from './model.js';

export const studyStates=['미풀이','풀이 완료','복습 필요','복습 완료'];
export const commonExams=['국가직 9급','국가직 7급','지방직 9급','지방직 7급','서울시','군무원','국회직','법원직','소방','경찰'];
const exams=[
  ['군무원',/군무원|국방부/],['국회직',/국회(?:직|공무원|사무처)/],['법원직',/법원(?:직|공무원|행정처)/],
  ['소방',/소방(?:직|공무원|청|채용)?/],['경찰',/경찰(?:직|공무원|청|채용)?/],
  ['서울시',/서울(?:시|특별시)/],['국가직',/국가(?:직|공무원|[579]급)|인사혁신처/],['지방직',/지방(?:직|공무원|[579]급)|지방자치단체/]
];
const unique=values=>[...new Set(values.filter(Boolean))];
function extract(text){
  const flat=text.normalize('NFC').replace(/\s+/g,''),date=flat.match(/((?:19|20)\d{2})[.년/-](\d{1,2})[.월/-](\d{1,2})(?:일|\.|\b)/);
  const kind=exams.filter(([,pattern])=>pattern.test(flat)).map(([name])=>name);
  const foundSubjects=subjects.filter(subject=>flat.includes(subject));
  const form=flat.match(/(?:책형|문제형|책자형별|형별)[:：_(-]*([가나다라마바사아A-F])(?:형|\b|$|[)\s])/i)
    ||text.match(/(?:^|[-_ (\s])([가나다라마바사아A-F])\s*(?:책?형|책|(?=[_. )/]|$))/i);
  const answer=/정답(?:지|표|안|가안|및해설)?|답안(?:지|표)|answer[\s_-]*key/i.test(flat);
  return {subjects:foundSubjects,years:unique(flat.match(/(?:19|20)\d{2}/g)||[]),exams:kind,grades:unique(flat.match(/[1-9]급/g)||[]),
    date:date?[date[1],date[2].padStart(2,'0'),date[3].padStart(2,'0')].join('-'):'',
    round:flat.match(/(?:제)?(\d{1,2})(?:회차|회(?:시험|공채|차)?)/)?.[1]||'',
    form:(form?.[1]||'').toUpperCase(),agency:flat.match(/인사혁신처|서울특별시|국방부|육군|해군|공군|국회사무처|법원행정처|소방청|경찰청|[가-힣]{2,5}(?:광역시|특별자치도|도청)/)?.[0]||'',
    answer,explicitPaper:/문제(?:지|책)|시험지/.test(flat),combined:/통합|전과목|전체과목|공통정답/.test(flat),
    edition:/최종|확정/.test(flat)?'최종':/가안|잠정|정답안/.test(flat)?'잠정':''};
}
export function fingerprint(text){
  const words=unique((text.toLowerCase().match(/[가-힣a-z]{2,}/g)||[]).slice(0,1600));
  if(words.length<10)return [];
  return unique(words.map(word=>{let h=2166136261;for(let i=0;i<word.length;i++)h=Math.imul(h^word.charCodeAt(i),16777619);return h>>>0})).sort((a,b)=>a-b).slice(0,32);
}
export function classifyExam(path,{heading='',sample='',pages=0,scanned=false,explicitCount=0}={}){
  const normalized=path.normalize('NFC'),filename=normalized.split('/').at(-1),title=filename.replace(/\.pdf$/i,'');
  const parts=[extract(title),extract(heading),extract(normalized.split('/').slice(0,-1).join(' / '))],reasons=[];
  function resolve(key,label){
    const values=unique(parts.flatMap(p=>Array.isArray(p[key])?p[key]:[p[key]]));
    if(values.length>1)reasons.push(label+' 불일치');
    return values[0]||'';
  }
  const isAnswer=parts.some(p=>p.answer),possible=unique(parts.flatMap(p=>p.subjects));
  const combined=isAnswer&&(parts.some(p=>p.combined)||possible.length>1);
  const subject=combined?'통합':resolve('subjects','과목')||'미분류';
  let exam=resolve('exams','시험');const grade=resolve('grades','급수'),year=resolve('years','연도');
  if((exam==='국가직'||exam==='지방직')&&grade)exam+=' '+grade;
  const form=resolve('form','책형'),round=resolve('round','회차'),date=resolve('date','시행일'),agency=resolve('agency','기관');
  if(parts[0].answer&&parts[1].explicitPaper&&!parts[1].answer || parts[1].answer&&parts[0].explicitPaper&&!parts[0].answer)reasons.push('문제지·정답지 불일치');
  if(!exam||!year||subject==='미분류')reasons.push('분류 정보 부족');
  if(scanned)reasons.push('텍스트 없는 PDF');
  return {title,filename,subject,exam,grade,year,form,round,date,agency,type:isAnswer?'정답지':'기출문제지',combined,
    answerSubjects:combined?possible:[],answerEdition:isAnswer?resolve('edition','정답 판본'):'',pages,
    count:explicitCount||20,countKnown:!!explicitCount,signature:fingerprint(sample),reviewReasons:unique(reasons)};
}
const baseExam=name=>(name||'').replace(/\s*[1-9]급/g,'').replace(/\s/g,'');
const gradeOf=d=>d.grade||d.exam?.match(/[1-9]급/)?.[0]||'';
function dimensions(a,b){
  return ['date','round','form','agency'].every(k=>!a[k]||!b[k]||a[k]===b[k])&&(!gradeOf(a)||!gradeOf(b)||gradeOf(a)===gradeOf(b));
}
export function identityBucket(d){return [d.year,baseExam(d.exam),d.subject,d.type||'기출문제지'].join('|')}
export function possibleDuplicate(d,others){
  if(!d.year||!d.exam||d.subject==='미분류')return;
  const terms=new Set(d.signature||[]);
  for(const other of others||[]){
    if(d.hash===other.hash||other.deleted||!dimensions({...d,form:''},other))continue;
    const near=terms.size>=10 && (other.signature||[]).filter(h=>terms.has(h)).length>=Math.min(terms.size,other.signature?.length||0)*.72 && other.signature?.length>=10;
    if(near||d.form&&other.form&&d.form!==other.form)return other;
  }
}
export function answerMatch(doc,documents){
  if(doc.type==='정답지'||doc.autoLink===false||doc.deleted)return {answers:[]};
  const usable=documents.filter(a=>a.type==='정답지'&&!a.deleted&&a.id!==doc.id);
  if(doc.answerId){const chosen=usable.find(a=>a.id===doc.answerId);if(chosen)return {answers:[chosen]}}
  if(!doc.year||!doc.exam||!subjects.includes(doc.subject))return {answers:[],review:true};
  const candidates=usable.filter(a=>a.autoLink!==false&&a.year===doc.year&&baseExam(a.exam)===baseExam(doc.exam)&&dimensions(doc,a)&&
    (a.subject===doc.subject||a.combined&&(!a.answerSubjects?.length||a.answerSubjects.includes(doc.subject))));
  const exact=candidates.filter(a=>!a.reviewReasons?.length&&!doc.reviewReasons?.length&&
    gradeOf(a)===gradeOf(doc)&&['round','form','date','agency'].every(k=>(a[k]||'')===(doc[k]||'')||a.combined&&k==='form'&&!a.form));
  // A shared, unqualified key is safe only if its plausible papers do not have incompatible grades, dates, rounds or forms.
  const safe=exact.filter(a=>!documents.some(p=>p.id!==doc.id&&!p.deleted&&p.type!=='정답지'&&p.year===doc.year&&baseExam(p.exam)===baseExam(doc.exam)&&
    (p.subject===doc.subject||a.combined&&(a.answerSubjects?.includes(p.subject)||!a.answerSubjects?.length))&&
    (['round','date','form','agency'].some(k=>!a[k]&&p[k]&&p[k]!==doc[k])||!gradeOf(a)&&gradeOf(p)&&gradeOf(p)!==gradeOf(doc))));
  const preferred=safe.filter(a=>a.answerEdition==='최종'),pool=preferred.length?preferred:safe;
  return pool.length===1?{answers:pool}:{answers:[],review:candidates.length>0,candidates};
}
export function studyStats(s){
  const result=new Map(),sessions=new Map(s.sessions.map(a=>[a.id,a])),questions=new Map(s.questions.map(q=>[q.id,q.doc]));
  function entry(id){if(!result.has(id))result.set(id,{wrong:new Set(),attempts:0,solved:new Set(),lastSolved:'',lastReview:''});return result.get(id)}
  for(const e of s.events){const id=questions.get(e.q);if(!id)continue;const a=entry(id);a.wrong.add(e.q);a.attempts++;a.solved.add(e.session);if(e.date>a.lastSolved)a.lastSolved=e.date}
  for(const session of sessions.values())if(session.solvedAt){const a=entry(session.doc);a.solved.add(session.id);if(session.solvedAt>a.lastSolved)a.lastSolved=session.solvedAt}
  for(const review of s.reviews){const id=questions.get(review.q);if(id&&review.date>entry(id).lastReview)entry(id).lastReview=review.date}
  return result;
}
export function studyState(doc,stats){return doc.studyState||(stats?.solved.size?'풀이 완료':'미풀이')}
export function setStudy(s,doc,value,now=new Date().toISOString()){
  if(!studyStates.includes(value))throw Error('풀이 상태를 확인하세요.');
  doc.studyState=value;
  if(value==='풀이 완료'){
    const session=s.sessions.find(a=>a.id===doc.session&&a.doc===doc.id);
    if(session&&!session.solvedAt)session.solvedAt=now;
  }
  if(value==='복습 완료')doc.lastReview=now;
}
