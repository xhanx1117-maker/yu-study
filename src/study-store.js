import {legacyRows,occurrenceId,rankOccurrences,snapshots,studyDay,summarizeAttempts,takeChanges,validDay} from './study-events.js';

export const revisionKey='study:revision';
export function upgradeStudy(db,tx,progress){
  const store=db.createObjectStore('studyLog',{keyPath:'id'});
  for(const [name,path] of [['day','day'],['subjectDay',['subject','day']],['question','q'],['session','session']])store.createIndex(name,path);
  const archive=tx.objectStore('meta').get('archive');
  archive.onsuccess=()=>{
    if(!archive.result)return;
    // Each group stays in the versionchange transaction. Failure rolls back the entire upgrade.
    const rows=legacyRows(archive.result);let i=0;
    function batch(){
      let last;const end=Math.min(i+200,rows.length);
      if(rows.length>1000&&i%1000===0)progress(i,rows.length);
      while(i<end)last=store.add(rows[i++]);
      if(i<rows.length)last.onsuccess=batch;
    }
    batch();
  };
}
function refreshTotals(store,questions,sessions,read){
  for(const q of questions)read(store.index('question').getAll(q),rows=>{
    for(const changed of rankOccurrences(rows))store.put(changed);
  });
  for(const id of sessions)read(store.get('solved:'+id),solved=>{
    if(solved?.kind!=='solved')return;
    // This index includes the completion itself and any undated legacy mistakes.
    read(store.index('session').count(id),count=>{
      const wrongInSession=count-1;
      if(solved.wrongInSession!==wrongInSession)store.put({...solved,wrongInSession});
    });
  });
}
const removed=(id,edited)=>({id,removed:true,edited});
export function flushStudy(store,archive,read){
  const ops=takeChanges(archive);
  if(!ops.length)return false;
  const context=snapshots(archive,ops),questions=new Set(),sessions=new Set();
  function step(i){
    if(i===ops.length){refreshTotals(store,questions,sessions,read);return}
    const op=ops[i],row=op.event?context.wrong(op.event):op.completion?context.solved(op.completion):null;
    if(!row&&!op.withdraw){step(i+1);return}
    read(store.get(op.withdraw||row.id),old=>{
      if(op.withdraw){
        if(old?.q){questions.add(old.q);sessions.add(old.session)}
        store.put(removed(op.withdraw,new Date().toISOString()));
      }else if(!old||old.removed&&op.completion){
        if(old)row.edited=new Date().toISOString();
        store.put(row);sessions.add(row.session);if(row.q)questions.add(row.q);
      }
      step(i+1);
    });
  }
  step(0);return true;
}
function isTheme(t){return t&&typeof t.id==='string'&&typeof t.label==='string'}
export function verifyStudyRows(rows){
  if(rows===undefined)return [];
  if(!Array.isArray(rows))throw Error('학습 기록 형식 오류');
  const ids=new Set();
  for(const r of rows){
    if(!r||typeof r.id!=='string'||!r.id||ids.has(r.id))throw Error('학습 기록 ID 오류');
    ids.add(r.id);
    if(r.edited&&(typeof r.edited!=='string'||!Number.isFinite(Date.parse(r.edited))))throw Error('학습 기록 정정 일시 오류');
    if(r.removed){if(!r.edited)throw Error('학습 기록 취소 일시 오류');continue}
    if(typeof r.doc!=='string'||!r.doc||typeof r.session!=='string'||!r.session)throw Error('학습 기록 시험 정보 오류');
    if(r.kind==='wrong'||r.kind==='undated'){
      if(!Number.isInteger(r.number)||r.number<1||r.number>300||r.q!==r.doc+'#'+r.number)throw Error('학습 기록 문항 정보 오류');
      if(r.kind==='undated'){if(r.day||r.time)throw Error('날짜 미상 기록 오류');continue}
      if(r.primary&&!isTheme(r.primary)||!Array.isArray(r.secondary)||!r.secondary.every(isTheme))throw Error('학습 기록 테마 오류');
    }else if(r.kind!=='solved'||r.id!=='solved:'+r.session)throw Error('학습 기록 유형 오류');
    if(!r.subject||typeof r.time!=='string'||!validDay(r.day)||studyDay(r.time)!==r.day)throw Error('학습 기록 내용 오류');
  }
  return rows;
}
function mergeIntoNotebook(archive,cancelled,dates){
  function keep(e){
    const id=occurrenceId(e);if(cancelled.has(id))return false;
    const date=dates.get(id);
    if(date&&e.date!==date){
      // Legacy backup/trash keys use the registration instant as the attempt identity.
      if(!e.instance&&!e.registrationDate)e.registrationDate=e.date;
      e.date=date;
    }
    return true;
  }
  if(!cancelled.size&&!dates.size)return;
  archive.events=archive.events.filter(keep);
  if(archive.removedMistakes)archive.removedMistakes=archive.removedMistakes.map(b=>({...b,events:b.events.filter(keep)})).filter(b=>b.events.length);
}
function clearCompletion(archive,attempt){
  if(!attempt)return;
  delete attempt.solvedAt;
  const doc=archive.documents.find(d=>d.id===attempt.doc);
  if(doc?.session===attempt.id&&doc.studyState==='풀이 완료')delete doc.studyState;
}
export function restoreStudy(store,read,archive,incoming,provided,merge,onReady){
  const rows=new Map(provided.map(r=>[r.id,r]));
  for(const row of legacyRows(incoming,new Set(rows.keys())))rows.set(row.id,row);
  const sources=new Map(archive.documents.map(d=>[d.hash,d.id]));
  const remap=new Map(incoming.documents.map(d=>[d.id,sources.get(d.hash)||d.id]));
  const attempts=new Map(archive.sessions.map(a=>[a.id,a])),cancelled=new Set(),dates=new Map();
  const questions=new Set(),sessions=new Set();
  const items=[...rows.values()].map(source=>{
    if(source.removed)return removed(source.id,source.edited);
    const doc=remap.get(source.doc)||source.doc;
    return {...source,doc,...(source.q?{q:doc+'#'+source.number}:{})};
  });
  function reconcile(row){
    if(row.removed){
      cancelled.add(row.id);
      if(row.id.startsWith('solved:'))clearCompletion(archive,attempts.get(row.id.slice(7)));
    }else if(row.kind==='solved'){
      const a=attempts.get(row.session);if(a)a.solvedAt=row.time;
    }else if(row.edited&&row.time)dates.set(row.id,row.time);
  }
  if(!merge){store.clear();summarizeAttempts(items)}
  function batch(start){
    if(start>=items.length){
      if(merge)refreshTotals(store,questions,sessions,read);
      mergeIntoNotebook(archive,cancelled,dates);onReady();return;
    }
    const end=Math.min(start+180,items.length);
    for(let i=start;i<end;i++){
      const row=items[i],advance=()=>{if(i===end-1)batch(end)};
      if(!merge){reconcile(row);const put=store.put(row);if(i===end-1)read(put,advance);continue}
      read(store.get(row.id),old=>{
        if(!old||(row.edited||'')>(old.edited||'')||(row.removed&&!old.removed&&row.edited===old.edited)){
          store.put(row);
          for(const entry of [row,old]){if(entry?.q)questions.add(entry.q);if(entry?.session)sessions.add(entry.session)}
          reconcile(row);
        }else reconcile(old);
        advance();
      });
    }
  }
  batch(0);
}
export function correctStudyRow(store,read,row,date,archive,meta){
  if(date!==null&&!validDay(date))throw Error('정정할 날짜를 확인하세요.');
  read(store.get(row.id),live=>{
    if(!live||live.removed||live.time!==row.time||live.edited!==row.edited)throw Error('기록이 변경되었습니다. 다시 열어 확인하세요.');
    if(date===live.day)return;
    const edited=new Date().toISOString(),attempt=live.kind==='solved'&&archive.sessions.find(a=>a.id===live.session);
    if(date===null){
      store.put(removed(live.id,edited));
      if(live.q)mergeIntoNotebook(archive,new Set([live.id]),new Map());else clearCompletion(archive,attempt);
    }else{
      const clock=new Date(Date.parse(live.time)+9*3600000).toISOString().slice(11,23);
      const time=validDay(live.time)?date:new Date(date+'T'+clock+'+09:00').toISOString();
      store.put({...live,time,day:date,edited});
      if(live.q)mergeIntoNotebook(archive,new Set(),new Map([[live.id,time]]));else if(attempt)attempt.solvedAt=time;
    }
    if(live.q)refreshTotals(store,[live.q],date===null?[live.session]:[],read);
    meta.put(crypto.randomUUID(),revisionKey);meta.put(archive,'archive');
  });
}
