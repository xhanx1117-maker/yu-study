import {get} from './db.js';
import {openPdf} from './pdf.js';
import {renderArea} from './workbook-source.js';
import {vectorCrops} from './vector-client.js';

let library;
export async function loadLibrary(){
  if(!library)library=new Promise((resolve,reject)=>{
    const script=document.createElement('script');
    script.src=new URL('vendor/pdf-lib.min.js',document.baseURI);
    script.onload=()=>resolve(window.PDFLib);
    script.onerror=()=>{library=null;reject(Error('PDF 출력 모듈을 불러오지 못했습니다.'))};
    document.head.append(script);
  });
  return library;
}

async function png(canvas){
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
  if(!blob)throw Error('PDF에 넣을 이미지를 만들지 못했습니다.');
  return blob.arrayBuffer();
}

async function labelImage(output,page,text,x,top,size,maxWidth,height,bold=false){
  const factor=4,canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');
  const font=(bold?'600 ':'')+size+'px sans-serif';
  ctx.font=font;
  const w=Math.min(maxWidth,Math.ceil(ctx.measureText(text).width)+2);
  canvas.width=Math.max(1,Math.ceil(w*factor));canvas.height=Math.ceil((size+4)*factor);
  try{
    ctx.scale(factor,factor);ctx.font=font;ctx.textBaseline='top';ctx.fillStyle=bold?'#171717':'#343434';
    ctx.fillText(text,0,1,w);
    const image=await output.embedPng(await png(canvas));await image.embed();
    page.drawImage(image,{x,y:height-top-canvas.height/factor,width:canvas.width/factor,height:canvas.height/factor});
  }finally{canvas.width=canvas.height=1}
}

function boundsFor(view,x,y,w,h){
  const points=[[x,y],[x+w,y],[x,y+h],[x+w,y+h]].map(([a,b])=>view.convertToPdfPoint(a,b));
  return [Math.min(...points.map(p=>p[0])),Math.min(...points.map(p=>p[1])),Math.max(...points.map(p=>p[0])),Math.max(...points.map(p=>p[1]))];
}

