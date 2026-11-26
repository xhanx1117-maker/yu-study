import {subjects} from './model.js';

export const kinds=['문제지','정답지','해설지'];
export const mixedType='문제·해설 혼합';
export const lawFlags=['법령 개정 검토 필요','판례 변경 검토 필요','과거 정답 확인 필요','검토 완료'];
export const storedType=kind=>kind==='문제지'?'기출문제지':kind;
export function materialKind(doc){
  if(!doc.type||['기출문제지','기출문제','시험지','문제지','모의고사'].includes(doc.type))return '문제지';
  if(doc.type==='정답지')return '정답지';
  if(/해설|풀이집/.test(doc.type))return '해설지';
  return '기타 자료';
}
export function coversSubject(d,subject){
  return !subject||d.subject===subject||d.combined&&subjects.includes(subject)&&
    (!d.answerSubjects?.length||d.answerSubjects.includes(subject));
}
export function answerLabel(d){
  if(d.authority==='비공식')return '비공식 정답'+(d.answerEdition?' · '+d.answerEdition:'');
  if(d.answerEdition==='잠정')return '가답안';
  if(d.answerEdition==='최종')return d.authority==='공식'?'공식 최종 정답':'최종 정답 · 출처 미확인';
  return d.authority==='공식'?'공식 정답 · 판본 미확인':'출처·판본 미확인';
}
function priority(d){
  if(d.authority==='공식'&&d.answerEdition==='최종')return 4;
  if(d.authority==='비공식')return 0;
  if(d.answerEdition==='최종')return 3;
  if(d.authority==='공식')return 2;
  return d.answerEdition==='잠정'?1:0;
}
const norm=v=>String(v??'').normalize('NFC').replace(/\s+/g,'').toUpperCase();
const base=d=>JSON.stringify([norm(d.year),norm(d.exam).replace(/[1-9]급/g,'')]);
const grade=d=>norm(d.grade||d.exam?.match(/[1-9]\s*급/)?.[0]);
const dimensions=['round','date','agency','recruitmentYear','rank'];
const count=d=>d.countKnown||d.countLocked?Number(d.count):0;

function possibleCompanion(p,c){
  if(grade(p)&&grade(c)&&grade(p)!==grade(c))return false;
  if(count(p)&&count(c)&&count(p)!==count(c))return false;
  if(dimensions.some(k=>p[k]&&c[k]&&norm(p[k])!==norm(c[k])))return false;
  const forms=[c.form,...(Array.isArray(c.forms)?c.forms:[])].filter(Boolean).map(norm);
  return !p.form||!forms.length||forms.includes(norm(p.form));
}

