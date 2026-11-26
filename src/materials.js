import {subjects} from './model.js';

export const kinds=['문제지','정답지','해설지'];
export const mixedType='문제·해설 혼합';
export const lawFlags=['법령 개정 검토 필요','판례 변경 검토 필요','과거 정답 확인 필요','검토 완료'];
export const storedType=kind=>kind==='문제지'?'기출문제지':kind;
export function materialKind(doc){
  if(!doc.type||['기출문제지','문제지','모의고사'].includes(doc.type))return '문제지';
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
function comparable(p,c){
  return grade(p)===grade(c)&&dimensions.every(k=>norm(p[k])===norm(c[k]))&&
    (!count(p)||!count(c)||count(p)===count(c));
}
function acceptsForm(p,c,kind){
  const forms=[c.form,...(Array.isArray(c.forms)?c.forms:[])].map(norm).filter(Boolean);
  return p.form?forms.includes(norm(p.form)):kind==='해설지'&&!forms.length;
}
function append(map,key,value){const items=map.get(key);if(items)items.push(value);else map.set(key,[value])}
const displayOrder=(a,b)=>priority(b)-priority(a)||String(a.title||'').localeCompare(b.title||'','ko')||String(a.id).localeCompare(b.id);
const paperKey=d=>JSON.stringify([base(d),d.subject,grade(d),...dimensions.map(k=>norm(d[k])),norm(d.form)]);
export function materialIndex(documents){
  const byId=new Map(),attachments=new Map(),papers=new Map(),groups=new Map(),parents=new Map();
  const active=documents.filter(d=>!d.deleted);
  for(const d of active){
    byId.set(d.id,d);const kind=materialKind(d);
    if(kind==='문제지')append(papers,paperKey(d),d);
    else if(kind==='정답지'||kind==='해설지')append(attachments,base(d),d);
  }
  for(const p of active){
    if(materialKind(p)!=='문제지')continue;
    const group={paper:p,answers:[],solutions:[],review:false,candidates:[]};groups.set(p.id,group);
    const pool=attachments.get(base(p))||[],peerPapers=papers.get(paperKey(p));
    for(const [kind,field,choice] of [['정답지','answers','answerIds'],['해설지','solutions','solutionIds']]){
      const manual=p[choice]??(kind==='정답지'&&p.answerId?[p.answerId]:undefined);
      if(Array.isArray(manual)){
        group[field]=[...new Set(manual)].map(id=>byId.get(id)).filter(d=>d&&materialKind(d)===kind);
        if(group[field].length!==manual.length)group.review=true;
      }else if(p.autoLink!==false&&p.year&&p.exam&&subjects.includes(p.subject)){
        const similar=pool.filter(d=>materialKind(d)===kind&&d.autoLink!==false&&coversSubject(d,p.subject));
        const exact=similar.filter(d=>!p.reviewReasons?.length&&!d.reviewReasons?.length&&comparable(p,d)&&acceptsForm(p,d,kind)&&
          !peerPapers.some(peer=>peer.id!==p.id&&(!count(peer)||!count(d)||count(peer)===count(d))));
        exact.sort(displayOrder);
        if(kind==='해설지'||exact.length===1||exact.length>1&&priority(exact[0])>priority(exact[1]))group[field]=exact;
        if(!group[field].length&&similar.length){group.review=true;group.candidates.push(...similar)}
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
