import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyExam} from '../src/exam-catalog.js';
import {materialIndex,missingMaterials} from '../src/materials.js';
import {initial,record} from '../src/model.js';
import {readRepair,attachRepair,confirmCandidates,diagnostics,duplicateGroups,questionSketch} from '../src/audit-model.js';
import {applyEntry} from '../src/package-manifest.js';
const h=n=>n.toString(16).padStart(64,'0');
const paper=(id,sub='행정법',extra={})=>({id:'p'+id,hash:h(id),session:'s'+id,title:'시험 '+id,type:'문제지',subject:sub,exam:'국가직 9급',year:'2024',form:'가',count:20,...extra});
const key=(id,extra={})=>({...paper(id),id:'k'+id,type:'정답지',...extra});
const row=(p,k,allow,extra={})=>({sha256:k.hash,role:'최종정답',exam:'국가직9급',year:'2024',grade:'9급',subject:p.subject,booklet:p.form,auto_link_allowed:allow,
  linked_targets:[{question_ref:{sha256:p.hash},auto_link_allowed:allow,booklet:p.form,validation:'테스트 대조 결과'}],...extra});
test('old ZIP metadata can repair exact pairs across subjects without PDF import or study changes',()=>{
  const s=initial(),a=paper(1),b=paper(2,'행정학'),c=key(3,{form:'',subject:'통합',combined:true,date:'2024-01-01',reviewReasons:['manifest exam 불일치']});
  s.documents=[a,b,c];record(s,a,a.session,[3]);const before=structuredClone(s.questions);
  assert.equal(materialIndex(s.documents).groups.get(a.id).answers.length,0);
  const claims=readRepair({files:[row(a,c,true),row(b,c,true)]});
  assert.deepEqual(attachRepair(s,claims),{matched:1,modified:1,absent:0});assert.equal(attachRepair(s,claims).modified,0);
  const index=materialIndex(s.documents);assert.equal(index.parents.get(c.id).length,2);assert.deepEqual(s.questions,before);
  assert.equal(diagnostics(index).집계.정답지.등록,1);assert.equal(missingMaterials(index)[0].필요자료,'해설지');
  assert.deepEqual(applyEntry(classifyExam('2024 국가직9급 행정법 정답표.pdf'),row(a,c,true),c.hash).linkEvidence,claims.get(c.hash).slice(0,1));
});
test('per-target review, conflicting forms and manual overrides are preserved including on replay',()=>{
  const s=initial(),a=paper(1),b=paper(2),c=key(3),d=key(4,{type:'해설지'}),other=paper(5,'행정법',{form:'나'});s.documents=[a,b,c,d,other];
  const req=readRepair({files:[row(a,c,false),row(b,c,true),row(a,d,false,{role:'비공식해설'}),row(other,c,true,{booklet:'가'})]});
  attachRepair(s,req);
  let i=materialIndex(s.documents);assert.equal(i.groups.get(a.id).status.answers.state,'후보 검토');
  assert.equal(i.groups.get(b.id).answers[0],c);
  assert.equal(i.groups.get(other.id).status.answers.candidates[0].selectable,false);
  assert.throws(()=>confirmCandidates(s,[{paper:other.id,field:'answers',id:c.id}]));
  assert.equal(confirmCandidates(s,[{paper:a.id,field:'answers',id:c.id},{paper:a.id,field:'solutions',id:d.id}]),2);
  a.answerIds=[];attachRepair(s,req);i=materialIndex(s.documents);assert.equal(i.groups.get(a.id).status.answers.state,'연결 해제');
  assert.equal(i.groups.get(a.id).solutions[0],d);
});
test('normalize cadet, session, subject, extra recruitment and Unicode without conflating different exams',()=>{
  const a=classifyExam('2026_경찰간부후보생_제76기_2027년도선발_행정학개론_A형_문제지.pdf'.normalize('NFD'));
  const b=classifyExam('2027 경위 공개경쟁채용 제76기 행정학 A형 해설지 (가상강사).pdf');
  assert.equal(a.cohort,'76');assert.equal(b.exam,'경찰간부');assert.equal(a.recruitmentYear,'2027');
  assert.equal(classifyExam('2024 소방간부후보생 행정법총론.pdf').exam,'소방간부');
  assert.equal(classifyExam('2026 법원행정고등고시 행정법.pdf').exam,'법원행정고등고시');
  const all=[{...a,id:'p'},{...b,id:'s'}];assert.equal(materialIndex(all).groups.get('p').solutions.length,1);
  for(const patch of [{cohort:'75'},{schedule:'추가',cohort:'76'},{form:'B'}])assert.equal(materialIndex([all[0],{...all[1],...patch}]).groups.get('p').solutions.length,0);
});
test('content overlap finds a reordered subject excerpt but never edits or merges documents',()=>{
  const lines=['행정기관의 권한 행사에 관한 가상의 첫 번째 검토 문항입니다','거래와 처분 사이의 차이에 관한 가상의 두 번째 검토 문항입니다','조직의 의사 결정 순서에 관한 가상의 세 번째 사례 문항입니다','근거가 분명한 경우에 관한 가상의 네 번째 시험 문항입니다'];
  const a=paper(1),b=paper(2);a.questionSketch=questionSketch(lines.map((s,i)=>i+1+'. '+s));b.questionSketch=questionSketch(lines.slice(1).reverse());
  const before=JSON.stringify([a,b]);assert.equal(duplicateGroups(materialIndex([a,b])).length,1);assert.equal(JSON.stringify([a,b]),before);
  b.questionSketch=[1,2,3];assert.equal(duplicateGroups(materialIndex([a,b])).length,0);
});
test('a contradictory package grade cannot authorize a link; different paper bytes are review only',()=>{
  const a=paper(1,'행정법',{exam:'군무원 9급',grade:'9급'}),b=paper(2,'행정법',{exam:'군무원 7급',grade:'7급'}),c=key(4,{exam:'군무원 7급',grade:'7급'});
  const r=row(a,c,true,{exam:'군무원7급',grade:'7급'});r.linked_targets[0].exam='군무원9급';
  const s=initial();s.documents=[a,b,c];attachRepair(s,readRepair({files:[r]}));
  const info=materialIndex(s.documents).groups.get(a.id).status.answers;
  assert.equal(info.state,'후보 검토');assert.equal(info.candidates[0].selectable,false);assert.match(info.reason,/급수/);
  const twin={...b,id:'v',hash:h(20)};s.documents.push(twin);
  attachRepair(s,readRepair({files:[row(b,c,true,{exam:'군무원7급',grade:'7급'})]}));
  const g=materialIndex(s.documents).groups.get(twin.id);
  assert.equal(g.status.answers.state,'후보 검토');assert.equal(g.answers.length,0);
});
test('protect study and user-selected types while still reporting a misclassified companion',()=>{
  const p=paper(1),k=paper(2),s=initial();s.documents=[p,k];record(s,k,k.session,[1]);
  const before=structuredClone(s.events);attachRepair(s,readRepair({files:[row(p,k,true)]}));
  assert.equal(k.type,'문제지');assert.deepEqual(s.events,before);
  const g=materialIndex(s.documents).groups.get(p.id);assert.equal(g.status.answers.state,'후보 검토');assert.equal(g.status.answers.candidates[0].selectable,false);
  const lockedSolution={...k,id:'locked',hash:h(19),classificationLocked:true};s.documents.push(lockedSolution);
  attachRepair(s,readRepair({files:[row(p,lockedSolution,true)]}));assert.equal(lockedSolution.type,'문제지');
});
test('existing exam titles also resolve vocational, welfare and bar exam families',()=>{
  for(const [name,family] of [['법원행정고등고시','법원행정고등고시'],['변호사시험','변호사시험'],['사회복지직9급','사회복지직'],['행정사1차','행정사']]){
    const d=classifyExam(('2017_'+name+'_행정법_문제.pdf').normalize('NFD'));assert.equal(d.exam,family);
    if(family==='행정사')assert.equal(d.schedule,'1차');
  }
});
