// Binary analysis runs on a bounded preview. Results are normalized source-page
// coordinates; the preview's pixel dimensions never determine the printed size.
export const regionVersion=2;
const clamp=(v,lo,hi)=>Math.min(hi,Math.max(lo,v));
export function examPixels({data,width,height}){
  const ink=new Uint8Array(width*height);
  for(let k=0;k<ink.length;k++){
    const i=k*4;
    ink[k]=data[i+3]>0 && Math.min(data[i],data[i+1],data[i+2])<244 ? 1:0;
  }
  return {ink,width,height};
}
function longest(ink,start,stride,length){
  let best=0,run=0;
  for(let n=0;n<length;n++,start+=stride){run=ink[start]?run+1:0;if(run>best)best=run}
  return best;
}
export function pageFrame(image,two,firstMarker=1,headerEnd=0,footerStart=1){
  const {ink,width:w,height:h}=image;
  let top=0,bottom=h,left=0,right=w;
  for(let y=0;y<h;y++){
    if(y>h*.16 && y<h*.84)continue;
    if(longest(ink,y*w,1,w)<w*.63)continue;
    if(y<h*.16 && y<firstMarker*h-2)top=y+1;
    if(y>h*.84)bottom=Math.min(bottom,y);
  }
  top=Math.max(top,Math.floor(headerEnd*h));
  bottom=Math.min(bottom,Math.ceil(footerStart*h));
  let best=0,divider=-1,edge=-1;
  for(let x=0;x<w;x++){
    if(x>w*.07&&x<w*.38 || x>w*.62&&x<w*.93)continue;
    const run=longest(ink,top*w+x,w,bottom-top);
    if(run<(bottom-top)*.52)continue;
    if(x<w*.07)left=x+1;
    else if(x>w*.93)right=Math.min(right,x);
    else if(two && (run>best || run===best&&Math.abs(x-w/2)<Math.abs(divider-w/2))){best=run;divider=x}
  }
  if(two){
    if(divider>=0){
      edge=divider+1;
      while(edge<right&&longest(ink,top*w+edge,w,bottom-top)>=(bottom-top)*.5)edge++;
      while(divider>left&&longest(ink,top*w+divider-1,w,bottom-top)>=(bottom-top)*.5)divider--;
    }else{
      let score=Infinity;
      for(let x=Math.floor(w*.43);x<=Math.ceil(w*.57);x++){
        let hits=0;
        for(let y=top;y<bottom;y++)hits+=ink[y*w+x];
        const cost=hits+Math.abs(x-w/2)*.2;
        if(cost<score){score=cost;divider=x}
      }
      edge=divider;
    }
  }
  return {top,bottom,lanes:two?[[left,divider],[edge,right]]:[[left,right]]};
}
function hasInk(image,l,r,y){
  for(let i=y*image.width+l,end=y*image.width+r;i<end;i++)if(image.ink[i])return true;
  return false;
}
export function beforeLine(image,frame,lane,line){
  const [l,r]=frame.lanes[lane], y=clamp(Math.floor(line.y*image.height),frame.top,frame.bottom-1);
  const distance=Math.ceil(Math.max(.006,line.h)*image.height);
  // Font ascenders are estimates. Choose the whitespace immediately before the
  // number, including when a preceding answer ends only one line above it.
  for(let d=0;d<=distance;d++){
    const up=y-d;
    if(up>=frame.top&&!hasInk(image,l,r,up))return up;
    const down=y+d;
    if(d && down<Math.min(frame.bottom,line.base*image.height-1)&&!hasInk(image,l,r,down))return down;
  }
  return y;
}
export function tightBand(image,frame,lane,start,end,page,pad=3){
  const {ink,width:w,height:h}=image,[l,r]=frame.lanes[lane];
  let x1=r,x2=l-1,y1=end,y2=start-1;
  for(let y=start;y<end;y++)for(let x=l;x<r;x++)if(ink[y*w+x]){
    x1=Math.min(x1,x);x2=Math.max(x2,x);y1=Math.min(y1,y);y2=y;
  }
  if(x2<x1||y2<y1)return null;
  const x=Math.max(l,x1-pad),y=Math.max(start,y1-pad);
  return {page,x:x/w,y:y/h,w:(Math.min(r,x2+1+pad)-x)/w,h:(Math.min(end,y2+1+pad)-y)/h};
}

// Some papers use a centered "total - current" footer without a horizontal rule.
export function repeatedPageEdges(pages){
  const tag=l=>l.str.trim().replace(/\d+/g,'#')+'@'+Math.round(l.x*50)+','+Math.round(l.base*150);
  const frequency=new Map();
  for(const pg of pages){
    const keys=new Set(pg.lines.filter(l=>l.bottom<.09||l.y>.92).map(tag));
    for(const k of keys)frequency.set(k,(frequency.get(k)||0)+1);
  }
  function repeated(line,index){
    if(pages.length<2||frequency.get(tag(line))<Math.max(2,Math.ceil(pages.length*.55)))return false;
    if(/시험|책형|쪽|페이지|년도|[0-9]\s*(?:\/|of)\s*[0-9]/i.test(line.str)||/^\s*\d+\s*$/.test(line.str))return true;
    if(line.y<=.92||line.x>=.5||line.right<=.5)return false;
    const sequence=line.str.match(/(?:^|\s)(\d+)\s*[-–—]\s*(\d+)\s*$/);
    if(!sequence)return false;
    const first=Number(sequence[1]),second=Number(sequence[2]);
    return first===pages.length&&second===index+1 || first===index+1&&second===pages.length;
  }
  return pages.map((pg,index)=>{
    const header=pg.lines.filter(l=>l.bottom<.09&&repeated(l,index));
    const footer=pg.lines.filter(l=>l.y>.92&&repeated(l,index));
    return [Math.max(0,...header.map(l=>l.bottom+.001)),Math.min(1,...footer.map(l=>l.y-.001))];
  });
}
