import {initial,validate} from './model.js';
import {upgradeStudy,flushStudy,revisionKey} from './study-store.js';
const opening=new Promise((resolve,reject)=>{
  const r=indexedDB.open('yu-study-archive',2);
  const status=message=>window.dispatchEvent(new CustomEvent('yu-storage-progress',{detail:message}));
  r.onblocked=()=>status('다른 Yu: study 창을 닫으면 학습 기록 업데이트를 계속합니다.');
  r.onupgradeneeded=()=>{
    for(const name of ['meta','files'])if(!r.result.objectStoreNames.contains(name))r.result.createObjectStore(name);
    if(!r.result.objectStoreNames.contains('studyLog'))upgradeStudy(r.result,r.transaction,(n,total)=>status('기존 학습 기록 정리 중 · '+n+' / '+total));
  };
  r.onerror=()=>reject(r.error);
  r.onsuccess=()=>{r.result.onversionchange=()=>r.result.close();resolve(r.result)};
});
export async function get(store,key){const db=await opening;return new Promise((res,rej)=>{const r=db.transaction(store).objectStore(store).get(key);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
export async function state(){return await get('meta','archive')||initial()}
export async function transaction(names,mode,work){
  const db=await opening;
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(names,mode),stores=Object.fromEntries(names.map(n=>[n,tx.objectStore(n)]));
    let error,result;
    const fail=e=>{error=e;tx.abort()};
    tx.oncomplete=()=>resolve(result);tx.onabort=()=>reject(error||tx.error||Error('저장을 완료하지 못했습니다.'));
    const read=(request,fn)=>{request.onsuccess=()=>{try{fn(request.result)}catch(e){fail(e)}}};
    try{work(stores,read,value=>{result=value})}catch(e){fail(e)}
  });
}
export async function entries(prefix){
  return transaction(['meta'],'readonly',({meta},read,done)=>read(meta.getAll(IDBKeyRange.bound(prefix,prefix+'\uffff')),done));
}
export const putMeta=(key,value)=>transaction(['meta'],'readwrite',({meta})=>meta.put(value,key));
export const digestBytes=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
export async function exclusive(work){
  if(!navigator.locks?.request)throw Error('안전한 일괄 작업을 위해 Safari 또는 브라우저를 업데이트해 주세요.');
  return navigator.locks.request('yu-study-bulk', {ifAvailable:true}, lock=>{
    if(!lock)throw Error('다른 창에서 가져오기 또는 복원을 진행 중입니다. 완료 후 다시 시도하세요.');
    return work();
  });
}
export function change(fn,files=[],replace=false){
  return transaction(['meta','files','studyLog'],'readwrite',({meta,files:blobs,studyLog},read)=>{
    read(meta.get('archive'),raw=>{
      const s=raw||initial(),v=fn(s)||s;
      if(replace){validate(v);blobs.clear()}
      for(const [key,file] of files)blobs.put(file,key);
      if(flushStudy(studyLog,s,read))meta.put(crypto.randomUUID(),revisionKey);
      meta.put(v,'archive');
    });
  });
}
export async function hash(data){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',await data.arrayBuffer()))].map(x=>x.toString(16).padStart(2,'0')).join('')}
