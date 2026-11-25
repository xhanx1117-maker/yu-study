import {regionVersion} from './exam-regions.js';

// Prior archives sometimes store a confirmed crop only on the question.
export function regionRecord(doc,question){
  const detected=doc.detected?.[question.number];
  if(question.regions?.length && question.reviewed!==false)return question;
  if(detected && (detected.reviewed===true || detected.regions?.length && detected.reviewed!==false))return detected;
  if(question.regions?.length || question.reviewed===true)return question;
  return detected || question;
}
export const protectedRegion=row=>row?.reviewed===true || Boolean(row?.regions?.length && row.reviewed!==false);
export const needsRepair=row=>!protectedRegion(row) && row?.regionVersion!==regionVersion;
export const regionStamp=row=>JSON.stringify([row?.reviewed??null,row?.regionVersion??null,row?.regions||[]]);

export function applyRegionChanges(archive,proposals){
  const docs=new Map(archive.documents.map(d=>[d.id,d])),questions=new Map(archive.questions.map(q=>[q.id,q]));
  for(const change of proposals){
    const doc=docs.get(change.docId),q=questions.get(change.id);
    if(!doc || !q || q.doc!==doc.id || doc.hash!==change.hash)throw Error('원본 시험지가 변경되었습니다. 다시 분석하세요.');
    const previous=regionRecord(doc,q);
    if(regionStamp(previous)!==change.stamp || protectedRegion(previous))throw Error('검수된 영역 또는 다른 창의 변경 사항이 있습니다. 다시 확인하세요.');
    if(!change.next?.regions?.length)throw Error('새 영역을 확인하세요.');
    const data={regions:change.next.regions,text:change.next.text||'',reviewed:false,regionVersion};
    (doc.detected??={})[q.number]={...doc.detected[q.number],...data};Object.assign(q,data);
  }
}
