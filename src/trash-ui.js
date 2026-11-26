import {transaction,exclusive,get,state} from './db.js';
import {trashPlan,removeSources} from './material-trash.js';
import {modal,notice,guard} from './ui.js';

const journal='library:purge';
const total=(rows,key)=>rows.reduce((n,row)=>n+row[key],0);
export async function purgeDialog(ids,refresh){
  const archive=await state(),previous=await get('meta',journal);
  const plan=trashPlan(archive,ids||previous?.rows.map(x=>x.id)||[]);
  const n=plan.rows.length,events=total(plan.rows,'events')+total(plan.rows,'trash'),qs=total(plan.rows,'questions'),reviews=total(plan.rows,'reviews');
  const protectedText=plan.protectedCount?'다른 자료에서 참조하는 '+plan.protectedCount+'개는 보존합니다.':'';
  const panel=modal('<h2>자료실 원본 영구 삭제</h2><p>자료 '+n+'개 · 원본 약 '+(plan.bytes/1048576).toFixed(1)+' MB · 연결 문항 '+qs+'개 · 오답 이력 '+events+'회 · 복습 '+reviews+'건</p><p>'+protectedText+' 삭제한 원본과 해당 학습 기록은 앱에서 복원할 수 없습니다.</p><div class="row"><button id="stop-purge" autofocus>취소</button><button class="danger" id="purge-files" '+(!n?'disabled':'')+'>원본 영구 삭제</button></div><p role="status"></p>',{critical:true});
  const dialog=document.querySelector('#modal'),status=panel.querySelector('[role=status]');
  panel.querySelector('#stop-purge').onclick=()=>dialog.close();
  panel.querySelector('#purge-files').onclick=guard(async()=>{
    if((qs||events||reviews)&&!confirm('연결 문항 '+qs+'개와 오답 이력 '+events+'회, 복습 '+reviews+'건을 원본과 함께 영구 삭제할까요?'))return;
    panel.setAttribute('aria-busy','true');panel.querySelectorAll('button').forEach(b=>b.disabled=true);
    try{await exclusive(async()=>{
      const old=await get('meta',journal);
      if(old&&ids)throw Error('먼저 중단된 삭제에서 남은 자료를 확인하거나 대기를 해제하세요.');
      if(old&&!ids&&old.id!==previous?.id)throw Error('삭제 작업이 바뀌었습니다. 다시 확인하세요.');
      const job={id:crypto.randomUUID(),rows:plan.rows};
      await transaction(['meta'],'readwrite',({meta})=>meta.put(job,journal));
      let processed=0,removed=0;
      while(processed<n){
        // Originals and the remaining journal advance together or roll back together.
        const batch=await transaction(['meta','files'],'readwrite',({meta,files},read,done)=>read(meta.get(journal),live=>{
          if(live?.id!==job.id)throw Error('삭제 작업이 바뀌었습니다.');
          read(meta.get('archive'),s=>{
            const expected=live.rows.slice(0,32);
            const allowed=new Map(trashPlan(s,live.rows.map(x=>x.id)).rows.map(row=>[row.id,row]));
            const safe=expected.filter(row=>{
              const now=allowed.get(row.id);
              return now&&now.hash===row.hash&&['questions','events','reviews','trash'].every(k=>row[k]===now[k]);
            });
            function apply(staged){
              removeSources(s,safe);
              const keep=new Set([...s.documents.map(d=>d.hash),...staged]);
              for(const row of safe){if(!keep.has(row.hash))files.delete(row.hash);meta.delete('auto-regions:'+row.id+':'+row.hash);meta.delete('reader:'+row.id)}
              if(safe.length){
                const gone=new Set(safe.map(row=>row.id));
                read(meta.get('library:recent'),rows=>{
                  if(rows?.some(r=>gone.has(r.id)||gone.has(r.anchor))){
                    meta.put(rows.filter(r=>!gone.has(r.id)).map(r=>gone.has(r.anchor)?{...r,anchor:r.id}:r),'library:recent');
                  }
                });
              }
              meta.put(s,'archive');live.rows.splice(0,expected.length);
              if(live.rows.length)meta.put(live,journal);else meta.delete(journal);
              done({processed:expected.length,removed:safe.length});
            }
            read(meta.get('bulk:active'),importing=>{
              if(!importing){apply([]);return}
              const prefix='bulk:'+importing.id+':';
              read(meta.getAll(IDBKeyRange.bound(prefix,prefix+'\uffff')),rows=>apply(rows.map(r=>r.hash).filter(Boolean)));
            });
          });
        }));
        processed+=batch.processed;removed+=batch.removed;status.textContent=processed+' / '+n+'개 확인 · '+removed+'개 삭제';
        await new Promise(resolve=>setTimeout(resolve,0));
      }
      dialog.close();await refresh();notice(removed+'개 삭제 · '+(n-removed+plan.protectedCount)+'개 보존');
    })}finally{panel.removeAttribute('aria-busy');panel.querySelectorAll('button').forEach(b=>b.disabled=false)}
  });
}
export async function pendingPurge(){return get('meta',journal)}
export function cancelPending(id){return exclusive(()=>transaction(['meta'],'readwrite',({meta},read)=>read(meta.get(journal),current=>{if(current?.id===id)meta.delete(journal)})))}
