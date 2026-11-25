import {get} from './db.js';
import {openPdf,detect} from './pdf.js';
import {needsRepair,regionRecord} from './region-records.js';
import {sortRows} from './notebook-model.js';
import {planWorkbook,printSettings} from './workbook-layout.js';

export async function renderArea(page, region, scale, signal, maxPixels=7500000){
  signal.throwIfAborted();
  const original=page.getViewport({scale:1}), w=original.width*region.w,h=original.height*region.h;
  scale=Math.min(scale,4096/Math.max(w,h),Math.sqrt(maxPixels/(w*h)));
  const view=page.getViewport({scale}),canvas=document.createElement('canvas');
  canvas.width=Math.max(1,Math.ceil(w*scale));canvas.height=Math.max(1,Math.ceil(h*scale));
  const task=page.render({canvasContext:canvas.getContext('2d'),viewport:view,
    transform:[1,0,0,1,-region.x*view.width,-region.y*view.height],background:'white'});
  const abort=()=>task.cancel();signal.addEventListener('abort',abort,{once:true});
  try{await task.promise;return canvas}catch(error){canvas.width=canvas.height=1;signal.throwIfAborted();throw error}
  finally{signal.removeEventListener('abort',abort)}
}
const fullPage={x:0,y:0,w:1,h:1};
function checkedRegion(r){
  if(![r.x,r.y,r.w,r.h].every(Number.isFinite)||!Number.isInteger(r.page)||r.page<1||r.w<=0||r.h<=0||r.x<0||r.y<0||r.x+r.w>1.00001||r.y+r.h>1.00001)
    throw Error('문항 영역을 원본 시험지에서 확인하세요.');
  return {...r,w:Math.min(r.w,1-r.x),h:Math.min(r.h,1-r.y)};
}
function measureArea(part,page,pixels){
  const r=part.region,view=page.getViewport({scale:1});
  let x=r.x*view.width,y=r.y*view.height,w=r.w*view.width,h=r.h*view.height;
  const breaks=[];
  if(pixels){
    const {data,width,height}=pixels;
    const left=Math.max(0,Math.floor(r.x*width)),right=Math.min(width,Math.ceil((r.x+r.w)*width));
    const top=Math.max(0,Math.floor(r.y*height)),bottom=Math.min(height,Math.ceil((r.y+r.h)*height));
    let minX=right,minY=bottom,maxX=left-1,maxY=top-1,blankStart=top;
    for(let cy=top;cy<bottom;cy++){
      let ink=false;
      for(let cx=left;cx<right;cx++){
        const i=(cy*width+cx)*4;
        if(Math.min(data[i],data[i+1],data[i+2])<244){ink=true;minX=Math.min(minX,cx);maxX=Math.max(maxX,cx)}
      }
      if(ink){
        minY=Math.min(minY,cy);maxY=cy;
        if(cy-blankStart>=3)breaks.push((cy+blankStart)*.5/height*view.height);
        blankStart=cy+1;
      }
    }
    // Trim just vacant outer margins of machine-detected regions; retain a safety
    // border. A manually specified rectangle always retains its exact dimensions.
    if(part.trim&&maxX>=minX&&maxY>=minY){
      const nx=Math.max(x,(minX-4)/width*view.width),ny=Math.max(y,(minY-4)/height*view.height);
      w=Math.min(x+w,(maxX+5)/width*view.width)-nx;h=Math.min(y+h,(maxY+5)/height*view.height)-ny;
      x=nx;y=ny;
    }
  }
  return Object.assign(part,{x,y,width:w,height:h,pageWidth:view.width,pageHeight:view.height,
    oneColumn:!part.wholePage && r.w>.72,breaks:breaks.map(v=>v-y).filter(v=>v>0&&v<h)});
}

function labelsFor(row,options,seq,indexTheme) {
  const {doc,question:q,linked,count}=row,labels=[];
  const exam=[doc.year,doc.exam].filter(Boolean).join(' ');
  const grade=doc.title?.match(/[79]급/)?.[0];
  const source=options.source?([exam,grade && !exam.includes('급')?grade:''].filter(Boolean).join(' ')||doc.title):'';
  const line=[options.serial?'문항 '+seq:'',source,options.number?'원문 '+q.number+'번':''].filter(Boolean).join(' · ');
  if(line)labels.push({role:'source',text:line});
  const themes=indexTheme?[indexTheme,...linked.filter(t=>t!==indexTheme)]:linked;
  const details=[];
  if(options.theme)details.push(...themes.map(t=>[t.number,t.title].filter(Boolean).join(' ')));
  if(options.bookPage)details.push(...themes.filter(t=>t.page).map(t=>t.path.split(' › ')[0]+' p.'+t.page));
  if(options.count)details.push('누적 오답 '+count+'회');
  if(details.length)labels.push({role:'detail',text:details.join(' · ')});
  if(options.memo && q.memo)labels.push({role:'memo',text:'메모 · '+q.memo});
  return labels;
}

