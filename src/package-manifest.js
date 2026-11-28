import {safePath} from './archive-zip.js';
import {materialKind,mixedType} from './materials.js';
import {manifestEvidence,roleKind} from './link-evidence.js';
import {family,gradeOf,subjectName,booklet} from './exam-identity.js';
import {subjects} from './model.js';

const types=new Map(Object.entries({paper:'기출문제지',question:'기출문제지',문제지:'기출문제지',기출문제지:'기출문제지',
  answer:'정답지',answer_key:'정답지',정답지:'정답지',solution:'해설지',explanation:'해설지',해설지:'해설지',mixed:mixedType,[mixedType]:mixedType}));
export async function packageManifest(entries){
  const found=entries.filter(e=>e.path==='manifest.json'),byPath=new Map(),warnings=[];
  const counts=new Map();for(const e of entries)counts.set(e.path,(counts.get(e.path)||0)+1);
  if(!found.length)return {byPath,warnings};
  try{
    if(found.length!==1||found[0].size>4*1024*1024)throw Error('manifest 개수 또는 크기 오류');
    const data=JSON.parse(await (await found[0].blob('application/json')).text());
    const rows=Array.isArray(data)?data:data.files||data.documents;
    if(!Array.isArray(rows)||rows.length>25000)throw Error('manifest 파일 목록 오류');
    for(const row of rows){
      const path=typeof row?.path==='string'?safePath(row.path):'';
      if(!path||!counts.has(path)||!/\.pdf$/i.test(path)){warnings.push('manifest 경로 불일치');continue}
      if(counts.get(path)!==1||byPath.has(path)){byPath.set(path,{issue:'manifest 경로 중복'});continue}
      byPath.set(path,row);
    }
  }catch(e){warnings.push('manifest 검토 · '+e.message)}
  return {byPath,warnings:[...new Set(warnings)]};
}
export function applyEntry(info,row,hash){
  if(!row)return info;
  const warn=reason=>{if(!info.reviewReasons.includes(reason))info.reviewReasons.push(reason);return info};
  if(row.issue)return warn(row.issue);
  const checksum=row.sha256??row.hash;
  if(checksum!=null&&(typeof checksum!=='string'||checksum.toLowerCase()!==hash))return warn('manifest 해시 불일치');
  const evidence=manifestEvidence(row,hash);
  if(evidence.length)info.linkEvidence=evidence;
  const hashBound=/^[a-f0-9]{64}$/.test(hash)&&typeof checksum==='string'&&checksum.toLowerCase()===hash;
  if(hashBound&&(!evidence.length&&Array.isArray(row.linked_targets)||row.auto_link_allowed===false))info.manifestHeld=true;
  const type=types.get(row.type??row.materialType)||(hashBound?roleKind(String(row.role||'')):'');
  if((row.type||row.materialType)&&!type)return warn('manifest 자료 유형 미확인');
  if(type){
    if(info.typeEvidence&&materialKind(info)!==materialKind({type})&&!evidence.length)return warn('manifest 자료 유형 불일치');
    if(!info.typeEvidence&&!checksum)return warn('manifest 자료 유형 확인 필요');
    if(info.type!==mixedType||type==='정답지')info.type=type;
  }
  if(evidence.length)row={...row,subject:subjectName(row.subject),form:booklet(row.booklet)||row.form,date:row.exam_date||row.date};
  for(const key of ['subject','year','exam','form','grade','rank','round','date','agency','recruitmentYear']){
    if(row[key]==null)continue;
    const value=String(row[key]).trim().normalize('NFC');
    if(!value||value.length>100||key==='subject'&&![...subjects,'통합'].includes(value)||
      ['year','recruitmentYear'].includes(key)&&!/^(19|20)\d\d$/.test(value)){warn('manifest '+key+' 검토');continue}
    if(key==='subject'&&info.combined&&type==='정답지')continue;
    if(key==='exam'&&info.exam&&family(info.exam)===family(value)&&(!gradeOf(info.exam)||!gradeOf(value)||gradeOf(info.exam)===gradeOf(value)))continue;
    if(info[key]&&info[key]!=='미분류'&&String(info[key])!==value){warn('manifest '+key+' 불일치');continue}
    info[key]=value;
  }
  if(evidence.length){
    if(row.session)info.sitting=String(row.session).slice(0,100);
    if(/비공식/.test(row.role))info.authority='비공식';
    if(/최종/.test(row.role))info.answerEdition='최종';
    else if(/가답안/.test(row.role))info.answerEdition='잠정';
    else if(/미상|미확정/.test(row.role))info.answerEdition='';
  }
  if(info.type==='정답지'&&checksum){
    if(Array.isArray(row.forms)&&row.forms.every(v=>typeof v==='string'&&/^[가-힣A-Za-z0-9]{1,4}$/.test(v)))info.forms=[...new Set(row.forms)];
    if(info.subject==='통합'&&Array.isArray(row.answerSubjects)&&row.answerSubjects.every(x=>subjects.includes(x))){
      info.combined=true;info.answerSubjects=[...new Set(row.answerSubjects)];
    }
  }
  if(info.year&&info.exam&&info.subject!=='미분류')info.reviewReasons=info.reviewReasons.filter(r=>r!=='분류 정보 부족');
  return info;
}
