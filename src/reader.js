import {state,get,change} from './db.js';
import {materialKind,materialIndex,answerLabel} from './materials.js';
import {companionButtons,chooseVariant} from './material-ui.js';
import {readPosition,writePosition,readDraft,rememberDraft,mergeDraft,viewed} from './reader-memory.js';
import {studyStates,studyState,studyStats,setStudy} from './exam-catalog.js';
import {record,stats} from './model.js';
import {regionRecord,protectedRegion} from './region-records.js';
import {openPdf,paint,detect,textContent} from './pdf.js';
import {$,esc,notice,guard,on,action,options} from './ui.js';
import {download} from './backup.js';
// Older archives can keep validated rectangles only on the question.
function savedRegions(doc,archive){
 const map={...doc.detected};
 for(const q of archive.questions){
   if(q.doc!==doc.id)continue;
   const crop=regionRecord(doc,q);
   if(crop.regions?.length || crop.reviewed===true)map[q.number]={regions:crop.regions,text:crop.text||'',reviewed:protectedRegion(crop),regionVersion:crop.regionVersion};
 }
 return map;
}
export async function reader(id,alive,questionNumber,s,openDoc,context={}){
 s??=await state();const d=s.documents.find(x=>x.id===id);if(!d||!alive())return;
 const isPaper=materialKind(d)==='문제지',index=materialIndex(s.documents),group=index.groupFor(d.id,context.anchor);
 const [blob,position]=await Promise.all([get('files',d.hash),readPosition(d)]);if(!alive())return;if(!blob)throw Error('이 기기에서 원본 PDF를 찾을 수 없습니다.');
 const pdf=await openPdf(blob);if(!alive()){await pdf.destroy();return}
 const automatic=isPaper&&d.externalRegions?await get('meta','auto-regions:'+d.id+':'+d.hash):null;
 if(!alive()){await pdf.destroy();return}
 const baseDoc=x=>automatic?{...x,detected:{...automatic,...x.detected}}:x;
 const focus=isPaper&&(s.questions.find(q=>q.doc===id && q.number===questionNumber&&q.regions.length) || baseDoc(d).detected?.[questionNumber]);
 let page=Math.min(context.page||focus?.regions?.[0]?.page||position.page||1,pdf.numPages),zoom=[1,1.5,2].includes(position.zoom)?position.zoom:1,regionN=questionNumber||1,edit=false,busy=false,session=d.session,detected=isPaper?savedRegions(baseDoc(d),s):{},sharedRange=null,selected=new Set(),rev=0;
 const app=$('#app');app.innerHTML='<div class="row">'+action('view-back','‹ 뒤로')+'</div><h1>'+esc(d.title)+'</h1><div class="row workspace-tabs">'+companionButtons(group,id,true)+'</div><div class="workspace"><div><div class="row">'+action('prev','이전')+'<label>페이지 <input id="pg" type="number" min="1" max="'+pdf.numPages+'" value="'+page+'"></label><span>/ '+pdf.numPages+'</span>'+action('next','다음')+action('zoom','확대')+action('original','원본 저장')+'</div><div class="sheet"><div class="paper"><canvas></canvas></div></div></div><div><details class="box" open><summary>오답 등록</summary><label>풀이 회차 <select id="sessions"></select></label>'+action('newSession','새 회차')+'<div class="numbers"></div>'+action('save','선택 저장','primary')+'</details><details class="box"><summary>문항 영역 검수</summary><label>문항 번호 <input id="rn" type="number" min="1" max="'+d.count+'" value="1"></label>'+action('auto','자동 인식')+action('drag','영역 그리기')+'<details class="shared-edit"><summary>공통 지문 지정</summary><label>시작 문항<input id="shared-first" type="number" min="1" max="'+d.count+'" value="'+regionN+'"></label><label>끝 문항<input id="shared-last" type="number" min="1" max="'+d.count+'" value="'+Math.min(d.count,regionN+1)+'"></label>'+action('shared-drag','이 문항들의 공통 지문 그리기')+'</details>'+action('whole','현재 페이지 추가')+action('undoReg','마지막 영역 제거')+action('resetReg','영역 초기화')+'<p class="sub" id="reginfo"></p></details></div></div>';
 const paperStats=isPaper?studyStats(s).get(d.id):null;
 const sheet=app.querySelector('.sheet');let saveTimer,baseline=new Set(),restoreScroll=true,positionDirty=false;
 function persist(){
   clearTimeout(saveTimer);if(!positionDirty)return;positionDirty=false;
   return writePosition(d,{page,zoom,x:sheet.scrollLeft,y:sheet.scrollTop,windowY:window.scrollY});
 }
 function moved(){positionDirty=true;clearTimeout(saveTimer);saveTimer=setTimeout(()=>guard(persist)(),350)}
 const switchTo=next=>{if(next!==id)return openDoc(next,group?.paper?.id||context.anchor)};
 app.querySelector('.workspace-tabs').onclick=guard(e=>{
   const b=e.target.closest('button');if(b?.dataset.variants)return chooseVariant(group[b.dataset.variants],switchTo);
   if(b?.dataset.openMaterial)return switchTo(b.dataset.openMaterial);
 });
 on('view-back',context.back||(()=>{}));
 const column=app.querySelector('.workspace > div:last-child');
 if(!isPaper)column.innerHTML='<p class="box">'+esc(materialKind(d)==='정답지'?answerLabel(d):d.type)+'</p>'+(questionNumber?'<p>'+questionNumber+'번 · 페이지를 직접 선택하거나 문항 번호를 찾으세요.</p><button id="find-number">'+questionNumber+'번 위치 찾기</button><div id="number-hits" role="status"></div>':'');
 else{
   const tools=document.createElement('details');tools.className='box';tools.innerHTML='<summary>시험지 풀이·복습 상태</summary><label>상태<select id="reader-study">'+options(studyStates,studyState(d,paperStats))+'</select></label><p class="sub" id="reader-stat"></p>';
   column.append(tools);
   function describe(doc,counts){$('#reader-stat').textContent='풀이 '+(counts?.solved.size||0)+'회 · 마지막 풀이 '+(counts?.lastSolved?.slice(0,10)||'없음')+' · 마지막 복습 '+([doc.lastReview||'',counts?.lastReview||''].sort().at(-1)?.slice(0,10)||'없음')+' · 고유 오답 '+(counts?.wrong.size||0)+' · 누적 '+(counts?.attempts||0)}
   describe(d,paperStats);
   on('reader-study',async e=>{const status=e.target.value;await saveDoc((doc,v)=>setStudy(v,doc,status));const v=await state();if(alive())describe(v.documents.find(doc=>doc.id===id),studyStats(v).get(id))},'change');
   if(group?.review){const hint=document.createElement('small');hint.textContent='정답지 연결 검토 · 자료 관리에서 정답지를 지정할 수 있습니다.';tools.append(hint)}
 }
 const lifetime=new AbortController();
 async function saveDoc(fn){await change(v=>{fn(v.documents.find(x=>x.id===id),v)})}
 async function panel(v){v??=await state();if(!alive())return;const list=v.sessions.filter(a=>a.doc===id);$('#sessions').innerHTML=list.map((a,i)=>'<option value="'+esc(a.id)+'" '+(a.id===session?'selected':'')+'>'+ (i+1)+'회 · '+esc(a.date.slice(0,10))+'</option>').join('');baseline=new Set(v.events.filter(e=>e.session===session).map(e=>e.number));selected=mergeDraft(baseline,readDraft(id,session));const counts=stats(v),byNumber=new Map(v.questions.filter(q=>q.doc===id).map(q=>[q.number,q]));$('.numbers').innerHTML=Array.from({length:d.count},(_,i)=>{const n=i+1,q=byNumber.get(n),count=counts.get(id+'#'+n)||0;return '<button data-n="'+n+'" aria-pressed="'+selected.has(n)+'" class="'+(selected.has(n)?'selected':'')+'">'+String(n).padStart(2,'0')+'<small>'+(selected.has(n)?'✓ ':'')+(count?count+'회':'')+(q?.status==='숙지 완료'?' ✔':'')+'</small></button>'}).join('')}
 function overlay(){if(!alive()||!isPaper)return;const p=$('.paper'),rs=detected[regionN]?.regions||[];p.querySelectorAll('.rect').forEach(x=>x.remove());for(const r of rs.filter(r=>r.page===page)){const el=document.createElement('i');el.className='rect';Object.assign(el.style,{left:r.x*100+'%',top:r.y*100+'%',width:r.w*100+'%',height:r.h*100+'%'});p.append(el)}$('#reginfo').textContent=regionN+'번 · 영역 '+rs.length+'개 · '+(detected[regionN]?.reviewed?'수동 지정':'검수 필요')}
 let rendering;
 async function draw(){
   const token=++rev,drawPage=page,cv=document.createElement('canvas');
   rendering?.abort();const controller=rendering=new AbortController();
   try{await paint(pdf,drawPage,cv,1100*zoom,null,controller.signal)}
   catch(error){cv.width=cv.height=1;if(controller.signal.aborted||!alive())return;throw error}
   if(!alive()||token!==rev){cv.width=cv.height=1;return}
   const old=paper.querySelector('canvas');old.replaceWith(cv);old.width=old.height=1;
   paper.style.width=zoom*100+'%';$('#pg').value=drawPage;overlay();
   if(restoreScroll){
     restoreScroll=false;
     const same=!context.page&&!focus;
     sheet.scrollTo(same?position.x||0:0,same?position.y||0:0);
     window.scrollTo(0,same?position.windowY||0:0);
   }
   moved();
 }
 async function go(n){sheet.scrollTo(0,0);page=Math.min(pdf.numPages,Math.max(1,Number(n)||1));await draw()}
 async function updateRegions(fn){await saveDoc((x,v)=>{const map=savedRegions(x,v),row=map[regionN]||automatic?.[regionN]&&structuredClone(automatic[regionN])||{regions:[]};fn(row.regions);map[regionN]={...row,reviewed:true,text:'',regions:row.regions};x.detected=map;const q=v.questions.find(q=>q.doc===id&&q.number===regionN);if(q)Object.assign(q,map[regionN]);detected={...automatic,...map}});overlay()}
 async function scan(){if(busy)return;busy=true;notice('문항 위치를 분석하고 있습니다.');try{const map=await detect(pdf,d.count,{signal:lifetime.signal});await saveDoc((x,v)=>{const rows=savedRegions(x,v);for(const [key,row] of Object.entries(map)){if(!protectedRegion(rows[key])){rows[key]=row;const q=v.questions.find(q=>q.doc===id&&q.number===+key);if(q)Object.assign(q,row)}}x.detected=rows;x.scanned=true;if(x.analysisState)x.analysisState=Object.keys(map).length?'done':'manual';detected=rows});overlay();if(alive())notice(Object.keys(map).length+'개 문항을 인식했습니다. 영역을 확인하세요.')}finally{busy=false}}
 if(isPaper)$('.numbers').onclick=e=>{const b=e.target.closest('[data-n]');if(!b)return;const n=+b.dataset.n;selected.has(n)?selected.delete(n):selected.add(n);b.classList.toggle('selected',selected.has(n));b.setAttribute('aria-pressed',selected.has(n));rememberDraft(id,session,selected,baseline);regionN=n;$('#rn').value=n;overlay()};
 on('save',async()=>{const draft=readDraft(id,session);await saveDoc((x,v)=>{const current=v.events.filter(e=>e.session===session).map(e=>e.number);record(v,x,session,[...mergeDraft(current,draft)]);const attempt=v.sessions.find(a=>a.id===session);if(attempt&&!attempt.solvedAt)attempt.solvedAt=new Date().toISOString();for(const q of v.questions.filter(q=>q.doc===id)){const crop=regionRecord(baseDoc(x),q);if(crop!==q)Object.assign(q,crop)}});rememberDraft(id,session,new Set(),new Set());await panel();notice('오답을 저장했습니다.')});
 on('sessions',async e=>{session=e.target.value;await saveDoc(x=>{x.session=session});await panel()},'change');
 on('newSession',async()=>{session=crypto.randomUUID();await saveDoc((x,v)=>{v.sessions.push({id:session,doc:id,date:new Date().toISOString()});x.session=session});await panel()});
 on('prev',()=>go(page-1));on('next',()=>go(page+1));on('pg',e=>go(e.target.value),'change');on('zoom',async()=>{zoom=zoom===1?1.5:zoom===1.5?2:1;await draw()});on('original',()=>download(blob,d.title+'.pdf'));
 on('rn',e=>{regionN=Math.max(1,Math.min(d.count,+e.target.value||1));overlay()},'change');on('auto',scan);
 function drawing(active,range=null){edit=active;sharedRange=range;$('.paper').classList.toggle('edit',active);$('#drag').textContent=active?'그리기 종료':'영역 그리기'}
 on('drag',()=>drawing(!edit));
 on('shared-drag',()=>{
   const first=Number($('#shared-first').value),last=Number($('#shared-last').value);
   if(!Number.isInteger(first)||!Number.isInteger(last)||first<1||last<first||last>d.count)throw Error('공통 지문을 사용할 문항 범위를 확인하세요.');
   drawing(true,{first,last});$('.sheet').scrollIntoView({block:'center'});notice('원본 위에 공통 지문 영역을 그리세요.');
 });
 async function addPassage(area,{first,last}){
   await saveDoc((x,v)=>{
     const map=savedRegions(x,v),questions=new Map(v.questions.filter(q=>q.doc===id).map(q=>[q.number,q]));
     for(let n=first;n<=last;n++){
       const row=map[n]||automatic?.[n]&&structuredClone(automatic[n])||{regions:[],text:''};
       row.regions=[...row.regions.filter(r=>!(r.shared&&r.page===area.page&&Math.abs(r.x-area.x)<.00001&&Math.abs(r.y-area.y)<.00001&&Math.abs(r.w-area.w)<.00001&&Math.abs(r.h-area.h)<.00001)),{...area,shared:true}];
       row.reviewed=true;map[n]=row;
       if(questions.has(n))Object.assign(questions.get(n),row);
     }
     x.detected=map;detected={...automatic,...map};
   });
   if(alive()){drawing(false);overlay();notice(first+'~'+last+'번에 공통 지문을 연결했습니다.')}
 }
 on('whole',()=>updateRegions(rs=>rs.push({page,x:0,y:0,w:1,h:1})));on('undoReg',()=>updateRegions(rs=>rs.pop()));on('resetReg',()=>updateRegions(rs=>rs.splice(0)));
 const paper=$('.paper');let start;function point(e){const r=paper.getBoundingClientRect();return [Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),Math.max(0,Math.min(1,(e.clientY-r.top)/r.height))]}
 paper.onpointerdown=e=>{if(edit){paper.setPointerCapture(e.pointerId);start=point(e)}};paper.onpointercancel=()=>start=null;paper.onpointerup=guard(async e=>{if(!start)return;const end=point(e),[a,b]=start;start=null;const [x,y]=end,w=Math.abs(x-a),h=Math.abs(y-b);if(w>.01&&h>.01){
   const area={page,x:Math.min(a,x),y:Math.min(b,y),w,h};
   if(sharedRange)await addPassage(area,sharedRange);else await updateRegions(rs=>rs.push(area));
 }});
 on('find-number',async()=>{
   const hits=$('#number-hits'),button=$('#find-number');button.disabled=true;hits.textContent='PDF 텍스트에서 문항 번호를 찾는 중…';
   try{
     const wanted=new RegExp('^\\s*(?:문(?:제)?\\s*)?'+Number(questionNumber)+'\\s*(?:번(?:\\s|$)|[.．)](?:\\s|[^0-9]|$))'),pages=[];
     for(let n=1;n<=pdf.numPages&&alive()&&!lifetime.signal.aborted;n++){
       const p=await pdf.getPage(n);
       try{if((await textContent(p)).items.some(item=>wanted.test(item.str||'')))pages.push(n)}finally{p.cleanup()}
     }
     if(!alive())return;
     hits.innerHTML=pages.length?'<p>문항 번호가 발견된 페이지</p>'+pages.map(n=>'<button data-hit="'+n+'">'+n+'쪽</button>').join(''):'텍스트에서 번호를 확인하지 못했습니다. 페이지 번호로 이동하세요.';
     hits.onclick=guard(e=>{const b=e.target.closest('[data-hit]');if(b)return go(+b.dataset.hit)});
   }finally{button.disabled=false}
 });
 if(isPaper){$('#rn').value=regionN;await panel(s)}await draw();
 if(!alive()){lifetime.abort();await pdf.destroy();return}
 sheet.addEventListener('scroll',moved,{passive:true,signal:lifetime.signal});window.addEventListener('scroll',moved,{passive:true,signal:lifetime.signal});
 window.addEventListener('pagehide',persist,{signal:lifetime.signal});await viewed(d,group?.paper?.id||context.anchor);
 if(isPaper&&!d.scanned&&!d.analysisState&&alive())guard(scan)();
 return ()=>{if(positionDirty)guard(persist)();lifetime.abort();rendering?.abort();const canvas=paper.querySelector('canvas');if(canvas)canvas.width=canvas.height=1;pdf.destroy().catch(()=>{})}
}
