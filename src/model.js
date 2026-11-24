export const subjects=['����','����','������','������'];
export function initial(){return {version:1,documents:[],questions:[],events:[],reviews:[],sessions:[],books:[],examTypes:['������ 9��','������ 9��','������ 7��','������ 7��','�����','��Ÿ'],lastBackup:null}}
export function themes(seed){
 if(seed.schemaVersion!==1||!Array.isArray(seed.books))throw Error('���� ������ Ȯ���ϼ���.');
 const seen=new Set(),rows=[];
 function id(node){if(!node||typeof node.id!=='string'||!node.id||seen.has(node.id)||typeof node.title!=='string')throw Error('���� ID �Ǵ� �̸��� �߸��Ǿ����ϴ�.');seen.add(node.id)}
 for(const book of seed.books){id(book);if(!subjects.includes(book.subject))throw Error('������ Ȯ���ϼ���.');
 function add(nodes,path,enabled=true){for(const t of nodes||[]){id(t);rows.push({...t,book:book.id,subject:book.subject,path:[book.title,...path].join(' ? '),enabled:enabled&&t.classificationEnabled!==false})}}
 add(book.themes,[]);add(book.referenceSections,['��������'],false);
 for(const part of book.parts||[]){id(part);for(const ch of part.chapters||[]){id(ch);add(ch.themes,[part.title,ch.title])}}
 }return rows
}
export function record(s,doc,session,numbers){
 const selected=new Set(numbers),date=new Date().toISOString();
 if([...selected].some(n=>!Number.isInteger(n)||n<1||n>doc.count))throw Error('���� ������ Ȯ���ϼ���.');
 s.events=s.events.filter(e=>e.session!==session||selected.has(e.number));
 for(const number of selected){const id=doc.id+'#'+number;
 let q=s.questions.find(x=>x.id===id);if(!q){q={id,doc:doc.id,number,regions:[],theme:null,secondary:[],status:'�̺���',memo:''};s.questions.push(q)}
 if(!s.events.some(e=>e.session===session&&e.q===id)){s.events.push({id:session+'#'+number,q:id,session,number,date});if(q.status==='���� �Ϸ�')q.status='���� �ʿ�'}
 }}
export function stats(s){const count=new Map();for(const e of s.events)count.set(e.q,(count.get(e.q)||0)+1);return count}
export function infer(name){return {subject:subjects.find(x=>name.includes(x))||'�̺з�',year:name.match(/(?:19|20)\d{2}/)?.[0]||'',exam:name.match(/(?:������|������)\s*[79]��|�����/)?.[0].replace(/(��)\s*/,'$1 ')||''}}
export function classify(s,data){if(data?.version!==1||!Array.isArray(data.results))throw Error('version 1 �� results �迭�� �ʿ��մϴ�.');
 const all=themes({schemaVersion:1,books:s.books}),seen=new Set();
 for(const r of data.results){const q=s.questions.find(x=>x.id===r.questionId);if(!q||seen.has(q.id)||!Array.isArray(r.secondaryThemeIds)||typeof r.reason!=='string'||typeof r.needsReview!=='boolean'||!Number.isFinite(r.confidence)||r.confidence<0||r.confidence>1)throw Error('�з� ��� ���� �Ǵ� ���� ID ����');
 seen.add(q.id);const subject=s.documents.find(d=>d.id===q.doc)?.subject;const ids=[...(r.primaryThemeId===null?[]:[r.primaryThemeId]),...r.secondaryThemeIds];if(new Set(ids).size!==ids.length||ids.some(id=>!all.find(t=>t.id===id&&t.enabled&&t.subject===subject)))throw Error('���� ����� �׸� ID�� Ȯ���ϼ���.');
 }return data.results}
export function validate(s){if(s?.version!==1)throw Error('�������� �ʴ� ��� ����');
 for(const k of ['documents','questions','events','sessions','reviews','books']){if(!Array.isArray(s[k])||new Set(s[k].map(x=>x.id)).size!==s[k].length||s[k].some(x=>!x.id))throw Error('��� ID ����')}
 if(!Array.isArray(s.examTypes)||s.examTypes.some(x=>typeof x!=='string'))throw Error('���� ���� ����');
 const ts=themes({schemaVersion:1,books:s.books});const doc=id=>s.documents.find(x=>x.id===id),q=id=>s.questions.find(x=>x.id===id);
 for(const d of s.documents)if(!/^[a-f0-9]{64}$/.test(d.hash)||!Number.isInteger(d.count)||d.count<1||d.count>300)throw Error('�ڷ� ���� ����');
 for(const a of s.sessions)if(!doc(a.doc))throw Error('Ǯ�� ȸ�� ����');
 for(const x of s.questions){if(!doc(x.doc)||!Array.isArray(x.regions)||!Array.isArray(x.secondary)||[x.theme,...x.secondary].filter(Boolean).some(id=>!ts.some(t=>t.id===id)))throw Error('���� ���� ����');
 for(const r of x.regions)if(!Number.isInteger(r.page)||r.page<1||![r.x,r.y,r.w,r.h].every(Number.isFinite)||r.x<0||r.y<0||r.w<=0||r.h<=0||r.x+r.w>1.00001||r.y+r.h>1.00001)throw Error('���� ��ǥ ����')}
 for(const e of s.events)if(!q(e.q)||!s.sessions.some(a=>a.id===e.session&&a.doc===q(e.q).doc))throw Error('���� ���� ����');
 for(const r of s.reviews)if(!q(r.q))throw Error('���� ���� ����');return s}