// Old automatic rectangles can end at the next question number and include the
// following common passage. Carve that explicitly identified band out of the body.
function withoutPassages(region,passages){
  let strips=[region];
  for(const p of passages){
    if(p.page!==region.page||p.x>region.x+.00001||p.x+p.w<region.x+region.w-.00001)continue;
    strips=strips.flatMap(r=>{
      const start=Math.max(r.y,p.y),end=Math.min(r.y+r.h,p.y+p.h);
      if(end<=start+.00001)return [r];
      const result=[];
      if(start-r.y>.00001)result.push({...r,h:start-r.y});
      if(r.y+r.h-end>.00001)result.push({...r,y:end,h:r.y+r.h-end});
      return result;
    });
  }
  return strips;
}
export async function prepareWorkbook(archive,rows,filters,input,signal,progress){
  const options=printSettings(input),seen=new Set(),originalPages=new Map(),partsByDoc=new Map();
  const docs=new Map(archive.documents.map(d=>[d.id,d]));
  let unique=rows.filter(row=>!seen.has(row.id)&&seen.add(row.id));
  if(options.mode!=='original'){
    const repaired=new Map(),groups=new Map();
    for(const row of unique){
      if(!groups.has(row.doc.id))groups.set(row.doc.id,[]);
      groups.get(row.doc.id).push(row);
    }
    for(const group of groups.values()){
      const doc=group[0].doc;
      if(!group.some(row=>needsRepair(regionRecord(doc,row.question))))continue;
      signal.throwIfAborted();
      const pdf=await openPdf(await get('files',doc.hash));
      try{repaired.set(doc.id,await detect(pdf,doc.count,{signal,progress}))}finally{await pdf.destroy()}
    }
    unique=unique.map(row=>{
      const previous=regionRecord(row.doc,row.question),next=repaired.get(row.doc.id)?.[row.question.number];
      const crop=needsRepair(previous)&&next?.regions.length?next:previous;
      return {...row,question:{...row.question,regions:crop.regions||[],reviewed:crop.reviewed,text:crop.text}};
    });
  }
  if(options.order!=='current')unique=sortRows(unique,options.order);
  const themeFor=row=>row.linked.find(t=>filters.themeIds?.includes(t.id))||row.linked[0];
  if(options.sections)unique=[...unique].sort((a,b)=>{
    const label=r=>{const t=themeFor(r);return t?t.path+' '+(t.number||'')+' '+t.title:'\uffff'};
    return label(a).localeCompare(label(b),'ko',{numeric:true});
  });
  const items=[],appendix=[],shared=new Set();
  function register(doc,r,flags={}){
    const part={doc:doc.id,hash:doc.hash,region:checkedRegion(r),...flags};
    if(!partsByDoc.has(doc.id))partsByDoc.set(doc.id,new Map());
    const pages=partsByDoc.get(doc.id);
    if(!pages.has(r.page))pages.set(r.page,[]);
    pages.get(r.page).push(part);return part;
  }
  const regionId=(hash,r)=>[hash,r.page,...[r.x,r.y,r.w,r.h].map(v=>v.toFixed(6))].join('/');
  const passagesByDoc=new Map(),knownShared=new Set(),owners=new Map();
  function mark(doc,r){
    const key=regionId(doc.hash,r);
    if(knownShared.has(key))return;
    knownShared.add(key);
    if(!passagesByDoc.has(doc.id))passagesByDoc.set(doc.id,[]);
    passagesByDoc.get(doc.id).push(r);
  }
  for(const doc of new Set(unique.map(row=>row.doc))){
    for(const q of Object.values(doc.detected||{}))if(!needsRepair(q))
      for(const r of q.regions||[])if(r.shared)mark(doc,r);
  }
  for(const {doc,question} of unique){
    for(const r of question.regions){
      const key=regionId(doc.hash,r);
      if(!owners.has(key))owners.set(key,new Set());
      owners.get(key).add(question.id);
      if(r.shared)mark(doc,r);
    }
  }
  // Older manual crops had no shared flag. Every participant must also have a
  // distinct body, otherwise identical whole-page crops are ambiguous.
  const individualBodies=new Set(unique.filter(({doc,question})=>question.regions.some(r=>
    !r.shared&&owners.get(regionId(doc.hash,r)).size===1)).map(row=>row.id));
  for(const {doc,question} of unique)for(const r of question.regions){
    const ids=owners.get(regionId(doc.hash,r));
    if(ids.size>1&&[...ids].every(id=>individualBodies.has(id)))mark(doc,r);
  }
  let lastTheme;
  for(const [i,row] of unique.entries()){
    const {question:q,doc}=row,t=themeFor(row), seq=i+1;
    if(!q.regions?.length)throw Error(doc.title+' '+q.number+'번의 영역을 지정하거나 미지정 문항 제외를 선택하세요.');
    const labels=labelsFor(row,options,seq,t);
    if(options.sections&&(t?.id||'none')!==lastTheme){
      labels.unshift({role:'section',text:t?[t.number,t.title].filter(Boolean).join(' '):'테마 미분류'});lastTheme=t?.id||'none';
    }
    if(options.mode==='original'){
      for(const n of new Set(q.regions.map(r=>r.page))){
        const key=doc.hash+'#'+n;
        if(originalPages.has(key)){originalPages.get(key).labels.push(...labels);continue}
        const item={id:key,labels:[...labels],parts:[register(doc,{page:n,...fullPage},{wholePage:true})],full:true};
        items.push(item);originalPages.set(key,item);
      }
    }else{
      const parts=[];
      const isPassage=r=>knownShared.has(regionId(doc.hash,r));
      for(const r of [...q.regions.filter(isPassage),...q.regions.filter(r=>!isPassage(r))]){
        if(isPassage(r)){
          const key=regionId(doc.hash,r);
          if(shared.has(key))continue;
          shared.add(key);
        }
        const trim=q.reviewed===false;
        for(const area of trim&&!isPassage(r)?withoutPassages(r,passagesByDoc.get(doc.id)||[]):[r])parts.push(register(doc,area,{trim}));
      }
      items.push({id:q.id,labels,parts});
    }
    if(options.answers&&q.solution&&(q.solution.text||q.solution.doc)){
      const label=[doc.title,'원문 '+q.number+'번',options.serial?'문항 '+seq:''].filter(Boolean).join(' · ');
      const entry={id:'answer-'+q.id,full:true,labels:[{role:'source',text:label}],parts:[]};
      if(q.solution.text)entry.labels.push({role:'memo',text:q.solution.text});
      if(q.solution.doc){
        const linked=docs.get(q.solution.doc);
        if(!linked)throw Error('연결된 해설 자료를 확인하세요.');
        entry.parts.push(register(linked,{page:q.solution.page,...fullPage},{wholePage:true}));
      }
      appendix.push(entry);
    }
  }
  if(appendix.length){appendix[0].newPage=true;appendix[0].labels.unshift({role:'section',text:'정답 및 해설'});items.push(...appendix)}
  const total=[...partsByDoc.values()].reduce((n,p)=>n+p.size,0);let done=0;
  for(const [docId,pages] of partsByDoc){
    signal.throwIfAborted();
    const pdf=await openPdf(await get('files',docs.get(docId).hash));
    try{
      for(const [n,parts] of pages){
        signal.throwIfAborted();progress('원본 영역 확인',++done,total);
        if(n>pdf.numPages)throw Error(docs.get(docId).title+'의 '+n+'쪽을 확인하세요.');
        const page=await pdf.getPage(n);let pixels;
        if(parts.some(p=>!p.wholePage)){
          const canvas=await renderArea(page,fullPage,1.35,signal,1200000);
          try{pixels=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height)}finally{canvas.width=canvas.height=1}
        }
        for(const part of parts)measureArea(part,page,pixels);
        page.cleanup();
      }
    }finally{await pdf.destroy()}
  }
  for(const pages of partsByDoc.values()){
    const lanes=new Map();
    for(const parts of pages.values())for(const part of parts){
      if(part.oneColumn||part.wholePage||part.width>part.pageWidth*.60)continue;
      const key=part.pageWidth+'x'+part.pageHeight;
      lanes.set(key,Math.max(lanes.get(key)||0,part.width));
    }
    for(const parts of pages.values())for(const part of parts){
      if(!part.oneColumn && !part.wholePage && part.width<=part.pageWidth*.60)part.laneWidth=lanes.get(part.pageWidth+'x'+part.pageHeight);
    }
  }
  const ctx=document.createElement('canvas').getContext('2d');
  const measure=(text,size)=>{ctx.font=size+'px sans-serif';return ctx.measureText(text).width};
  const references=options.serial?unique.map((r,i)=>(i+1)+' = '+[r.doc.year,r.doc.exam,r.doc.title,'원문 '+r.question.number+'번'].filter(Boolean).join(' · ')).join('\n'):'';
  return {options,plan:planWorkbook(items,options,measure),questionCount:unique.length,references};
}
