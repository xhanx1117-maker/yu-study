import {subjects, themes} from './model.js';

import {searchKey} from './search.js';

export const statuses = ['미복습', '복습 필요', '부분 이해', '숙지 완료'];
export const orders = {recent:'최근 오답순', year:'연도순', theme:'테마 번호순', repeated:'오답 횟수순'};
export const emptyFilters = () => ({subject:'', year:'', exam:'', book:'', part:'', chapter:'', themeIds:[], kind:'', status:'', search:'', sort:'recent'});

function rowText({question,doc,linked}) {
  const detected = doc.detected?.[question.number]?.text;
  return searchKey([question.text, detected === question.text ? '' : detected, doc.title, question.memo,
    ...linked.map(t=>t.title)].filter(Boolean).join(' '));
}

export function notebookIndex(archive, {searchable=false}={}) {
  const docs = new Map(archive.documents.map(doc => [doc.id, doc]));
  const catalog = themes({schemaVersion:1, books:archive.books}).filter(t => t.enabled);
  const themeMap = new Map(catalog.map(theme => [theme.id, theme]));
  const histories = new Map();
  for (const event of archive.events) {
    if (!histories.has(event.q)) histories.set(event.q, []);
    histories.get(event.q).push(event);
  }
  const rows = [];
  for (const question of archive.questions) {
    const events = histories.get(question.id), doc = docs.get(question.doc);
    if (!events?.length || !doc) continue;
    const linked = [...new Set([question.theme, ...question.secondary])].map(id => themeMap.get(id))
      .filter(t => t && t.subject === doc.subject);
    const latest = events.reduce((date, event) => (event.date || '') > date ? event.date : date, '');
    const row = {id:question.id, question, doc, events, latest, count:events.length, linked};
    if (searchable) row.searchText = rowText(row);
    rows.push(row);
  }
  return {rows, docs, catalog, themeMap, byId:new Map(rows.map(row => [row.id,row]))};
}

const collator = new Intl.Collator('ko', {numeric:true});
function themeNumber(row) { return String(row.linked[0]?.number ?? row.linked[0]?.title ?? '\uffff'); }
export function sortRows(rows, order) {
  const compare = {
    recent:(a,b) => b.latest.localeCompare(a.latest),
    year:(a,b) => collator.compare(String(b.doc.year || ''), String(a.doc.year || '')),
    theme:(a,b) => collator.compare(themeNumber(a), themeNumber(b)),
    repeated:(a,b) => b.count - a.count,
  }[order] || (() => 0);
  return [...rows].sort((a,b) => compare(a,b) || collator.compare(a.doc.title,b.doc.title) ||
    a.question.number-b.question.number || a.id.localeCompare(b.id));
}

export function filterCandidates(rows, f) {
  const ids = new Set(f.themeIds);
  return sortRows(rows.filter(({question:q, doc, count, linked}) => {
    if ((f.subject && f.subject!==doc.subject) || (f.year && f.year!==String(doc.year??'')) || (f.exam && f.exam!==doc.exam)) return false;
    if (f.status && f.status!==q.status) return false;
    if (f.kind==='unassigned' && linked.length || f.kind==='repeated' && count<2 || f.kind==='learning' && q.status==='숙지 완료') return false;
    if (f.book || f.part || f.chapter || ids.size) {
      if (!linked.some(t => (!f.book || t.book===f.book) && (!f.part || t.partId===f.part) &&
          (!f.chapter || t.chapterId===f.chapter) && (!ids.size || ids.has(t.id)))) return false;
    }
    return true;
  }), f.sort);
}

export function searchRows(candidates, draft) {
  const needle = searchKey(draft).trim();
  return needle ? candidates.filter(row => (row.searchText ?? rowText(row)).includes(needle)) : candidates;
}

export function filterRows(rows, filters) {
  return searchRows(filterCandidates(rows, filters), filters.search);
}

export function totals(rows) {
  return rows.reduce((t,r) => {
    t.unique++; t.events+=r.count;
    if (r.count>1) t.repeated++;
    if (r.question.status!=='숙지 완료') t.learning++;
    return t;
  },{unique:0,events:0,repeated:0,learning:0});
}

export function groupCounts(rows) {
  const counts = new Map();
  for (const row of rows) {
    const keys = new Set(['all','subject:'+row.doc.subject, 'year:'+row.doc.year]);
    if (!row.linked.length) keys.add('kind:unassigned');
    if (row.count>1) keys.add('kind:repeated');
    if (row.question.status!=='숙지 완료') keys.add('kind:learning');
    for (const t of row.linked) {
      keys.add('book:'+t.book); keys.add('theme:'+t.id);
      if(t.partId) keys.add('part:'+t.partId);
      if(t.chapterId) keys.add('chapter:'+t.chapterId);
    }
    for(const key of keys) {
      if(!counts.has(key)) counts.set(key,{unique:0,events:0,repeated:0,learning:0});
      const value=counts.get(key);
      value.unique++; value.events+=row.count;
      if(row.count>1)value.repeated++;
      if(row.question.status!=='숙지 완료')value.learning++;
    }
  }
  return counts;
}

