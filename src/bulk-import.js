import {get,state,transaction,entries,putMeta,digestBytes} from './db.js';
import {materialKind} from './materials.js';
import {packageManifest,applyEntry} from './package-manifest.js';
import {initial} from './model.js';
import {openZip,safePath,ignoredPath} from './archive-zip.js';
import {classifyExam,possibleDuplicate,identityBucket} from './exam-catalog.js';
import {batchWorker,probePdf,openPdf,detect} from './pdf.js';
import {importError} from './import-pdf.js';
import {protectedRegion} from './region-records.js';

const activeKey='bulk:active',prefix=id=>'bulk:'+id+':',rowKey=(id,i)=>prefix(id)+String(i).padStart(6,'0');
const MiB=1048576, defaults={skip:true,classify:true,link:true,analyse:true};
export const currentJob=()=>get('meta',activeKey);
export const jobRows=job=>entries(prefix(job.id));
export const yieldUI=()=>new Promise(resolve=>setTimeout(resolve,0));
const paused=control=>control.pause||document.hidden;
export async function discover(files){
  const sources=new Map(),problems=[],repeated=new Map(),occurrences=new Map();let total=0;
  for(const file of files){const key=JSON.stringify([safePath(file.webkitRelativePath||file.name),file.size]);repeated.set(key,(repeated.get(key)||0)+1)}
  for(const file of files){
    const source=safePath(file.webkitRelativePath||file.name);
    if(!source||ignoredPath(source))continue;
    // File providers can change lastModified when the same archive is picked again.
    // Each ZIP member also carries its ordinal, CRC and path. Raw PDFs are hashed at preview.
    const key=[source,file.size].join('\n');
    function add(path,size,read,extra='',error='',digest='',manifest){
      const base=JSON.stringify([key,path,extra]),ordinal=occurrences.get(base)||0;
      occurrences.set(base,ordinal+1);
      // Keep the original id for the first occurrence, including jobs from earlier builds.
      const id=ordinal?base+'/'+ordinal:base;
      sources.set(id,{id,path,size,read,error,digest,manifest});if(!error)total+=size;
    }
    if(/\.zip$/i.test(source)){
      try{
        const list=await openZip(file);
        if(list.some(e=>e.path==='archive.json')&&list.some(e=>e.path==='manifest.json')){
          problems.push(source+' · 전체 앱 백업입니다. ‘전체 백업 복원’에서 선택하세요.');continue;
        }
        const manifest=await packageManifest(list);
        problems.push(...manifest.warnings.map(w=>source+' · '+w));
        for(const [i,e] of list.entries())if(/\.pdf$/i.test(e.path))add(source.replace(/\.zip$/i,'')+'/'+e.path,e.size,e.blob,i+':'+e.crc,e.error,'',manifest.byPath.get(e.path));
        if(!list.some(e=>/\.pdf$/i.test(e.path)))problems.push(source+' · PDF가 없습니다.');
      }catch(e){problems.push(source+' · '+e.message)}
    }else if(/\.pdf$/i.test(source)||file.type==='application/pdf'){
      const sameName=repeated.get(JSON.stringify([source,file.size]))>1;
      const digest=sameName&&file.size<=512*MiB?await digestBytes(await file.arrayBuffer()):'';
      add(source,file.size,()=>file,digest,'',digest);
    }
    if(sources.size>25000||total>16*1024*MiB)throw Error('한 작업의 한도는 PDF 25,000개 또는 16 GB입니다. 묶음을 나누어 주세요.');
  }
  return {sources,problems,total};
}
export async function startJob(input){
  const job={id:crypto.randomUUID(),phase:'preview',options:{...defaults},problems:input.problems,created:new Date().toISOString()};
  await transaction(['meta'],'readwrite',({meta},read)=>read(meta.get(activeKey),existing=>{
    if(existing)throw Error('기존 가져오기를 마치거나 정리해 주세요.');
    meta.put(job,activeKey);let i=0;
    for(const item of input.sources.values()){const row={i,id:item.id,path:item.path,size:item.size,status:item.error?'failed':'pending',error:item.error};meta.put(row,rowKey(job.id,i++))}
  }));
  return job;
}
export async function saveJob(job){
  return transaction(['meta'],'readwrite',({meta},read)=>read(meta.get(activeKey),live=>{
    if(!live||live.id!==job.id)throw Error('이 가져오기 작업은 이미 종료되었습니다.');
    meta.put(job,activeKey);
  }));
}
function storePreview(job,row,blob){
  return transaction(['meta','files'],'readwrite',({meta,files},read)=>read(meta.get(activeKey),live=>{
    if(live?.id!==job.id)throw Error('가져오기 작업이 바뀌었습니다.');
    if(blob)read(files.getKey(row.hash),present=>{if(!present)files.add(blob,row.hash)});
    meta.put(row,rowKey(job.id,row.i));
  }));
}
export async function preview(job,rows,sources,control,report,failedOnly=false){
  const archive=await state(),known=new Set(archive.documents.map(d=>d.hash)),buckets=new Map();
  function index(d){const key=identityBucket(d);if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(d)}
  archive.documents.forEach(index);
  for(const row of rows)if(row.hash&&['ready','registered'].includes(row.status)){known.add(row.hash);index({...row.info,hash:row.hash})}
  const worker=await batchWorker();let budget=Infinity,processed=0;
  try{
    for(const row of rows){
      if(paused(control))break;
      if(row.status!==(failedOnly?'failed':'pending'))continue;
      const source=sources.get(row.id);if(!source)continue;
      try{
        if(source.error)throw Error(source.error);
        if(!row.size||row.size>512*MiB)throw Error('빈 PDF 또는 개별 파일 512 MB 한도 초과');
        const file=await source.read(),buffer=await file.arrayBuffer(),bytes=new Uint8Array(buffer);
        if(!new TextDecoder().decode(bytes.subarray(0,1024)).includes('%PDF-'))throw Error('PDF 형식을 확인할 수 없습니다.');
        const hash=source.digest||await digestBytes(bytes);row.hash=hash;
        if(known.has(hash)){Object.assign(row,{status:'duplicate',error:''});await storePreview(job,row)}
        else{
          if(processed++%24===0){const estimate=await navigator.storage?.estimate?.().catch(()=>null);budget=estimate?.quota?estimate.quota-estimate.usage:Infinity}
          if(row.size>budget)throw new DOMException('예상 저장 공간 부족','QuotaExceededError');
          // Blob construction snapshots provider bytes before PDF.js transfers the buffer to its worker.
          const durable=new Blob([bytes],{type:'application/pdf'}),probe=await probePdf(bytes,worker);
          const info=applyEntry(classifyExam(row.path,probe,archive.examTypes),source.manifest,hash),near=possibleDuplicate({...info,hash},buckets.get(identityBucket(info)));
          if(near)info.reviewReasons.push('중복 후보 · '+near.title);
          Object.assign(row,{info,status:'ready',error:''});await storePreview(job,row,durable);
          known.add(hash);index({...info,hash});budget-=row.size;
        }
      }catch(e){
        row.status='failed';row.error=e.name==='PasswordException'?'암호가 설정된 PDF입니다. 암호 해제 후 다시 선택하세요.':importError(e);
        await storePreview(job,row);
      }
      report(row);await yieldUI();
    }
  }finally{worker.destroy()}
}
export function summary(rows){
  const sums={pending:0,ready:0,duplicate:0,failed:0,registered:0,papers:0,keys:0,solutions:0,review:0,bytes:0,subjects:new Map(),years:new Map()};
  for(const r of rows){sums[r.status]++;if(r.status==='ready')sums.bytes+=r.size;
    const d=r.info;if(!d||!['ready','registered'].includes(r.status))continue;
    sums[materialKind(d)==='해설지'?'solutions':d.type==='정답지'?'keys':'papers']++;if(d.reviewReasons?.length)sums.review++;
    for(const [m,k] of [[sums.subjects,d.subject],[sums.years,d.year||'연도 미상']])m.set(k,(m.get(k)||0)+1);
  }return sums;
}
export async function register(job,rows,control,report){
  job.phase='register';await saveJob(job);
  const pending=rows.filter(row=>row.status==='ready');
  for(let i=0;i<pending.length&&!paused(control);i+=24){
    const batch=pending.slice(i,i+24),updates=[];
    await transaction(['meta','files'],'readwrite',({meta,files},read)=>read(meta.get(activeKey),live=>{
      if(live?.id!==job.id)throw Error('가져오기 작업이 바뀌었습니다.');
      read(meta.get('archive'),value=>{
        const s=value||initial(),known=new Set(s.documents.map(d=>d.hash)),date=new Date().toISOString();
        let changed=false;
        for(const row of batch)read(files.getKey(row.hash),exists=>{
          const result={...row};
          if(!exists){result.status='failed';result.error='보관한 파일을 다시 선택해 주세요.'}
          else if(known.has(row.hash))result.status='duplicate';
          else{
            const id=crypto.randomUUID(),session=crypto.randomUUID(),info={...row.info};
            if(!job.options.classify)Object.assign(info,{subject:'미분류',year:'',exam:'',reviewReasons:['수동 분류']});
            const analyze=job.options.analyse&&materialKind(info)==='문제지'&&!info.reviewReasons.some(r=>/자료 유형|문제지·정답지|manifest/.test(r));
            s.documents.push({...info,id,session,hash:row.hash,size:row.size,created:date,favorite:false,autoLink:job.options.link,
              analysisState:analyze?'queued':'off',importId:job.id});
            s.sessions.push({id:session,doc:id,date});if(info.exam&&!s.examTypes.includes(info.exam))s.examTypes.push(info.exam);
            result.status='registered';result.doc=id;known.add(row.hash);changed=true;
          }
          updates.push([row,result]);meta.put(result,rowKey(job.id,row.i));
          if(updates.length===batch.length&&changed)meta.put(s,'archive');
        });
      });
    }));
    for(const [row,result] of updates)Object.assign(row,result);
    report(batch.at(-1));await yieldUI();
  }
  if(!rows.some(r=>r.status==='ready'||r.status==='pending')){job.phase='analysis';await saveJob(job)}
}
export const mapKey=d=>'auto-regions:'+d.id+':'+d.hash;
export const automaticMap=d=>d.externalRegions?get('meta',mapKey(d)):undefined;
export async function analyse(job,control,report,{retry=false}={}){
  const belongs=d=>!d.deleted&&materialKind(d)==='문제지'&&(!job||d.importId===job.id);
  const archive=await state(),queue=archive.documents.filter(d=>belongs(d)&&(d.analysisState==='queued'||retry&&d.analysisState==='error'));
  if(!queue.length)return true;
  const worker=await batchWorker();let batch=[],bytes=0;
  async function flush(){
    if(!batch.length)return;
    await transaction(['meta'],'readwrite',({meta},read)=>read(meta.get('archive'),s=>{
      const docs=new Map(s.documents.map(d=>[d.id,d]));
      for(const {doc,map,error} of batch){
        const current=docs.get(doc.id);
        if(!current||current.deleted||materialKind(current)!=='문제지'||current.hash!==doc.hash||!['queued','error'].includes(current.analysisState))continue;
        if(current.scanned){current.analysisState='done';continue}
        if(error){current.analysisState='error';current.analysisError=error;continue}
        const nums=Object.keys(map).map(Number).sort((a,b)=>a-b);
        if(nums.length){
          meta.put(map,mapKey(current));current.externalRegions=true;current.analysisBytes=new Blob([JSON.stringify(map)]).size;
          for(const q of s.questions)if(q.doc===current.id&&map[q.number]&&!protectedRegion(q)&&!protectedRegion(current.detected?.[q.number]))Object.assign(q,map[q.number]);
          if(!current.countLocked&&nums.every((v,i)=>v===i+1)&&!s.questions.some(q=>q.doc===current.id&&q.number>nums.length)){
            current.count=nums.length;current.countKnown=true;
          }
        }
        current.scanned=true;current.analysisState=nums.length?'done':'manual';delete current.analysisError;
      }
      meta.put(s,'archive');
    }));
    batch=[];bytes=0;
  }
  try{
    for(const [i,doc] of queue.entries()){
      if(paused(control))break;report(doc,i,queue.length);
      let pdf;
      try{
        pdf=await openPdf(await get('files',doc.hash),worker);
        const map=await detect(pdf,300,{signal:control.signal,progress:(label,n,total)=>report(doc,i,queue.length,n,total)});
        batch.push({doc,map});bytes+=JSON.stringify(map).length*2;
      }catch(e){if(control.signal?.aborted)break;batch.push({doc,error:e.message||'문항 분석 실패'})}
      finally{await pdf?.destroy()}
      if(batch.length>=8||bytes>512*1024)await flush();
      await yieldUI();
    }
    await flush();
  }finally{worker.destroy()}
  return !(await state()).documents.some(d=>belongs(d)&&d.analysisState==='queued');
}
export async function finishJob(job){
  const rows=await jobRows(job);
  return transaction(['meta','files'],'readwrite',({meta,files},read)=>read(meta.get(activeKey),live=>{
    if(live?.id!==job.id)return;
    read(meta.get('archive'),s=>{
      const used=new Set((s?.documents||[]).map(d=>d.hash));
      for(const row of rows){
        if(row.hash&&row.status==='ready'&&!used.has(row.hash))files.delete(row.hash);
        meta.delete(rowKey(job.id,row.i));
      }
      meta.delete(activeKey);
    });
  }));
}
