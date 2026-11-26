import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyExam,answerMatch,possibleDuplicate,studyStats,studyState,setStudy} from '../src/exam-catalog.js';
import {makeZip,openZip,safePath,crc32} from '../src/archive-zip.js';
import {initial} from '../src/model.js';
test('ZIP members keep Korean paths and exact contents; traversal and invalid CRC never reach storage',async()=>{
  const data='synthetic paper',file=await makeZip([{path:'행정학/2026/문제.pdf',blob:new Blob([data])}]);
  const [entry]=await openZip(file);assert.equal(entry.path,'행정학/2026/문제.pdf');assert.equal(await (await entry.blob()).text(),data);
  assert.equal(crc32(new TextEncoder().encode('123456789')),0xcbf43926);
  assert.equal(safePath('../문제.pdf'),'');assert.equal(safePath('C:\\외부.pdf'),'');assert.equal(safePath('/외부.pdf'),'');
  const bytes=new Uint8Array(await file.arrayBuffer());bytes[30+new TextEncoder().encode(entry.path).length]^=2;
  const [broken]=await openZip(new Blob([bytes]));await assert.rejects(broken.blob(),/CRC/);
});
test('normalized title, header, folder and ambiguous information',()=>{
  const d=classifyExam('2025/지방9급/행정법총론-D.pdf'.normalize('NFD'),{heading:'2025년 지방공무원 9급 행정법 총론',pages:4});
  assert.deepEqual([d.subject,d.year,d.exam,d.grade,d.form],['행정법','2025','지방직 9급','9급','D']);
  assert.deepEqual(d.reviewReasons,[]);
  const custom=classifyExam('2025/가상교육청 채용/행정학 개론.pdf',{},['가상교육청 채용','기타','국가직 9급']);
  assert.deepEqual([custom.exam,custom.subject,custom.reviewReasons],['가상교육청 채용','행정학',[]]);
  const conflict=classifyExam('2026/국가직 9급/행정학_가.pdf',{heading:'2025 지방직 7급 행정법'});
  for(const key of ['과목','연도','시험','급수'])assert.ok(conflict.reviewReasons.some(v=>v.includes(key)));
  assert.equal(classifyExam('스캔.pdf',{scanned:true}).subject,'미분류');
  for(const [sample,kind] of [['군무원','군무원'],['국회공무원','국회직'],['법원행정처','법원직'],['소방공무원','소방'],['서울특별시','서울시'],['경찰청','경찰']])assert.equal(classifyExam(sample+'.pdf').exam,kind);
});
test('only unambiguous answer keys link, prefer final and keep variants separate',()=>{
  const doc={...classifyExam('2025/국가직9급/행정법_가.pdf'),id:'d',hash:'one'};
  const key={...classifyExam('2025/국가직9급/통합 최종 정답_가.pdf'),id:'key'};
  const other={...doc,form:'나',hash:'two',id:'other'};
  assert.equal(possibleDuplicate(other,[doc]).id,'d');
  assert.equal(answerMatch(doc,[doc,key]).answers[0].id,'key');
  assert.equal(answerMatch(other,[doc,key,other]).answers.length,0);
  assert.equal(answerMatch(doc,[doc,{...key,form:''}]).answers.length,0);
  assert.equal(answerMatch(doc,[doc,{...key,grade:'7급'}]).answers.length,0);
  assert.equal(answerMatch(doc,[doc,key,{...key,id:'p',answerEdition:'잠정'}]).answers[0].id,'key');
  assert.equal(answerMatch(doc,[doc,key,{...key,id:'ambiguous'}]).review,true);
});
test('paper study completion counts once per session, including zero mistakes',()=>{
  const s=initial(),doc={id:'p',session:'s'};s.documents=[doc];s.sessions=[{id:'s',doc:'p'}];
  setStudy(s,doc,'풀이 완료','2026-01-01');setStudy(s,doc,'풀이 완료','2026-01-02');const row=studyStats(s).get('p');
  assert.equal(row.solved.size,1);assert.equal(row.wrong.size,0);assert.equal(row.lastSolved,'2026-01-01');assert.equal(studyState(doc,row),'풀이 완료');
});
