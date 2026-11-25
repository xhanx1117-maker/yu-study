export const subjects=['국어','영어','행정법','행정학'];
export function initial(){return {version:1,documents:[],questions:[],events:[],reviews:[],sessions:[],books:[],examTypes:['국가직 9급','지방직 9급','국가직 7급','지방직 7급','서울시','기타'],lastBackup:null}}
export function themes(seed){
 if(seed.schemaVersion!==1||!Array.isArray(seed.books))throw Error('목차 형식을 확인하세요.');
 const seen=new Set(),rows=[];
 function id(node){if(!node||typeof node.id!=='string'||!node.id||seen.has(node.id)||typeof node.title!=='string')throw Error('목차 ID 또는 이름이 잘못되었습니다.');seen.add(node.id)}
 for(const book of seed.books){id(book);if(!subjects.includes(book.subject))throw Error('과목을 확인하세요.');
 function add(nodes,path,enabled=true,ancestry={}){for(const t of nodes||[]){id(t);rows.push({...t,book:book.id,subject:book.subject,...ancestry,path:[book.title,...path].join(' › '),enabled:enabled&&t.classificationEnabled!==false})}}
 add(book.themes,[]);add(book.referenceSections,['수시참고'],false);
 for(const part of book.parts||[]){id(part);for(const ch of part.chapters||[]){id(ch);add(ch.themes,[part.title,ch.title],true,{partId:part.id,partTitle:part.title,chapterId:ch.id,chapterTitle:ch.title})}}
 }return rows
}
export function record(s,doc,session,numbers){
 const selected=new Set(numbers),date=new Date().toISOString();
 if([...selected].some(n=>!Number.isInteger(n)||n<1||n>doc.count))throw Error('문항 범위를 확인하세요.');
 s.events=s.events.filter(e=>e.session!==session||selected.has(e.number));
 for(const number of selected){const id=doc.id+'#'+number;
 let q=s.questions.find(x=>x.id===id);if(!q){q={id,doc:doc.id,number,regions:[],theme:null,secondary:[],status:'미복습',memo:''};s.questions.push(q)}
 if(!s.events.some(e=>e.session===session&&e.q===id)){s.events.push({id:session+'#'+number,q:id,session,number,date,instance:crypto.randomUUID()});if(q.status==='숙지 완료')q.status='복습 필요'}
 }}
export function stats(s){const count=new Map();for(const e of s.events)count.set(e.q,(count.get(e.q)||0)+1);return count}
export function infer(name){return {subject:subjects.find(x=>name.includes(x))||'미분류',year:name.match(/(?:19|20)\d{2}/)?.[0]||'',exam:name.match(/(?:국가직|지방직)\s*[79]급|서울시/)?.[0].replace(/(직)\s*/,'$1 ')||''}}
export function classify(s,data){if(data?.version!==1||!Array.isArray(data.results))throw Error('version 1 및 results 배열이 필요합니다.');
 const all=themes({schemaVersion:1,books:s.books}),seen=new Set();
 for(const r of data.results){const q=s.questions.find(x=>x.id===r.questionId);if(!q||seen.has(q.id)||!Array.isArray(r.secondaryThemeIds)||typeof r.reason!=='string'||typeof r.needsReview!=='boolean'||!Number.isFinite(r.confidence)||r.confidence<0||r.confidence>1)throw Error('분류 결과 형식 또는 문항 ID 오류');
 seen.add(q.id);const subject=s.documents.find(d=>d.id===q.doc)?.subject;const ids=[...(r.primaryThemeId===null?[]:[r.primaryThemeId]),...r.secondaryThemeIds];if(new Set(ids).size!==ids.length||ids.some(id=>!all.find(t=>t.id===id&&t.enabled&&t.subject===subject)))throw Error('문항 과목과 테마 ID를 확인하세요.');
 }return data.results}
export function validate(s){if(s?.version!==1)throw Error('지원하지 않는 백업 버전');
 for(const k of ['documents','questions','events','sessions','reviews','books']){if(!Array.isArray(s[k])||new Set(s[k].map(x=>x.id)).size!==s[k].length||s[k].some(x=>!x.id))throw Error('백업 ID 오류')}
 if(!Array.isArray(s.examTypes)||s.examTypes.some(x=>typeof x!=='string'))throw Error('시험 종류 오류');
 const ts=themes({schemaVersion:1,books:s.books});const doc=id=>s.documents.find(x=>x.id===id),q=id=>s.questions.find(x=>x.id===id);
 for(const d of s.documents)if(!/^[a-f0-9]{64}$/.test(d.hash)||!Number.isInteger(d.count)||d.count<1||d.count>300)throw Error('자료 정보 오류');
 for(const a of s.sessions)if(!doc(a.doc))throw Error('풀이 회차 오류');
 for(const x of s.questions){if(!doc(x.doc)||!Array.isArray(x.regions)||!Array.isArray(x.secondary)||[x.theme,...x.secondary].filter(Boolean).some(id=>!ts.some(t=>t.id===id)))throw Error('문항 연결 오류');
 for(const r of x.regions)if(!Number.isInteger(r.page)||r.page<1||![r.x,r.y,r.w,r.h].every(Number.isFinite)||r.x<0||r.y<0||r.w<=0||r.h<=0||r.x+r.w>1.00001||r.y+r.h>1.00001)throw Error('문항 좌표 오류')}
 for(const e of s.events)if(!q(e.q)||!s.sessions.some(a=>a.id===e.session&&a.doc===q(e.q).doc))throw Error('오답 연결 오류');
 for(const r of s.reviews)if(!q(r.q))throw Error('복습 연결 오류');
 if(s.purgedAttempts!==undefined&&(!Array.isArray(s.purgedAttempts)||s.purgedAttempts.some(k=>typeof k!=='string')))throw Error('영구 삭제 이력 형식 오류');
 if(s.removedMistakes!==undefined){
   if(!Array.isArray(s.removedMistakes))throw Error('오답 휴지통 형식 오류');
   for(const batch of s.removedMistakes){
     if(!batch.id||!Array.isArray(batch.events))throw Error('오답 휴지통 항목 오류');
     for(const event of batch.events)if(!event.id||!q(event.q)||!s.sessions.some(a=>a.id===event.session&&a.doc===q(event.q).doc))throw Error('오답 휴지통 연결 오류');
   }
 }
 return s}
