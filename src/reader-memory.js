import {get,putMeta,transaction} from './db.js';
const positions=new Map(),drafts=new Map();
function retain(map,key,value,limit=32){
  map.delete(key);map.set(key,value);if(map.size>limit)map.delete(map.keys().next().value);
}
export async function readPosition(d){
  const position=positions.get(d.id)||await get('meta','reader:'+d.id)||d.readerPosition;
  return position?.hash===d.hash?position:{page:d.page||1,zoom:1};
}
export function writePosition(d,value){
  const p={...value,id:d.id,hash:d.hash};retain(positions,d.id,p);
  return putMeta('reader:'+d.id,p).finally(()=>{if(positions.get(d.id)===p)positions.delete(d.id)});
}
export const readDraft=(id,session)=>drafts.get(JSON.stringify([id,session]));
export function rememberDraft(id,session,selected,baseline){
  const key=JSON.stringify([id,session]),add=[...selected].filter(n=>!baseline.has(n)),remove=[...baseline].filter(n=>!selected.has(n));
  if(add.length||remove.length)retain(drafts,key,{add,remove},16);else drafts.delete(key);
}
export function mergeDraft(current,draft){
  const values=new Set(current);
  for(const n of draft?.add||[])values.add(n);for(const n of draft?.remove||[])values.delete(n);
  return values;
}
export const recentViews=()=>get('meta','library:recent');
export function viewed(d,anchor){
  const item={id:d.id,anchor:anchor||d.id,time:new Date().toISOString()};
  return transaction(['meta'],'readwrite',({meta},read)=>read(meta.get('library:recent'),rows=>{
    meta.put([item,...(rows||[]).filter(r=>r.anchor!==item.anchor&&r.id!==item.id)].slice(0,60),'library:recent');
  }));
}
export function recentGroups(docs,recent){
  const byId=new Map(docs.map(d=>[d.id,d])),seen=new Set(),legacy=docs.filter(d=>d.opened).map(d=>({id:d.id,anchor:d.id,time:d.opened}));
  return [...(recent||[]),...legacy].sort((a,b)=>b.time.localeCompare(a.time)).filter(entry=>{
    if(!byId.has(entry.id)||seen.has(entry.anchor)||seen.has(entry.id))return false;
    seen.add(entry.anchor);seen.add(entry.id);return true;
  });
}
export function clearRecent(){
  return transaction(['meta'],'readwrite',({meta},read)=>read(meta.get('archive'),s=>{
    if(s){for(const d of s.documents)delete d.opened;meta.put(s,'archive')}meta.delete('library:recent');
  }));
}
