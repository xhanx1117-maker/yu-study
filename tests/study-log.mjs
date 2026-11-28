import test from 'node:test';
import assert from 'node:assert/strict';
import {initial,record} from '../src/model.js';
import {legacyRows,periodRange,studyDay,takeChanges,validDay} from '../src/study-events.js';
import {reportCsv,reportText,studyReport} from '../src/study-report.js';
import {verifyStudyRows} from '../src/study-store.js';

test('Seoul midnight, Monday week, month, leap day and rolling periods',()=>{
  assert.equal(studyDay('2026-11-28T14:59:59Z'),'2026-11-28');
  const monday='2026-11-29T15:00:00Z';
  assert.deepEqual(periodRange('이번 주',monday),['2026-11-30','2026-11-30']);
  assert.deepEqual(periodRange('어제',monday),['2026-11-29','2026-11-29']);
  assert.deepEqual(periodRange('최근 7일',monday),['2026-11-24','2026-11-30']);
  assert.deepEqual(periodRange('최근 30일',monday),['2026-11-01','2026-11-30']);
  assert.deepEqual(periodRange('이번 달','2024-02-29T10:00:00Z'),['2024-02-01','2024-02-29']);
  assert.ok(!validDay('2026-02-30'));
});
function fixture(){
  const s=initial(),d={id:'p',subject:'행정법',title:'=가상, "시험"',exam:'국가직 9급',year:'2026',form:'가',count:20};
  s.documents.push(d);s.sessions=['a','b','clean'].map(id=>({id,doc:d.id}));
  record(s,d,'a',[1]);record(s,d,'a',[1]);assert.equal(takeChanges(s).length,1);
  record(s,d,'b',[1,2]);s.sessions[2].solvedAt='2026-11-28T15:00:01Z';
  s.events[0].date='2026-11-28T14:59:01Z';s.events[1].date='2026-11-28T15:00:01Z';s.events[2].date='';
  s.removedMistakes=[{id:'trash',events:[s.events.shift()]}];return s;
}
test('migrate dated archived events and explicit completions once, including a zero-error attempt',()=>{
  const s=fixture(),rows=legacyRows(s);
  assert.equal(rows.length,3);assert.deepEqual(rows.filter(r=>r.kind==='wrong').map(r=>r.count),[1,2]);
  assert.equal(rows[0].grade,'9급');assert.equal(rows[0].form,'가');
  assert.deepEqual(legacyRows(s).map(r=>r.id),rows.map(r=>r.id));
  assert.throws(()=>verifyStudyRows([...rows,rows[0]]));assert.deepEqual(verifyStudyRows(rows),rows);
  s.events[0].date='2026-11-30';assert.ok(legacyRows(s).some(r=>r.time==='2026-11-30'));
});
test('daily, subject, exam, unique and occurrence counts withstand repeat attempts and quoted export',()=>{
  const rows=legacyRows(fixture());rows.find(r=>r.kind==='solved').wrongInSession=0;
  const r=studyReport(rows,{from:'2026-11-28',to:'2026-11-29'});
  assert.equal(r.days.length,2);assert.equal(r.summary.occurrences,2);assert.equal(r.summary.new,1);assert.equal(r.summary.repeated,1);assert.equal(r.summary.unique,1);
  assert.equal(r.summary.cleanCompletedPapers,1);assert.equal(r.summary.themes[0].label,'미분류');
  assert.match(reportText(r),/기록된 오답 없음/);assert.doesNotMatch(reportText(r),/정답률|오답률|우선순위/);
  assert.match(reportText(r,true,true),/^# Yu: study/m);assert.match(reportText(r,true,true),/복습 우선순위/);
  assert.match(reportCsv(r),/"'=가상, ""시험"""/);assert.ok(reportCsv(r).startsWith('\uFEFF'));
});
