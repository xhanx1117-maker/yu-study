const base=new URL('vendor/',document.baseURI);
let engine;
export async function openPdf(blob){engine??=await import(/* @vite-ignore */ new URL('pdf.min.mjs',base).href);engine.GlobalWorkerOptions.workerSrc=new URL('pdf.worker.min.mjs',base).href;
return engine.getDocument({data:new Uint8Array(await blob.arrayBuffer()),cMapUrl:new URL('cmaps/',base).href,cMapPacked:true,standardFontDataUrl:new URL('standard_fonts/',base).href,wasmUrl:new URL('wasm/',base).href,useWorkerFetch:true,isEvalSupported:false}).promise}
export async function paint(pdf,page,canvas,width=1100,region=null){const p=await pdf.getPage(page),v=p.getViewport({scale:1}),scale=Math.min(3,width/v.width),vp=p.getViewport({scale}),r=region||{x:0,y:0,w:1,h:1};canvas.width=Math.max(1,Math.ceil(vp.width*r.w));canvas.height=Math.max(1,Math.ceil(vp.height*r.h));await p.render({canvasContext:canvas.getContext('2d'),viewport:vp,transform:[1,0,0,1,-vp.width*r.x,-vp.height*r.y]}).promise}
export async function detect(pdf,count){
 const markers=[],texts=[],columns=[],passages=[];let last=0;
 for(let page=1;page<=pdf.numPages;page++){const p=await pdf.getPage(page),v=p.getViewport({scale:1}),tc=await p.getTextContent();const lines=[];
 for(const item of tc.items){if(!item.str?.trim())continue;const [x,y]=v.convertToViewportPoint(item.transform[4],item.transform[5]+item.height*.85);lines.push({x:x/v.width,y:y/v.height,str:item.str})}
 const match=t=>/^\s*(?:��\s*��?\s*(\d{1,3})(?:[.)]|\s|$)|(\d{1,3})[.)](?:\s|$|(?=[��-�R])))/.exec(t);
 const candidates=lines.filter(a=>match(a.str)&&a.y>.025&&a.y<.97);
 const two=candidates.some(a=>a.x>.45&&a.x<.61)&&candidates.some(a=>a.x<.15);columns[page]=two?2:1;
 function col(x){return two&&x>=.48?1:0}
 for(const a of lines){const shared=a.str.match(/[\[(��]\s*(\d+)\s*[~����?-]\s*(\d+)\s*[\])��]/);if(shared)passages.push({page,col:col(a.x),top:Math.max(0,a.y-.004),from:+shared[1],to:+shared[2]})}
 for(const a of candidates.sort((a,b)=>col(a.x)-col(b.x)||a.y-b.y)){const m=match(a.str),n=+(m[1]||m[2]);if(n<=last||n>count||(!m[1]&&a.x-(col(a.x)*.5)>.16))continue;markers.push({n,page,col:col(a.x),top:Math.max(0,a.y-.004)});last=n}
 texts[page]=lines;p.cleanup()}
 const out={};for(const [i,m] of markers.entries()){const next=markers[i+1],regions=[];const end=next?.page||m.page;
 for(let pg=m.page;pg<=end;pg++){for(let c=pg===m.page?m.col:0;c<columns[pg];c++){if(next&&pg===end&&c>next.col)break;const y=pg===m.page&&c===m.col?m.top:.035,bottom=next&&pg===end&&c===next.col?next.top:.965;if(bottom>y+.012)regions.push({page:pg,x:c/columns[pg],w:1/columns[pg],y,h:bottom-y})}}
 for(const a of passages.filter(a=>a.from<=m.n&&m.n<=a.to)){const first=markers.find(x=>x.n===a.from&&x.page===a.page&&x.col===a.col);if(first&&first.top>a.top)regions.unshift({page:a.page,x:a.col/columns[a.page],w:1/columns[a.page],y:a.top,h:first.top-a.top,shared:true})}
 out[m.n]={regions,text:regions.flatMap(r=>texts[r.page].filter(t=>t.x>=r.x&&t.x<r.x+r.w&&t.y>=r.y&&t.y<r.y+r.h).map(t=>t.str)).join(' '),reviewed:false}}
 return out}
