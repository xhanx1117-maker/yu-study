import {materialIndex,materialKind} from './materials.js';

// Resolve references as if the selected originals were restored. Trashing a key
// must not make its live references disappear from the purge check.
export function trashPlan(s,ids){
  const wanted=new Set(ids),targets=s.documents.filter(d=>d.deleted&&wanted.has(d.id)),protectedIds=new Set();
  const paperIds=new Set(targets.filter(d=>materialKind(d)==='문제지').map(d=>d.id));
  const index=materialIndex(s.documents.map(d=>d.deleted?{...d,deleted:false}:d));
  for(const d of s.documents)if(!wanted.has(d.id)||!d.deleted){
    for(const id of [d.answerId,...(d.answerIds||[]),...(d.solutionIds||[])])if(id)protectedIds.add(id);
    const group=index.groups.get(d.id);
    if(group)for(const linked of [...group.answers,...group.solutions])protectedIds.add(linked.id);
  }
  for(const q of s.questions)if(q.solution?.doc&&!paperIds.has(q.doc))protectedIds.add(q.solution.doc);
  const eligible=targets.filter(d=>!protectedIds.has(d.id)),removing=new Set(eligible.map(d=>d.id));
  const stats=new Map(eligible.map(d=>[d.id,{id:d.id,hash:d.hash,questions:0,events:0,reviews:0,trash:0}]));
  const questions=new Map();
  for(const q of s.questions)if(removing.has(q.doc)){const row=stats.get(q.doc);row.questions++;questions.set(q.id,row)}
  for(const e of s.events)if(questions.has(e.q))questions.get(e.q).events++;
  for(const r of s.reviews)if(questions.has(r.q))questions.get(r.q).reviews++;
  for(const b of s.removedMistakes||[])for(const e of b.events)if(questions.has(e.q))questions.get(e.q).trash++;
  const held=new Set(s.documents.filter(d=>!removing.has(d.id)).map(d=>d.hash));
  let bytes=0;for(const d of eligible)if(!held.has(d.hash)){bytes+=d.size||0;held.add(d.hash)}
  return {rows:[...stats.values()].sort((a,b)=>Number(paperIds.has(b.id))-Number(paperIds.has(a.id))),protectedCount:targets.length-eligible.length,bytes};
}
export function removeSources(s,items){
  const ids=new Set(items.map(row=>row.id)),qs=new Set(s.questions.filter(q=>ids.has(q.doc)).map(q=>q.id));
  s.documents=s.documents.filter(d=>!ids.has(d.id));
  s.questions=s.questions.filter(q=>!qs.has(q.id));s.sessions=s.sessions.filter(a=>!ids.has(a.doc));
  s.events=s.events.filter(e=>!qs.has(e.q));s.reviews=s.reviews.filter(r=>!qs.has(r.q));
  if(s.removedMistakes)s.removedMistakes=s.removedMistakes.map(b=>({...b,events:b.events.filter(e=>!qs.has(e.q))})).filter(b=>b.events.length);
}
