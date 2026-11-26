import {subjects} from './model.js';
import {materialIndex,mixedType} from './materials.js';

export const studyStates=['미풀이','풀이 완료','복습 필요','복습 완료'];
export const commonExams=['국가직 9급','국가직 7급','지방직 9급','지방직 7급','서울시','군무원','국회직','법원직','소방','경찰'];
const exams=[
  ['군무원',/군무원|국방부/],['국회직',/국회(?:직|공무원|사무처)/],['법원직',/법원(?:직|공무원|행정처)/],
  ['소방',/소방(?:직|공무원|청|채용)?/],['경찰',/경찰(?:직|공무원|청|채용)?/],
  ['서울시',/서울(?:시|특별시)/],['국가직',/국가(?:직|공무원|[579]급)|인사혁신처/],['지방직',/지방(?:직|공무원|[579]급)|지방자치단체/]
];
const unique=values=>[...new Set(values.filter(Boolean))];
function extract(text,customExams){
  const flat=text.normalize('NFC').replace(/\s+/g,''),date=flat.match(/((?:19|20)\d{2})[.년/-](\d{1,2})[.월/-](\d{1,2})(?:일|\.|\b)/);
  const kind=exams.filter(([,pattern])=>pattern.test(flat)).map(([name])=>name);
  const custom=customExams.filter(name=>flat.includes(name.normalize('NFC').replace(/\s+/g,'')));
  if(custom.length)kind.push(...custom);
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
export function classifyExam(path,{heading='',sample='',pages=0,scanned=false,explicitCount=0}={},examTypes=[]){
  const normalized=path.normalize('NFC'),filename=normalized.split('/').at(-1),title=filename.replace(/\.pdf$/i,'');
  const custom=examTypes.filter(name=>name&&name!=='기타'&&!commonExams.includes(name)&&!exams.some(([base])=>base===name));
  const parts=[title,heading,normalized.split('/').slice(0,-1).join(' / ')].map(text=>extract(text,custom)),reasons=[];
  function resolve(key,label){
    const values=unique(parts.flatMap(p=>Array.isArray(p[key])?p[key]:[p[key]]));
    if(values.length>1)reasons.push(label+' 불일치');
    return values[0]||'';
  }
  const names=[title,heading,...normalized.split('/').slice(0,-1)].map(v=>v.normalize('NFC'));
  // An outer collection can be named "문제지·정답지·해설지". Specific inner evidence wins.
  const typeOf=value=>{
    const flat=value.replace(/\s/g,'');
    if(/문제(?:지)?[·+&와및_-]*해설|해설(?:수록|포함|판)|문제풀이집/.test(flat))return mixedType;
    if(/해설(?:지|집|서)?|해설강의|풀이집|solutions?|commentary/i.test(flat))return '해설지';
    if(/정답(?:지|표|안|가안|키)?|가답안|답안(?:지|표)|answer[_-]*key/i.test(flat))return '정답지';
    if(/문제지|문제책|시험지|question[_-]*paper/i.test(flat))return '기출문제지';
    return '';
  };
  const body=sample.slice(0,6500);
  const bodyExplanation=(body.match(/(?:해설|정답\s*및\s*해설)\s*[:：】\]]/g)||[]).length>=2||
    /(?:【해설】|\[해설\]|정답\s*[:：]\s*[①-⑤1-5]\s*(?:해설|풀이))/.test(body);
  const evidence=[typeOf(title),typeOf(heading.split(/\b1[.)]/)[0].slice(0,240))].filter(Boolean);
  const folder=names.slice(2).reverse().filter(x=>!(/문제/.test(x)&&/정답/.test(x))&&!(/정답/.test(x)&&/해설/.test(x))).map(typeOf).find(Boolean);
  const hasNotes=bodyExplanation||evidence.some(v=>v==='해설지'||v===mixedType);
  const type=hasNotes?(bodyExplanation||evidence.includes(mixedType)?mixedType:'해설지'):evidence[0]||folder||'기출문제지';
  if(new Set(evidence).size>1&&!hasNotes)reasons.push('자료 유형 불일치');
  const isAnswer=type==='정답지',possible=unique(parts.flatMap(p=>p.subjects));
  const combined=isAnswer&&parts.some(p=>p.combined||p.subjects.length>1);
  const subject=combined?'통합':resolve('subjects','과목')||'미분류';
  let exam=resolve('exams','시험');const grade=resolve('grades','급수'),year=resolve('years','연도');
  if((exam==='국가직'||exam==='지방직')&&grade)exam+=' '+grade;
  const form=resolve('form','책형'),round=resolve('round','회차'),date=resolve('date','시행일'),agency=resolve('agency','기관');
  if(parts[0].answer&&parts[1].explicitPaper&&!parts[1].answer || parts[1].answer&&parts[0].explicitPaper&&!parts[0].answer)reasons.push('문제지·정답지 불일치');
  if(!exam||!year||subject==='미분류')reasons.push('분류 정보 부족');
  if(scanned)reasons.push('텍스트 없는 PDF');
  return {title,filename,subject,exam,grade,year,form,round,date,agency,type,typeEvidence:!!(hasNotes||evidence.length||folder),combined,authority:isAnswer?(/비공식|강사|복원/.test(names.join(' '))?'비공식':/공식|인사혁신처|국방부|법원행정처|국회사무처/.test(names.join(' '))?'공식':''):'',
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
export function answerMatch(doc,documents){return materialIndex(documents).groups.get(doc.id)||{answers:[]}}
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
