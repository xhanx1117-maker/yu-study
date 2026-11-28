import {state,get,transaction} from './db.js';
import {classifyExam} from './exam-catalog.js';
import {materialKind,setMaterialType} from './materials.js';
import {identity,subjectName} from './exam-identity.js';
import {protectedPapers,questionSketch,readRepair} from './audit-model.js';
import {openZip} from './archive-zip.js';
import {initial} from './model.js';

const jobKey='link-audit:active',lastKey='link-audit:last',version=1;
export const auditJob=()=>get('meta',jobKey);
export const lastAudit=()=>get('meta',lastKey);
const fields=['subject','exam','year','grade','form','round','date','agency','recruitmentYear','rank','cohort','schedule'];
const stamp=d=>JSON.stringify([version,d.hash,d.title,d.filename,d.type,...fields.map(k=>d[k]),!!d.classificationLocked,d.linkEvidence?.length||0,!!(d.externalRegions||d.detected),d.reviewReasons]);
export async function repairInput(file){
  let src=file;
  if(/\.zip$/i.test(file.name)){
    const list=await openZip(file),m=list.filter(e=>e.path==='manifest.json');
    if(m.length!==1||m[0].size>8*1024*1024)throw Error('ZIP에 유효한 수집 manifest.json이 없습니다.');
    src=await m[0].blob();
  }
  if(src.size>8*1024*1024)throw Error('연결 정보 파일은 8 MB까지 읽을 수 있습니다.');
  return readRepair(JSON.parse(await src.text()));
}
function twinScopes(d){
  const i=identity(d),prefix=[i.subject,i.exam,i.grade,i.round,i.schedule].join('|');
  return [i.year&&'y'+i.year,i.cohort&&'c'+i.cohort].filter(Boolean).map(k=>prefix+'|'+k);
}
export async function runAudit(control,report=()=>{}){
  let job=await auditJob();
  const archive=await state(),docs=new Map(archive.documents.filter(d=>!d.deleted).map(d=>[d.id,d]));
  const scopeCounts=new Map(),paperScopes=new Map();
  for(const d of docs.values())if(materialKind(d)==='문제지'){
    const scopes=twinScopes(d);paperScopes.set(d.id,scopes);
    for(const k of scopes)scopeCounts.set(k,(scopeCounts.get(k)||0)+1);
  }
  const needsSketch=id=>paperScopes.has(id)&&(/통합|발췌|변환/.test(docs.get(id)?.title||'')||(paperScopes.get(id)||[]).some(k=>scopeCounts.get(k)>1));
  if(!job){
    job={id:crypto.randomUUID(),cursor:0,read:0,reused:0,issues:0,updated:0,items:[...docs.values()].filter(d=>
      d.auditStamp!==stamp(d)||d.auditError||needsSketch(d.id)&&!d.sketchChecked).map(d=>[d.id,d.hash])};
    await transaction(['meta'],'readwrite',({meta},read)=>read(meta.get(jobKey),old=>{if(old)throw Error('다른 창에서 점검을 시작했습니다.');meta.put(job,jobKey)}));
  }
  let worker,pending=[],presence=new Map();
  async function fileKeys(start){
    const keys=new Map();
    await transaction(['files'],'readonly',({files},read)=>{
      for(const [,hash] of job.items.slice(start,start+12))read(files.getKey(hash),value=>keys.set(hash,value!==undefined));
    });
    return keys;
  }
  async function flush(){
    const batch=pending;pending=[];
    await transaction(['meta'],'readwrite',({meta},read)=>read(meta.get(jobKey),live=>{
      if(live?.id!==job.id||live.cursor!==job.cursor)throw Error('다른 창에서 점검이 변경되었습니다.');
      read(meta.get('archive'),stored=>{
        const s=stored||initial(),byId=new Map(s.documents.map(d=>[d.id,d]));let dirty=false;
        const protectedIds=protectedPapers(s);
        for(const row of batch){
          const d=byId.get(row.id);job.cursor++;
          if(!d||d.deleted||stamp(d)!==row.stamp)continue;
          if(row.read)job.read++;else job.reused++;
          if(row.missing)d.fileMissing=true;else delete d.fileMissing;
          if(row.error){job.issues++;d.auditError=row.error}
          else{
            delete d.auditError;
            const old=JSON.stringify([d.type,...fields.map(k=>d[k])]);
            const info=row.info;
            if(info&&!d.classificationLocked){
              for(const key of fields){
                const v=info[key];
                if(!v||v==='미분류'||key==='subject'&&protectedIds.has(d.id))continue;
                if(!d[key]||d[key]==='미분류'||key==='exam'&&identity(d).exam===identity(info).exam||key==='subject'&&d[key]!==v&&subjectName(d[key])===v)d[key]=v;
              }
              if(!d.linkEvidence?.length&&info.typeEvidence&&materialKind(info)!==materialKind(d)){
                if(!protectedIds.has(d.id)&&d.importId&&!info.reviewReasons.some(r=>/유형 불일치|문제지·정답지/.test(r)))setMaterialType(d,materialKind(info));
                else d.auditIssue='자료 유형 후보 '+info.type+' · 자료 관리에서 확인하세요.';
              }
              if(d.year&&d.exam&&d.subject&&d.subject!=='미분류'&&d.reviewReasons?.includes('분류 정보 부족'))d.reviewReasons=d.reviewReasons.filter(r=>r!=='분류 정보 부족');
              if(!d.signature?.length&&info.signature?.length)d.signature=info.signature;
              if(d.exam&&!s.examTypes.includes(d.exam))s.examTypes.push(d.exam);
            }
            if(row.sketch?.length)d.questionSketch=row.sketch;
            if(row.checked)d.sketchChecked=true;
            if(old!==JSON.stringify([d.type,...fields.map(k=>d[k])]))job.updated++;
          }
          d.auditStamp=stamp(d);dirty=true;
        }
        if(dirty)meta.put(s,'archive');
        if(job.cursor>=job.items.length){
          meta.put({date:new Date().toISOString(),total:job.cursor,read:job.read,reused:job.reused,issues:job.issues,updated:job.updated},lastKey);meta.delete(jobKey);
        }else meta.put(job,jobKey);
      });
    }));
  }
  try{
    for(let i=job.cursor;i<job.items.length&&!control.signal.aborted;i++){
      const [id,hash]=job.items[i],d=docs.get(id),row={id,stamp:d&&stamp(d)};report(i,job.items.length,d?.title||'');if(control.signal.aborted)break;
      if(!presence.has(hash))presence=await fileKeys(i);
      if(d&&d.hash===hash)try{
        if(!presence.get(hash)){row.missing=true;throw Error('기기에 원본 PDF가 없습니다.')}
        const name=d.filename||d.title||'',info=classifyExam(name,{},archive.examTypes);
        row.info=info;const variant=needsSketch(id)&&!d.sketchChecked;
        if(variant||!d.questionSketch?.length&&d.detected){
          const map=d.externalRegions?await get('meta','auto-regions:'+id+':'+hash):null;
          row.sketch=questionSketch(Object.values({...map,...d.detected}).map(q=>q.text));row.checked=row.sketch.length>=3;
        }
        const incomplete=!d.classificationLocked&&!d.linkEvidence?.length&&(!d.exam&&!info.exam||!d.year&&!info.year||
          (!d.subject||d.subject==='미분류')&&info.subject==='미분류'||d.reviewReasons?.some(r=>/자료 유형|문제지·정답지/.test(r)));
        if(incomplete||variant&&!row.checked){
          const blob=await get('files',hash);if(!blob)throw Error('기기에 원본 PDF가 없습니다.');
          const pdf=await import('./pdf.js');worker??=await pdf.batchWorker();row.read=true;
          const probe=await pdf.probePdf(blob,worker,name,control.signal,variant&&!row.checked);
          row.info=classifyExam(name,probe,archive.examTypes);
          if(variant&&!row.checked){row.sketch=probe.questionSketch;row.checked=true}
        }
      }catch(e){if(control.signal.aborted)break;row.error=e.message||'원본 확인 실패'}
      pending.push(row);
      if(pending.length>=12)await flush();
      await new Promise(resolve=>setTimeout(resolve,0));
    }
    if(pending.length||!job.items.length)await flush();
    report(job.cursor,job.items.length,'');
    return job.cursor===job.items.length;
  }finally{worker?.destroy()}
}