// Keep the old subject's assignments available if a document is reclassified back.
export function changeDocumentSubject(archive, doc, subject) {
  if(doc.subject===subject)return;
  const catalog = themes({schemaVersion:1,books:archive.books});
  const allowed = new Set(catalog.filter(t=>t.enabled && t.subject===subject).map(t=>t.id));
  for(const q of archive.questions.filter(q=>q.doc===doc.id)){
    q.themesBySubject ||= {};
    if(subjects.includes(doc.subject)) q.themesBySubject[doc.subject]={theme:q.theme,secondary:[...q.secondary]};
    const previous=q.themesBySubject[subject];
    q.theme=allowed.has(previous?.theme)?previous.theme:null;
    q.secondary=(previous?.secondary||[]).filter(id=>allowed.has(id)&&id!==q.theme);
  }
  doc.subject=subject;
}

export function assignTheme(archive, ids, themeId) {
  const selected=new Set(ids), docs=new Map(archive.documents.map(d=>[d.id,d]));
  const theme=themes({schemaVersion:1,books:archive.books}).find(t=>t.id===themeId&&t.enabled);
  for(const q of archive.questions.filter(q=>selected.has(q.id))){
    if(themeId && (!theme || theme.subject!==docs.get(q.doc)?.subject))throw Error('같은 과목의 문항과 테마를 선택하세요.');
    q.theme=themeId || null;
    q.secondary=themeId?q.secondary.filter(id=>id!==themeId):[];
  }
}

export function setStatus(archive, ids, status) {
  if(!statuses.includes(status))throw Error('숙지 상태를 확인하세요.');
  const selected=new Set(ids), date=new Date().toISOString();
  for(const q of archive.questions.filter(q=>selected.has(q.id)&&q.status!==status)){
    q.status=status;
    archive.reviews.push({id:crypto.randomUUID(),q:q.id,date,status});
  }
}

// The preview identifies exact events. An attempt newly recorded in another tab survives.
export function removeEvents(archive, expected) {
  const selected=new Map(expected.map(e=>[e.id,e]));
  const removed=archive.events.filter(e=>{
    const old=selected.get(e.id);
    return old && old.q===e.q && old.session===e.session && old.date===e.date;
  });
  if(removed.length!==selected.size)throw Error('오답 기록이 변경되었습니다. 목록을 다시 열어 확인하세요.');
  if(!removed.length) return;
  const keys=new Set(removed.map(e=>e.id));
  archive.events=archive.events.filter(e=>!keys.has(e.id));
  (archive.removedMistakes ||= []).unshift({id:crypto.randomUUID(),date:new Date().toISOString(),events:removed});
}

// A session can be unmarked and marked again. Only the removed occurrence is
// suppressed when an older archive is brought back to this device.
export function attemptKey(event){
  return JSON.stringify([event.id,event.q,event.instance||event.registrationDate||event.date||'']);
}
export function trashEntries(archive){
  return (archive.removedMistakes||[]).flatMap(batch=>batch.events.map(event=>({
    key:JSON.stringify([batch.id,attemptKey(event)]),batch:batch.id,date:batch.date,event
  })));
}
export function reconcilePurged(archive,previous=[]){
  const keys=new Set([...previous,...(archive.purgedAttempts||[])]);
  if(!keys.size)return archive;
  archive.purgedAttempts=[...keys];
  archive.events=archive.events.filter(e=>!keys.has(attemptKey(e)));
  archive.removedMistakes=(archive.removedMistakes||[]).map(batch=>({...batch,
    events:batch.events.filter(e=>!keys.has(attemptKey(e)))})).filter(batch=>batch.events.length);
  return archive;
}
export function changeTrash(archive,expected,operation){
  if(!['restore','purge'].includes(operation))throw Error('휴지통 작업을 확인하세요.');
  const selected=new Set(expected),entries=trashEntries(archive).filter(row=>selected.has(row.key));
  if(entries.length!==selected.size)throw Error('휴지통 내용이 바뀌었습니다. 다시 열어 확인하세요.');
  const active=new Set(archive.events.map(e=>e.id)),purged=new Set(archive.purgedAttempts||[]);
  for(const {event} of entries){
    const key=attemptKey(event);
    if(operation==='purge')purged.add(key);
    else if(!purged.has(key)&&!active.has(event.id)){archive.events.push(event);active.add(event.id)}
  }
  archive.removedMistakes=(archive.removedMistakes||[]).map(batch=>({...batch,events:
    batch.events.filter(e=>!selected.has(JSON.stringify([batch.id,attemptKey(e)])))})).filter(batch=>batch.events.length);
  if(operation==='purge')reconcilePurged(archive,[...purged]);
}
export function restoreEvents(archive,batchId){
  changeTrash(archive,trashEntries(archive).filter(e=>e.batch===batchId).map(e=>e.key),'restore');
}