// Separate cropped forms from a CJK exam often embed the same large font program.
// Reuse byte-identical font streams, then keep only the objects reachable from the trailer.
async function compactResources(output,lib,signal){
  await output.flush();
  const ctx=output.context,objects=ctx.enumerateIndirectObjects(),fonts=new Map();
  const fontRefs=new Set(),replacements=new Map();
  for(const [,obj] of objects){
    if(!(obj instanceof lib.PDFDict))continue;
    for(const key of ['FontFile','FontFile2','FontFile3']){
      const ref=obj.get(lib.PDFName.of(key));
      if(ref instanceof lib.PDFRef)fontRefs.add(ref);
    }
  }
  for(const ref of fontRefs){
    signal.throwIfAborted();
    const stream=ctx.lookup(ref);
    if(!(stream instanceof lib.PDFRawStream))continue;
    const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',stream.getContents()));
    const key=stream.dict.toString()+':'+Array.from(digest).join(',');
    if(fonts.has(key))replacements.set(ref,fonts.get(key));else fonts.set(key,ref);
  }
  const retained=new Set(),visited=new Set(),pending=Object.values(ctx.trailerInfo);
  while(pending.length){
    const entry=pending.pop();
    if(!entry||visited.has(entry))continue;
    visited.add(entry);
    if(entry instanceof lib.PDFRef){retained.add(entry);pending.push(ctx.lookup(entry));continue}
    const obj=entry instanceof lib.PDFStream?entry.dict:entry;
    if(obj instanceof lib.PDFDict || obj instanceof lib.PDFArray){
      const entries=obj instanceof lib.PDFDict?obj.entries():obj.asArray().entries();
      for(const [key,value] of entries){
        const replacement=replacements.get(value);
        if(replacement)obj.set(key,replacement);
        pending.push(replacement||value);
      }
    }
  }
  for(const [ref] of objects)if(!retained.has(ref))ctx.delete(ref);
}
export async function writeWorkbook(prepared, title, signal, progress){
  const {plan,options}=prepared,lib=await loadLibrary(),output=await lib.PDFDocument.create();
  const vector=vectorCrops(signal),plain=await output.embedFont(lib.StandardFonts.Helvetica);
  output.setTitle(title);output.setCreator('Yu: study');output.setProducer('Yu: study');
  if(prepared.references)output.setSubject(prepared.references);
  let key,source,blob,originalPdf,finished=0;
  const total=plan.pages.reduce((sum,p)=>sum+p.placements.filter(v=>v.kind==='crop').length,0);
  const formats={vector:0,raster:0,original:0};
  try{
    for(const [i,sheet] of plan.pages.entries()){
      signal.throwIfAborted();
      const paper=output.addPage([plan.width,plan.height]);
      await labelImage(output,paper,'Yu: study  ·  '+title,plan.margin,plan.margin-1,11,plan.width-2*plan.margin-48,plan.height,true);
      const line=(x1,y1,x2,y2)=>paper.drawLine({start:{x:x1,y:plan.height-y1},end:{x:x2,y:plan.height-y2},thickness:.45,color:lib.rgb(.55,.55,.55)});
      line(plan.margin,plan.top-6,plan.width-plan.margin,plan.top-6);
      for(const r of sheet.dividers)line(plan.width/2,r.start,plan.width/2,r.end);
      const footer=(i+1)+' / '+plan.pages.length;
      paper.drawText(footer,{x:plan.width-plan.margin-plain.widthOfTextAtSize(footer,8),y:plan.height-plan.margin-9,size:8,font:plain,color:lib.rgb(.2,.2,.2)});
      for(const item of sheet.placements){
        signal.throwIfAborted();
        if(item.kind==='label'){
          await labelImage(output,paper,item.text,item.x,item.y,item.size,item.width,plan.height,item.role==='section');continue;
        }
        const p=item.part;
        progress('PDF 구성',++finished,total);
        if(key!==p.hash){
          await source?.destroy();originalPdf=null;key=p.hash;blob=await get('files',key);
          if(!blob)throw Error('원본 PDF를 찾을 수 없습니다.');
          source=await openPdf(blob);
        }
        const original=await source.getPage(p.region.page),view=original.getViewport({scale:1});
        const left=p.x+item.sourceX,top=p.y+item.sourceY,w=item.sourceW,h=item.sourceH;
        const [l,b,r,t]=boundsFor(view,left,top,w,h);
        let vectorPage;
        if(p.wholePage){
          originalPdf ||= await lib.PDFDocument.load(await blob.arrayBuffer(),{updateMetadata:false});
          vectorPage=originalPdf.getPage(p.region.page-1);
          // PDF page embedding omits annotations. Paint them with the page when present.
          if((await original.getAnnotations({intent:'display'})).length)vectorPage=null;
        }else{
          const bytes=await vector.clip(key,blob,p.region.page,[l,b,r,t]);
          if(bytes){
            const clipped=await lib.PDFDocument.load(bytes,{updateMetadata:false});
            const candidate=clipped.getPage(0),resources=candidate.node.Resources();
            // Reject resource dictionaries that could carry unused image/form streams.
            // The worker kept only self-contained text and paths. PDFium can leave
            // old, unused image/form resource entries after regenerating the stream.
            // Only prune them if the regenerated content never invokes an XObject.
            const xObjects=resources?.lookup(lib.PDFName.of('XObject'));
            if(xObjects?.keys?.().length){
              const streams=candidate.node.Contents();
              const all=streams instanceof lib.PDFArray?streams.asArray():[streams];
              const unused=all.every(ref=>{
                const stream=clipped.context.lookup(ref);
                if(!(stream instanceof lib.PDFRawStream))return false;
                const data=lib.decodePDFRawStream(stream).decode();
                return !/\bDo\b/.test(new TextDecoder('latin1').decode(data));
              });
              if(unused)resources.delete(lib.PDFName.of('XObject'));
            }
            if(!['XObject','Pattern','Shading','Properties'].some(name=>resources?.lookup(lib.PDFName.of(name))?.keys?.().length)){
              candidate.node.delete(lib.PDFName.of('Annots'));candidate.node.delete(lib.PDFName.of('Metadata'));
              vectorPage=candidate;
            }
          }
        }
        const y=plan.height-item.y-item.h;
        if(vectorPage){
          const [a,bb,c,d,e,f]=view.transform;
          const form=await output.embedPage(vectorPage,{left:l,bottom:b,right:r,top:t},[a,-bb,c,-d,e-left,top+h-f]);
          await form.embed();
          paper.drawPage(form,{x:item.x,y,xScale:item.scale,yScale:item.scale});
          formats[p.wholePage?'original':'vector']++;
        }else{
          const region={x:left/view.width,y:top/view.height,w:w/view.width,h:h/view.height};
          const canvas=await renderArea(original,region,300/72*Math.max(1,item.scale),signal);
          try{
            const image=await output.embedPng(await png(canvas));await image.embed();
            paper.drawImage(image,{x:item.x,y,width:item.w,height:item.h});
          }finally{canvas.width=canvas.height=1}
          formats.raster++;
        }
        original.cleanup();
        await new Promise(resolve=>setTimeout(resolve,0));
      }
    }
    signal.throwIfAborted();progress('파일 마무리',1,1);
    await compactResources(output,lib,signal);
    const bytes=await output.save({objectsPerTick:20});
    signal.throwIfAborted();
    return {file:new File([bytes],'Yu-study_오답문제집_'+new Date().toISOString().slice(0,10)+'.pdf',{type:'application/pdf'}),formats};
  }finally{vector.close();await source?.destroy()}
}
