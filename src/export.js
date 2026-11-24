import {get} from './db.js';
import {openPdf,paint} from './pdf.js';

const width=1240, height=1754, margin=72, bottom=height-92;
let library;
async function loadLibrary(){
  if(!library)library=new Promise((resolve,reject)=>{
    const script=document.createElement('script');
    script.src=new URL('vendor/pdf-lib.min.js',document.baseURI);
    script.onload=()=>resolve(window.PDFLib);
    script.onerror=()=>{library=null;reject(Error('PDF 출력 모듈을 불러오지 못했습니다.'))};
    document.head.append(script);
  });
  return library;
}
export async function notebookPdf(state,list,title,onProgress){
  const {PDFDocument}=await loadLibrary();
  const output=await PDFDocument.create();
  const canvas=document.createElement('canvas');
  canvas.width=width;
  canvas.height=height;
  const ctx=canvas.getContext('2d');
  let y=0, pdf, currentHash;
  function startPage(){
    ctx.fillStyle='white';
    ctx.fillRect(0,0,width,height);
    ctx.fillStyle='#214c38';
    ctx.font='bold 32px sans-serif';
    ctx.fillText(title,margin,80,width-2*margin);
    y=112;
  }
  async function finishPage(){
    ctx.fillStyle='#45554a';
    ctx.font='20px sans-serif';
    ctx.fillText('Yu: study   ·   '+(output.getPageCount()+1),margin,height-42);
    const jpeg=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.95));
    if(!jpeg)throw Error('출력 페이지를 생성하지 못했습니다.');
    const image=await output.embedJpg(await jpeg.arrayBuffer());
    output.addPage([595.28,841.89]).drawImage(image,{x:0,y:0,width:595.28,height:841.89});
  }
  startPage();
  try{
    for(const [i,q] of list.entries()){
      onProgress(i+1,list.length);
      const d=state.documents.find(d=>d.id===q.doc);
      if(bottom-y<180){await finishPage();startPage()}
      ctx.fillStyle='#22372a';
      ctx.font='bold 24px sans-serif';
      ctx.fillText([d.year,d.exam,d.title,q.number+'번'].filter(Boolean).join(' · '),margin,y+30,width-2*margin);
      y+=50;
      if(!q.regions.length){
        ctx.font='22px sans-serif';
        ctx.fillText('문항 영역 미지정',margin,y+26);
        y+=54;
        continue;
      }
      if(d.hash!==currentHash){
        await pdf?.destroy();
        pdf=await openPdf(await get('files',d.hash));
        currentHash=d.hash;
      }
      for(const r of q.regions){
        const crop=document.createElement('canvas');
        await paint(pdf,r.page,crop,Math.min(3500,(width-2*margin)/r.w),r);
        const scale=(width-2*margin)/crop.width;
        let from=0;
        while(from<crop.height){
          const available=Math.floor((bottom-y)/scale);
          if(available<1){await finishPage();startPage();continue}
          const slice=Math.min(crop.height-from,available);
          ctx.drawImage(crop,0,from,crop.width,slice,margin,y,width-2*margin,slice*scale);
          y+=slice*scale;
          from+=slice;
        }
        crop.width=crop.height=1;
        y+=8;
      }
      y+=20;
    }
    await finishPage();
    return new File([await output.save()],'Yu-study_누적오답_'+new Date().toISOString().slice(0,10)+'.pdf',{type:'application/pdf'});
  }finally{await pdf?.destroy();canvas.width=canvas.height=1}
}
