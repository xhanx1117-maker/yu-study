// An occurrence keeps its identity when an active notebook entry moves to the trash.
const pending=new WeakMap();
const koreanDate=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'});
export function studyDay(time){
  const instant=new Date(time);
  return time&&Number.isFinite(instant.valueOf())?koreanDate.format(instant):'';
}
export function validDay(day){
  if(!/^\d{4}-\d\d-\d\d$/.test(day||''))return false;
  const d=new Date(day+'T12:00:00Z');
  return Number.isFinite(+d)&&d.toISOString().slice(0,10)===day;
}
function shift(day,delta){const d=new Date(day+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+delta);return d.toISOString().slice(0,10)}
export function periodRange(preset,now=new Date()){
  const end=studyDay(now);
  if(preset==='어제'){const day=shift(end,-1);return [day,day]}
  if(preset==='이번 달')return [end.slice(0,7)+'-01',end];
  const delta={'오늘':0,'최근 7일':6,'최근 30일':29,'이번 주':(new Date(end+'T12:00:00Z').getUTCDay()+6)%7}[preset];
  return [shift(end,-(delta??0)),end];
}
export function occurrenceId(e){return e.instance?'wrong:'+e.instance:'legacy:'+JSON.stringify([e.id,e.date])}
function queue(archive,op){if(!pending.has(archive))pending.set(archive,[]);pending.get(archive).push(op)}
export function recordAdded(s,event){queue(s,{event})}
export function recordWithdrawn(s,event){queue(s,{withdraw:occurrenceId(event)})}
export function completeSession(s,session,when){
  if(session&&!session.solvedAt){session.solvedAt=when;queue(s,{completion:session})}
}
export function takeChanges(s){const ops=pending.get(s)||[];pending.delete(s);return ops}
function themeMap(books){
  const labels=new Map();
  for(const book of books){
    const add=rows=>{for(const row of rows||[])labels.set(row.id,[row.number,row.title].filter(Boolean).join(' '))};
    add(book.themes);add(book.referenceSections);
    for(const part of book.parts||[])for(const ch of part.chapters||[])add(ch.themes);
  }
  return labels;
}
export function snapshots(s,ops=null){
  const ids=ops&&new Set(ops.map(o=>o.event?.q).filter(Boolean));
  const sessions=ops&&new Set(ops.map(o=>o.event?.session||o.completion?.id).filter(Boolean));
  const docs=sessions&&new Set(s.sessions.filter(a=>sessions.has(a.id)).map(a=>a.doc));
  const documents=new Map((docs?s.documents.filter(d=>docs.has(d.id)):s.documents).map(d=>[d.id,d]));
  const questions=new Map((ids?s.questions.filter(q=>ids.has(q.id)):s.questions).map(q=>[q.id,q]));
  const attempts=new Map(),counts=new Map(),labels=themeMap(s.books);
  for(const a of s.sessions){if(docs&&!docs.has(a.doc))continue;const n=(counts.get(a.doc)||0)+1;counts.set(a.doc,n);if(!sessions||sessions.has(a.id))attempts.set(a.id,{a,n})}
  function base(kind,id,time,sessionId,legacy){
    if(!time||typeof time!=='string'||(!validDay(time)&&!/(?:Z|[+-]\d\d:?\d\d)$/i.test(time)))return;
    const day=studyDay(time),attempt=attempts.get(sessionId),doc=documents.get(attempt?.a.doc);
    if(!day||!doc)return;
    return {id,kind,time:validDay(time)?time:new Date(time).toISOString(),day,subject:doc.subject||'미분류',doc:doc.id,title:doc.title||doc.filename||'',
      year:doc.year||'',exam:doc.exam||'',grade:doc.grade||String(doc.exam||'').match(/[1-9]급/)?.[0]||'',rank:doc.rank||'',round:doc.round||'',cohort:doc.cohort||'',
      form:doc.form||'',session:sessionId,sessionNumber:attempt.n,legacy};
  }
  return {
    wrong(e,legacy=false){
      const row=base('wrong',occurrenceId(e),e.date,e.session,legacy),q=questions.get(e.q);
      if(!row||!q)return;
      const theme=id=>({id,label:labels.get(id)||id});
      return {...row,q:q.id,number:q.number,eventId:e.id,mistakeSession:e.session,primary:q.theme?theme(q.theme):null,
        secondary:(q.secondary||[]).filter(Boolean).map(theme),status:q.status||'',count:0};
    },
    solved(a,legacy=false){return base('solved','solved:'+a.id,a.solvedAt,a.id,legacy)}
  };
}
export function legacyRows(s){
  const rows=new Map(),context=snapshots(s),counts=new Map();
  function add(e){const r=context.wrong(e,true);if(r)rows.set(r.id,r)}
  for(const e of s.events)add(e);
  for(const b of s.removedMistakes||[])for(const e of b.events)add(e);
  const result=[...rows.values()].sort(chronological);
  for(const row of result){row.count=(counts.get(row.q)||0)+1;counts.set(row.q,row.count)}
  for(const a of s.sessions){const row=context.solved(a,true);if(row)result.push(row)}
  return result;
}
export const chronological=(a,b)=>a.time.localeCompare(b.time)||a.id.localeCompare(b.id);