function append(map,key,value){const items=map.get(key);if(items)items.push(value);else map.set(key,[value])}
const displayOrder=(a,b)=>priority(b)-priority(a)||String(a.title||'').localeCompare(b.title||'','ko')||String(a.id).localeCompare(b.id);
const formsOf=d=>[...new Set([d.form,...(Array.isArray(d.forms)?d.forms:[])].filter(Boolean).map(norm))];
const dimensionsOf=d=>[grade(d),...dimensions.map(k=>norm(d[k]))];
export function materialIndex(documents){
  const byId=new Map(),broad=new Map(),exactGroups=new Map(),papersByForm=new Map(),groups=new Map(),parents=new Map();
  const qualified=new Map(),paperScopes=new Map();
  function scopeOf(d,sub,kind){return JSON.stringify([base(d),sub,kind])}
  function identity(d){let key=qualified.get(d);if(!key){key=dimensionsOf(d);qualified.set(d,key)}return key}
  function formGroup(d){return JSON.stringify([base(d),d.subject,norm(d.form)])}
  for(const d of documents){
    if(d.deleted)continue;
    byId.set(d.id,d);const kind=materialKind(d);
    if(kind==='문제지'){append(papersByForm,formGroup(d),d);continue}
    if(!['정답지','해설지'].includes(kind)||d.autoLink===false)continue;
    for(const subject of subjects.filter(sub=>coversSubject(d,sub))){
      const scope=scopeOf(d,subject,kind);append(broad,scope,d);
      if(d.reviewReasons?.length)continue;
      const forms=formsOf(d);if(kind==='해설지'&&!forms.length)forms.push('');
      for(const form of forms)append(exactGroups,JSON.stringify([scope,identity(d),form]),d);
    }
  }
  // A paper lacking (for example) a round must not claim a key that could
  // also belong to a dated variant. Reuse a projection per missing-field mask.
  function plausiblePeers(p){
    const form=formGroup(p),fields=identity(p),mask=fields.map(Boolean),scope=JSON.stringify([form,mask]);
    if(!paperScopes.has(scope)){
      const matches=new Map();for(const peer of papersByForm.get(form)||[])append(matches,JSON.stringify(identity(peer).filter((_,i)=>mask[i])),peer);
      paperScopes.set(scope,matches);
    }
    return paperScopes.get(scope).get(JSON.stringify(fields.filter(Boolean)))||[];
  }
  for(const p of byId.values()){
    if(materialKind(p)!=='문제지')continue;
    const group={paper:p,answers:[],solutions:[],review:false,candidates:[]};groups.set(p.id,group);
    for(const [kind,field,choice] of [['정답지','answers','answerIds'],['해설지','solutions','solutionIds']]){
      const manual=p[choice]??(kind==='정답지'&&p.answerId?[p.answerId]:undefined);
      if(Array.isArray(manual)){
        group[field]=[...new Set(manual)].map(id=>byId.get(id)).filter(d=>d&&materialKind(d)===kind);
        if(group[field].length!==manual.length)group.review=true;
      }else if(p.autoLink!==false&&p.year&&p.exam&&subjects.includes(p.subject)){
        const scope=scopeOf(p,p.subject,kind),matches=exactGroups.get(JSON.stringify([scope,identity(p),norm(p.form)]))||[];
        const peers=matches.length?plausiblePeers(p):[];
        const exact=p.reviewReasons?.length?[]:matches.filter(d=>(!count(p)||!count(d)||count(p)===count(d))&&
          !peers.some(peer=>peer.id!==p.id&&(!count(peer)||!count(d)||count(peer)===count(d))));
        exact.sort(displayOrder);
        if(kind==='해설지'||exact.length===1||exact.length>1&&priority(exact[0])>priority(exact[1]))group[field]=exact;
        if(!group[field].length){
          const similar=(broad.get(scope)||[]).filter(d=>possibleCompanion(p,d));
          if(similar.length){group.review=true;group.candidates.push(...similar)}
        }
      }
      for(const d of group[field])append(parents,d.id,p);
    }
  }
  function groupFor(id,anchor){
    const d=byId.get(id);if(!d)return;
    if(groups.has(id))return groups.get(id);
    const list=parents.get(id)||[],paper=list.find(p=>p.id===anchor)||(list.length===1?list[0]:null);
    return paper?groups.get(paper.id):{paper:null,answers:materialKind(d)==='정답지'?[d]:[],solutions:materialKind(d)==='해설지'?[d]:[],review:list.length>1};
  }
  return {byId,groups,parents,groupFor};
}
export function missingMaterials(index,subject=''){
  const rows=[];
  for(const g of index.groups.values()){
    const p=g.paper;if(subject&&p.subject!==subject)continue;
    const missing=[];if(!g.answers.length)missing.push('정답지');if(!g.solutions.length)missing.push('해설지');
    rows.push({과목:p.subject,연도:p.year||'',시험:p.exam||'',회차:p.round||'',책형:p.form||'',제목:p.title,필요자료:missing.join(' · '),연결검토:g.review});
  }
  return rows;
}
export function setMaterialType(d,kind){
  if(!kinds.includes(kind))throw Error('자료 유형을 확인하세요.');
  if(materialKind(d)===kind)return;
  d.type=storedType(kind);
  if(kind!=='문제지'&&['queued','error'].includes(d.analysisState))d.analysisState='off';
}
