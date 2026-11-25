import {examPixels,pageFrame,beforeLine,tightBand,regionVersion} from './exam-regions.js';
const base=new URL('vendor/',document.baseURI);
let engine;
export async function openPdf(blob){engine??=await import(/* @vite-ignore */ new URL('pdf.min.mjs',base).href);engine.GlobalWorkerOptions.workerSrc=new URL('pdf.worker.min.mjs',base).href;
return engine.getDocument({data:new Uint8Array(await blob.arrayBuffer()),cMapUrl:new URL('cmaps/',base).href,cMapPacked:true,standardFontDataUrl:new URL('standard_fonts/',base).href,wasmUrl:new URL('wasm/',base).href,useWorkerFetch:true,isEvalSupported:false}).promise}
export async function paint(pdf,page,canvas,width=1100,region=null){const p=await pdf.getPage(page),v=p.getViewport({scale:1}),scale=Math.min(3,width/v.width),vp=p.getViewport({scale}),r=region||{x:0,y:0,w:1,h:1};canvas.width=Math.max(1,Math.ceil(vp.width*r.w));canvas.height=Math.max(1,Math.ceil(vp.height*r.h));await p.render({canvasContext:canvas.getContext('2d'),viewport:vp,transform:[1,0,0,1,-vp.width*r.x,-vp.height*r.y]}).promise}
async function textContent(page){
 // Some Safari versions support stream readers but not async stream iteration.
 // PDF.js getTextContent uses for-await even in its legacy build.
 if(typeof ReadableStream.prototype[Symbol.asyncIterator]==='function')return page.getTextContent();
 const reader=page.streamTextContent().getReader(),content={items:[],styles:Object.create(null),lang:null};
 try{while(true){const {value,done}=await reader.read();if(done)break;content.lang??=value.lang;Object.assign(content.styles,value.styles);content.items.push(...value.items)}}
 finally{reader.releaseLock()}
 return content;
}
const numberPrefix=/^\s*(?:문\s*제?\s*(\d{1,3})(?:[.)．]|\s|$)|(\d{1,3})\s*[.)．](?=\s|$|[^\d]))/;
const passagePrefix=/[\[(【［]\s*(\d+)\s*[~～∼–-]\s*(\d+)\s*[\])】］]/;
function pageText(view,tc){
  return tc.items.filter(t=>t.str?.trim()).map(t=>{
    const [a,b,c,d,x,y]=t.transform, along=Math.hypot(a,b)||1,up=Math.hypot(c,d)||1;
    const height=t.height||up,style=tc.styles[t.fontName]||{};
    const ascent=Math.max(.7,Math.min(1.1,style.ascent||.85))*height;
    const descent=Math.min(.32,Math.abs(style.descent||.18))*height;
    const points=[];
    for(const end of [0,t.width||0])for(const rise of [-descent,ascent])
      points.push(view.convertToViewportPoint(x+end*a/along+rise*c/up,y+end*b/along+rise*d/up));
    const xs=points.map(p=>p[0]/view.width),ys=points.map(p=>p[1]/view.height);
    const [left,top,right,bottom]=[Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)];
    return {x:left,y:top,right,bottom,h:bottom-top,base:view.convertToViewportPoint(x,y)[1]/view.height,str:t.str};
  });
}
function markerLines(lines,count){
  const result=[];
  for(let i=0;i<lines.length;i++){
    const l=lines[i];
    let value=l.str;
    if(/^\s*(?:문\s*(?:제\s*)?)?\d{1,3}\s*$/.test(value)){
      const next=lines[i+1];
      if(next && Math.abs(next.base-l.base)<l.h*.45 && Math.abs(next.x-l.right)<.014)value+=next.str.trimStart();
    }
    const m=numberPrefix.exec(value);
    if(m && +(m[1]||m[2])<=count && +(m[1]||m[2])>0)result.push({...l,n:+(m[1]||m[2])});
  }
  return result;
}
function repeatedEdge(pages){
  const tag=l=>l.str.trim().replace(/\d+/g,'#')+'@'+Math.round(l.x*50)+','+Math.round(l.base*150);
  const frequency=new Map();
  for(const pg of pages){
    const keys=new Set(pg.lines.filter(l=>l.bottom<.09||l.y>.92).map(tag));
    for(const k of keys)frequency.set(k,(frequency.get(k)||0)+1);
  }
  const repeated=l=>pages.length>1 && frequency.get(tag(l))>=Math.max(2,Math.ceil(pages.length*.55)) &&
    (/시험|책형|쪽|페이지|년도|[0-9]\s*(?:\/|of)\s*[0-9]/i.test(l.str)||/^\s*\d+\s*$/.test(l.str));
  return pages.map(pg=>{
    const header=pg.lines.filter(l=>l.bottom<.09&&repeated(l));
    const footer=pg.lines.filter(l=>l.y>.92&&repeated(l));
    return [Math.max(0,...header.map(l=>l.bottom+.001)),Math.min(1,...footer.map(l=>l.y-.001))];
  });
}
export async function detect(pdf,count,{signal,progress=()=>{}}={}){
  const pages=[];
  for(let n=1;n<=pdf.numPages;n++){
    signal?.throwIfAborted();
    const page=await pdf.getPage(n);
    try{
      const lines=pageText(page.getViewport({scale:1}),await textContent(page));
      const candidates=markerLines(lines,count);
      pages.push({lines,candidates});
    }finally{page.cleanup()}
  }
  const edge=repeatedEdge(pages);
  const right=l=>l.x>.41&&l.x<.69,left=l=>l.x<.25;
  const twoInBook=pages.some(p=>p.candidates.some(left)&&p.candidates.some(right));
  const out={},passages=[];
  let active=null,previous=0;
  function append(region,lines){
    if(!region||!active)return;
    active.regions.push(region);
    const inRegion=lines.filter(l=>l.x<region.x+region.w && l.right>region.x && l.base>=region.y && l.base<=region.y+region.h);
    active.text.push(...inRegion.map(l=>l.str));
  }
  for(const [index,info] of pages.entries()){
    signal?.throwIfAborted();progress('문항 영역 분석',index+1,pages.length);
    const page=await pdf.getPage(index+1),view=page.getViewport({scale:1});
    const scale=Math.min(1.65,1800/Math.max(view.width,view.height),Math.sqrt(1450000/(view.width*view.height)));
    const vp=page.getViewport({scale}),canvas=document.createElement('canvas');
    canvas.width=Math.ceil(vp.width);canvas.height=Math.ceil(vp.height);
    const ctx=canvas.getContext('2d',{willReadFrequently:true});
    const task=page.render({canvasContext:ctx,viewport:vp,background:'white'});
    const abort=()=>task.cancel();signal?.addEventListener('abort',abort,{once:true});
    try{
      await task.promise;signal?.throwIfAborted();
      const bitmap=examPixels(ctx.getImageData(0,0,canvas.width,canvas.height));
      canvas.width=canvas.height=1;
      const wideText=info.lines.some(l=>l.y>.1&&l.bottom<.93&&l.x<.34&&l.right>.69);
      const two=info.candidates.some(right)&&(twoInBook||info.candidates.some(left)) || twoInBook&&!wideText;
      const first=Math.min(1,...info.candidates.filter(l=>l.n>previous).map(l=>l.y));
      const frame=pageFrame(bitmap,two,first,Math.min(edge[index][0],first),edge[index][1]);
      const padding=Math.ceil(4.5*scale);
      for(const [col,lane] of frame.lanes.entries()){
        const inLane=l=>l.x*bitmap.width>=lane[0]-2 && l.x*bitmap.width<lane[1];
        const candidates=info.candidates.filter(l=>inLane(l)&&(col?right(l):left(l)));
        const anchor=Math.min(...candidates.map(l=>l.x));
        const entries=candidates.filter(l=>l.x<=anchor+.045).map(l=>({...l,kind:'number'}));
        for(const line of info.lines.filter(inLane)){
          const m=passagePrefix.exec(line.str);
          if(m && +m[1]>previous && +m[2]>=+m[1] && +m[2]<=count)entries.push({...line,kind:'passage',from:+m[1],to:+m[2]});
        }
        let start=frame.top;
        for(const entry of entries.sort((a,b)=>a.y-b.y||a.x-b.x)){
          if(entry.kind==='number'&&entry.n<=previous || entry.base*bitmap.height<frame.top || entry.y*bitmap.height>=frame.bottom)continue;
          const cut=Math.max(start,beforeLine(bitmap,frame,col,entry));
          append(tightBand(bitmap,frame,col,start,cut,index+1,padding),info.lines);
          start=cut;
          if(entry.kind==='number'){
            previous=entry.n;active={regions:[],text:[],reviewed:false,regionVersion};out[entry.n]=active;
          }else{active={regions:[],text:[],from:entry.from,to:entry.to};passages.push(active)}
        }
        append(tightBand(bitmap,frame,col,start,frame.bottom,index+1,padding),info.lines);
      }
    }finally{signal?.removeEventListener('abort',abort);canvas.width=canvas.height=1;page.cleanup()}
  }
  for(const passage of passages){
    for(let i=passage.from;i<=passage.to;i++)if(out[i]){
      out[i].regions.unshift(...passage.regions.map(r=>({...r,shared:true})));
      out[i].text.unshift(...passage.text);
    }
  }
  for(const v of Object.values(out))v.text=v.text.join(' ');
  return out;
}
