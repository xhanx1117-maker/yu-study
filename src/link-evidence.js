import {booklet,family,gradeOf,subjectName,sitting,identity,conflict} from './exam-identity.js';
import {subjects} from './model.js';
const hashPattern=/^[a-f0-9]{64}$/;
const short=(s,max=96)=>typeof s==='string'?s.normalize('NFC').trim().slice(0,max):'';
export function roleKind(role){
  if(/해설|풀이/.test(role))return '해설지';
  if(/정답|가답안|답안표/.test(role))return '정답지';
  return '';
}
// Only a claim bound to both original byte hashes can grant automatic linking.
// Multiple entries can describe different subjects in the very same physical PDF.
export function manifestEvidence(row,hash){
  if(!row||!hashPattern.test(hash)||String(row.sha256||'').toLowerCase()!==hash||!Array.isArray(row.linked_targets))return [];
  const kind=roleKind(short(row.role)),sub=subjectName(row.subject);
  if(!kind||!subjects.includes(sub))return [];
  const out=[];
  for(const t of row.linked_targets.slice(0,2048)){
    const paper=short(t?.question_ref?.sha256).toLowerCase();if(!hashPattern.test(paper))continue;
    const form=booklet(t.booklet),sourceForm=booklet(row.booklet),scope=sitting(short(t.session||row.session));
    const sourceExam=short(row.exam),targetExam=short(t.exam)||sourceExam,year=String(t.year||row.year||'');
    const sourceYear=String(row.year||''),targetSession=short(t.session||row.session);
    const crossed=conflict(identity({exam:sourceExam,grade:row.grade,year:sourceYear,sitting:row.session,form:sourceForm}),
      identity({exam:targetExam,year,sitting:targetSession,form}));
    const reason=short(t.validation||row.validation,320);
    out.push({paper,kind,subject:sub,exam:family(targetExam),grade:gradeOf(row.grade||targetExam),year:/^(19|20)\d{2}$/.test(year)?year:'',
      form,sourceForm,...scope,role:short(row.role),allow:!crossed&&row.auto_link_allowed===true&&t.auto_link_allowed===true,
      ...(crossed?{blocked:crossed}:{}),reason:crossed||reason||'수집 목록에서 대상 시험지 지정'});
  }
  return out;
}
export function mergeEvidence(a=[],b=[]){
  const map=new Map();
  for(const e of [...a,...b]){
    const key=JSON.stringify([e.paper,e.kind,e.subject,e.exam,e.grade,e.year,e.form,e.sourceForm,e.cohort,e.schedule,e.recruitmentYear]);
    const prev=map.get(key);
    if(!prev||prev.allow&&!e.allow||e.blocked&&!prev.blocked)map.set(key,e);
  }return [...map.values()];
}
export function evidenceConflict(paper,id,e){
  if(id.subject&&id.subject!=='미분류'&&id.subject!==e.subject)return '과목 불일치';
  return conflict(id,{...e,forms:[e.form,e.sourceForm].filter(Boolean)})||'';
}
