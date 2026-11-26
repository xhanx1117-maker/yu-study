import {state,get,change,hash,digestBytes,transaction,exclusive,entries} from './db.js';
import {validate,initial} from './model.js';
import {attemptKey,reconcilePurged} from './notebook-model.js';
import {openZip,makeZip} from './archive-zip.js';

export function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000)}
const externalKey=d=>'auto-regions:'+d.id+':'+d.hash;
async function portableMeta(s){
  // Serialize one paper at a time. Old clients can open this version-1 backup:
  // generated regions are folded into their original detected field on export.
  const {documents,...rest}=s,parts=[JSON.stringify(rest).slice(0,-1),',"documents":['];
  const positions=new Map((await entries('reader:')).map(p=>[p.id,p])),recent=await get('meta','library:recent')||[];
  const dates=new Map(recent.map(r=>[r.id,r.time]));
  for(const [index,d] of documents.entries()){
    let doc=d;
    if(d.externalRegions){
      const map=await get('meta',externalKey(d));if(!map)throw Error('문항 분석 자료가 누락되었습니다.');
      doc={...d,detected:{...map,...d.detected}};delete doc.externalRegions;
    }
    if(positions.get(d.id)?.hash===d.hash)doc={...doc,readerPosition:positions.get(d.id),page:positions.get(d.id).page};
    if(dates.has(d.id))doc={...doc,opened:dates.get(d.id)};
    parts.push(index?',':'',JSON.stringify(doc));
  }
  parts.push(']}');return new Blob(parts,{type:'application/json'});
}
export async function backup(){
  return exclusive(async()=>{
    const s=await state(),created=new Date().toISOString(),meta=await portableMeta(s),keys=[...new Set(s.documents.map(d=>d.hash))];
    const manifest={format:'yu-study',version:1,created,files:keys,metadataHash:await hash(meta)};
    async function* members(){
      yield {path:'archive.json',blob:meta};yield {path:'manifest.json',blob:new Blob([JSON.stringify(manifest)])};
      for(const k of keys){
        const blob=await get('files',k);
        if(!blob||await hash(blob)!==k)throw Error('원본 PDF 무결성 오류');
        yield {path:'files/'+k,blob};
      }
    }
    download(await makeZip(members()),'Yu-study-backup-'+created.slice(0,10)+'.zip');
    await change(current=>{current.lastBackup=created});
  });
}
function mergeRecords(existing,incoming){
  const byHash=new Map(existing.documents.map(d=>[d.hash,d])),byId=new Map(existing.documents.map(d=>[d.id,d])),map=new Map();
  for(const d of incoming.documents){
    if(byId.has(d.id)&&byId.get(d.id).hash!==d.hash)throw Error('같은 자료 ID의 원본이 서로 달라 병합을 중단했습니다.');
    map.set(d.id,byHash.get(d.hash)?.id||d.id);
  }
  const qmap=new Map(incoming.questions.map(q=>[q.id,map.get(q.doc)+'#'+q.number]));
  const priorTrash=new Set((existing.removedMistakes||[]).flatMap(b=>b.events.map(attemptKey)));
  const priorActive=new Set(existing.events.map(attemptKey));
  function add(target,values){const ids=new Set(target.map(a=>a.id));for(const item of values)if(!ids.has(item.id)){ids.add(item.id);target.push(item)}}
  function mapEvent(e){return {...e,q:qmap.get(e.q)||e.q}}
  add(existing.documents,incoming.documents.filter(d=>!byHash.has(d.hash)).map(d=>({...d,answerId:map.get(d.answerId)||d.answerId,
    ...(Array.isArray(d.answerIds)?{answerIds:d.answerIds.map(id=>map.get(id)||id)}:{}),
    ...(Array.isArray(d.solutionIds)?{solutionIds:d.solutionIds.map(id=>map.get(id)||id)}:{})})));
  const sessions=new Map(existing.sessions.map(a=>[a.id,a.doc]));
  for(const a of incoming.sessions)if(sessions.has(a.id)&&sessions.get(a.id)!==map.get(a.doc))throw Error('풀이 회차 ID가 충돌해 병합을 중단했습니다.');
  add(existing.sessions,incoming.sessions.map(a=>({...a,doc:map.get(a.doc)})));
  add(existing.questions,incoming.questions.map(q=>({...q,id:qmap.get(q.id),doc:map.get(q.doc),...(q.solution?{solution:{...q.solution,doc:map.get(q.solution.doc)||q.solution.doc}}:{})})));
  add(existing.books,incoming.books);
  add(existing.reviews,incoming.reviews.map(r=>({...r,q:qmap.get(r.q)})));
  add(existing.events,incoming.events.map(mapEvent).filter(e=>!priorTrash.has(attemptKey(e))));
  const batches=existing.removedMistakes??=[],known=new Set(batches.flatMap(b=>b.events.map(attemptKey)));
  for(const b of incoming.removedMistakes||[]){
    const events=b.events.map(mapEvent).filter(e=>!known.has(attemptKey(e))&&!priorActive.has(attemptKey(e)));
    if(events.length){events.forEach(e=>known.add(attemptKey(e)));const same=batches.find(x=>x.id===b.id);if(same)same.events.push(...events);else batches.push({...b,events})}
  }
  existing.examTypes=[...new Set([...existing.examTypes,...incoming.examTypes])];
  existing.inventoryMarks={...incoming.inventoryMarks,...existing.inventoryMarks};
  const purged=(incoming.purgedAttempts||[]).map(raw=>{try{const [id,q,instance]=JSON.parse(raw);return JSON.stringify([id,qmap.get(q)||q,instance])}catch{return raw}});
  return validate(reconcilePurged(existing,purged));
}
const stage='restore:blob:';
export async function cleanRestoreStage(){
  await transaction(['meta','files'],'readwrite',({meta,files},read)=>read(meta.get(activeJobKey),job=>{
    if(job)return;
    const range=IDBKeyRange.bound(stage,stage+'\uffff');
    read(meta.getAllKeys(range),keys=>{if(!keys.length)return;read(meta.get('archive'),s=>{
      const used=new Set((s?.documents||[]).map(d=>d.hash));
      for(const key of keys){const hash=key.slice(stage.length);if(!used.has(hash))files.delete(hash);meta.delete(key)}
    })});
  }));
}
const activeJobKey='bulk:active';
export async function restore(file,{merge=false}={}){
  return exclusive(async()=>{
    if(await get('meta',activeJobKey))throw Error('자료 가져오기 화면에서 현재 작업을 마친 후 백업을 복원하세요.');
    await cleanRestoreStage();
    const members=await openZip(file),map=new Map(members.map(e=>[e.path,e]));
    if(map.size!==members.length)throw Error('중복된 백업 경로가 있습니다.');
    const read=async key=>{if(!map.has(key))throw Error('전체 백업 파일이 아닙니다. PDF 묶음은 자료 가져오기에서 선택하세요.');return map.get(key).blob('application/octet-stream')};
    const manifest=JSON.parse(await (await read('manifest.json')).text()),meta=await read('archive.json');
    if(manifest.format!=='yu-study'||manifest.version!==1||await hash(meta)!==manifest.metadataHash)throw Error('백업 형식 또는 체크섬 오류');
    const incoming=validate(JSON.parse(await meta.text())),keys=[...new Set(incoming.documents.map(d=>d.hash))],expected=new Set(manifest.files);
    if(!Array.isArray(manifest.files)||expected.size!==keys.length||manifest.files.length!==keys.length||keys.some(k=>!expected.has(k)))throw Error('파일 목록 불일치');
    if(!confirm('PDF '+incoming.documents.length+'건과 오답 이력 '+incoming.events.length+'건을 '+(merge?'기존 자료에 병합할까요? 같은 문항의 기존 메모와 테마를 유지합니다.':'복원하여 현재 자료를 교체할까요? 현재 자료를 유지하려면 취소하고 ‘백업 병합’을 선택하세요.')))return false;
    const before=JSON.stringify(await state());
    try{
      for(const k of keys){
        const blob=await read('files/'+k),bytes=await blob.arrayBuffer();
        if(await digestBytes(bytes)!==k)throw Error('손상된 PDF');
        await transaction(['files','meta'],'readwrite',({files,meta},read)=>read(files.getKey(k),exists=>{
          if(!exists){files.add(new Blob([bytes],{type:'application/pdf'}),k);meta.put(true,stage+k)}
        }));
      }
      await transaction(['meta','files'],'readwrite',({meta,files},read)=>read(meta.get('archive'),raw=>{
        const current=raw||initial();
        if(JSON.stringify(current)!==before)throw Error('복원 중 다른 창에서 자료가 바뀌었습니다. 다시 시도해 주세요.');
        const next=merge?mergeRecords(current,incoming):reconcilePurged(incoming,current.purgedAttempts);
        if(!merge){
          const keep=new Set(keys);meta.delete('library:recent');for(const d of current.documents)meta.delete('reader:'+d.id);
          for(const d of current.documents){if(!keep.has(d.hash))files.delete(d.hash);if(d.externalRegions)meta.delete(externalKey(d))}
        }
        for(const k of keys)meta.delete(stage+k);
        meta.put(next,'archive');
      }));
      return true;
    }finally{await cleanRestoreStage()}
  });
}
