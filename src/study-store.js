import {chronological,legacyRows,occurrenceId,snapshots,studyDay,takeChanges,validDay} from './study-events.js';

export function upgradeStudy(db,tx){
  const store=db.createObjectStore('studyLog',{keyPath:'id'});
  for(const [name,path] of [['day','day'],['subjectDay',['subject','day']],['question','q'],['mistakeSession','mistakeSession']])store.createIndex(name,path);
  const archive=tx.objectStore('meta').get('archive');
  archive.onsuccess=()=>{
    if(!archive.result)return;
    // Queue bounded groups inside the versionchange transaction. A failed upgrade rolls back.
    const rows=legacyRows(archive.result);let i=0;
    function batch(){let last;const end=Math.min(i+200,rows.length);while(i<end)last=store.add(rows[i++]);if(i<rows.length)last.onsuccess=batch}
    batch();
  };
}
function rerank(store,questions,read){
  for(const q of questions)read(store.index('question').getAll(q),rows=>{
    rows.sort(chronological).forEach((row,i)=>{if(row.count!==i+1)store.put({...row,count:i+1})});
  });
}
const removed=(id,edited)=>({id,removed:true,edited});
export function flushStudy(store,archive,read){
  const ops=takeChanges(archive);
  if(!ops.length)return;
  const context=snapshots(archive,ops),changed=new Set();
  // A fetch can enqueue a write. Process each operation before ranking the affected questions.
  function step(i){
    if(i===ops.length){rerank(store,changed,read);return}
    const op=ops[i],row=op.event?context.wrong(op.event):op.completion?context.solved(op.completion):null;
    if(!row&&!op.withdraw){step(i+1);return}
    read(store.get(op.withdraw||row.id),old=>{
      if(op.withdraw){
        if(old?.q)changed.add(old.q);
        store.put(removed(op.withdraw,new Date().toISOString()));
      }else if(!old){store.add(row);if(row.q)changed.add(row.q)}
      else if(old.removed&&op.completion)store.put({...row,edited:new Date().toISOString()});
      step(i+1);
    });
  }
  step(0);
}
export function verifyStudyRows(rows){
  if(rows===undefined)return [];
  if(!Array.isArray(rows))throw Error('학습 기록 형식 오류');
  const ids=new Set();
  for(const r of rows){
    if(!r||typeof r.id!=='string'||!r.id||ids.has(r.id))throw Error('학습 기록 ID 오류');
    ids.add(r.id);
    if(r.edited&&(!Number.isFinite(Date.parse(r.edited))))throw Error('학습 기록 정정 일시 오류');
    if(r.removed){if(!r.edited)throw Error('학습 기록 취소 일시 오류');continue}
    if(!['wrong','solved'].includes(r.kind)||!r.doc||!r.session||!r.subject||!validDay(r.day)||studyDay(r.time)!==r.day||
      (r.kind==='wrong'&&(!r.q||!Number.isInteger(r.number)||r.number<1||!Array.isArray(r.secondary))))throw Error('학습 기록 내용 오류');
  }
  return rows;
}
export function restoreStudy(store,read,archive,incoming,provided,merge,onReady){
  // Older ZIPs contain only dated sessions and notebook events. Prefer the original snapshot when present.
  const rows=new Map(legacyRows(incoming).map(r=>[r.id,r])),sources=new Map(archive.documents.map(d=>[d.hash,d.id]));
  const remap=new Map(incoming.documents.map(d=>[d.id,sources.get(d.hash)||d.id]));
  for(const r of provided)rows.set(r.id,r);
  if(!merge)store.clear();
  const touched=new Set(),cancelled=new Set(),sessions=new Map(archive.sessions.map(a=>[a.id,a]));
  const items=[...rows.values()].map(source=>{
    if(source.removed)return removed(source.id,source.edited);
    const doc=remap.get(source.doc)||source.doc;
    return {...source,doc,...(source.kind==='wrong'?{q:doc+'#'+source.number,mistakeSession:source.session}:{})};
  });
  function reconcile(row){
    if(row.removed){
      cancelled.add(row.id);
      if(row.id.startsWith('solved:')){const session=sessions.get(row.id.slice(7));if(session)delete session.solvedAt}
    }else if(row.kind==='solved'&&row.edited){const session=sessions.get(row.session);if(session)session.solvedAt=row.time}
  }
  function finish(){
    if(merge)rerank(store,touched,read);
    if(cancelled.size){
      archive.events=archive.events.filter(e=>!cancelled.has(occurrenceId(e)));
      archive.removedMistakes=(archive.removedMistakes||[]).map(b=>({...b,events:b.events.filter(e=>!cancelled.has(occurrenceId(e)))})).filter(b=>b.events.length);
    }
    onReady();
  }
  if(!merge){
    const counts=new Map();
    for(const row of items.filter(r=>r.kind==='wrong').sort(chronological)){
      row.count=(counts.get(row.q)||0)+1;counts.set(row.q,row.count);
    }
  }
  function batch(start){
    if(start>=items.length){finish();return}
    const end=Math.min(start+180,items.length);
    for(let i=start;i<end;i++){
      const row=items[i],advance=()=>{if(i===end-1)batch(end)};
      if(!merge){reconcile(row);const put=store.put(row);if(i===end-1)read(put,advance);continue}
      read(store.get(row.id),old=>{
        if(!old||(row.edited||'')>(old.edited||'')){
          store.put(row);if(row.q)touched.add(row.q);if(old?.q)touched.add(old.q);reconcile(row);
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
    const edited=new Date().toISOString();
    if(date===null){
      store.put(removed(live.id,edited));
      if(live.kind==='wrong'){
        archive.events=archive.events.filter(e=>occurrenceId(e)!==live.id);
        archive.removedMistakes=(archive.removedMistakes||[]).map(b=>({...b,events:b.events.filter(e=>occurrenceId(e)!==live.id)})).filter(b=>b.events.length);
      }else{const a=archive.sessions.find(a=>a.id===live.session);if(a)delete a.solvedAt}
    }else{
      const clock=new Date(Date.parse(live.time)+9*3600000).toISOString().slice(11,23);
      const time=validDay(live.time)?date:new Date(date+'T'+clock+'+09:00').toISOString();
      store.put({...live,time,day:date,edited});
      if(live.kind==='solved'){const a=archive.sessions.find(a=>a.id===live.session);if(a)a.solvedAt=time}
    }
    if(live.q)rerank(store,new Set([live.q]),read);
    meta.put(archive,'archive');
  });
}
