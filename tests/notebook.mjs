import test from 'node:test';
import assert from 'node:assert/strict';
import {initial,record,stats,subjects,validate} from '../src/model.js';
import {notebookIndex,filterRows,emptyFilters,groupCounts,changeDocumentSubject,assignTheme,removeEvents,restoreEvents,setStatus} from '../src/notebook-model.js';

function fixture() {
  const s=initial();
  s.books=[{id:'book',title:'가상 교재',subject:'행정학',parts:[{id:'part',title:'PART A',chapters:[{id:'chapter',title:'CHAPTER A',themes:[{id:'a',title:'가상 항목 A',number:'002'},{id:'b',title:'가상 항목 B',number:'010'}]}]}]}];
  subjects.forEach((subject,i)=>{
    const d={id:'d'+i,subject,year:'2025',exam:'가상 시험',title:subject,hash:String(i).repeat(64),count:20};
    s.documents.push(d);
    for(const k of [1,2]){const id=d.id+'-'+k;s.sessions.push({id,doc:d.id});record(s,d,id,[7])}
  });
  return s;
}
test('legacy events join to four subjects without a write; all counts use unique questions',()=>{
  const s=fixture(),before=JSON.stringify(s),{rows}=notebookIndex(s);
  for(const subject of subjects){
    const list=filterRows(rows,{...emptyFilters(),subject,kind:'unassigned'});
    assert.equal(list.length,1);assert.deepEqual(groupCounts(list).get('all'),{unique:1,events:2,repeated:1,learning:1});
  }
  assert.equal(JSON.stringify(s),before);
});
test('hierarchy and multiple themes deduplicate; search and document reclassification use current source',()=>{
  const s=fixture(),d=s.documents[3],id=d.id+'#7';
  assignTheme(s,[id],'a');s.questions.at(-1).secondary=['b'];s.questions.at(-1).text='가상 기출 검색어';
  const f={...emptyFilters(),subject:'행정학',book:'book',part:'part',chapter:'chapter',themeIds:['a','b'],year:'2025',exam:'가상 시험',search:'검색어'};
  const rows=filterRows(notebookIndex(s).rows,f);assert.equal(rows.length,1);assert.equal(groupCounts(rows).get('chapter:chapter').events,2);
  changeDocumentSubject(s,d,'영어');assert.equal(filterRows(notebookIndex(s).rows,f).length,0);assert.equal(s.questions.at(-1).theme,null);
  changeDocumentSubject(s,d,'행정학');assert.deepEqual(s.questions.at(-1).secondary,['b']);assert.equal(s.questions.at(-1).theme,'a');
});
test('single attempt and bulk removal share event source; undo survives backup and re-recording',()=>{
  const s=fixture(),original=structuredClone(s),q=s.questions[0];q.regions=[{page:1,x:.1,y:.2,w:.4,h:.1}];
  removeEvents(s,[s.events[0]]);assert.equal(stats(s).get(q.id),1);
  const batch=s.removedMistakes[0].id;record(s,s.documents[0],original.events[0].session,[7]);restoreEvents(s,batch);assert.equal(stats(s).get(q.id),2);
  const all=[...s.events];removeEvents(s,all);assert.equal(notebookIndex(s).rows.length,0);
  const copy=validate(JSON.parse(JSON.stringify(s)));restoreEvents(copy,copy.removedMistakes[0].id);
  assert.equal(notebookIndex(copy).rows.length,4);assert.equal(copy.events.length,8);assert.deepEqual(copy.documents,original.documents);assert.deepEqual(copy.questions[0].regions,q.regions);
  setStatus(copy,[q.id],'숙지 완료');assert.equal(groupCounts(notebookIndex(copy).rows).get('subject:국어').learning,0);
});
