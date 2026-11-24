// All layout coordinates are PDF points measured from the top-left of an A4 sheet.
export const MM = 72 / 25.4;
export const A4 = {width:210*MM,height:297*MM};
export const layouts = {auto:'원본 기반 자동',two:'시험지형 2단',one:'시험지형 1단',original:'원본 페이지',individual:'문항별 개별 페이지'};
export const defaults = {mode:'auto',scale:100,margin:8,gap:4,divider:true,source:true,number:true,serial:false,
  theme:false,bookPage:false,count:false,memo:false,answers:false,sections:false,order:'current'};
export function printSettings(input={}) {
  const result={...defaults};
  for(const key of Object.keys(result)){
    if(typeof result[key]==='boolean' && typeof input?.[key]==='boolean')result[key]=input[key];
  }
  if(Object.hasOwn(layouts,input?.mode))result.mode=input.mode;
  if(['current','recent','year','theme','repeated'].includes(input?.order))result.order=input.order;
  for(const [key,min,max] of [['scale',50,150],['margin',5,24],['gap',1,15]]){
    const value=Number(input?.[key]);
    if(Number.isFinite(value)&&value>=min&&value<=max)result[key]=value;
  }
  return result;
}

export function wrapLines(text,width,measure,size) {
  const lines=[];
  for(const paragraph of String(text||'').split(/\r?\n/)){
    let line='';
    for(const char of paragraph){
      if(line && measure(line+char,size)>width){lines.push(line.trimEnd());line=''}
      line+=char;
    }
    if(line.trim())lines.push(line.trim());
  }
  return lines;
}

export function planWorkbook(items, input, measure=(text,size)=>[...text].length*size*.78){
  const options=printSettings(input), margin=options.margin*MM,gap=options.gap*MM,gutter=5*MM;
  const top=margin+23,bottom=A4.height-margin-16,full=A4.width-2*margin,colWidth=(full-gutter)/2;
  const requested=options.scale/100, pages=[];
  let page, band, ends, column;
  function newPage(){
    page={placements:[],dividers:[],notes:[]};pages.push(page);band=top;ends=[top,top];column=0;
  }
  function nextSlot(wide){if(!wide&&column===0){column=1}else newPage()}
  function position(wide){return wide?Math.max(...ends):ends[column]}
  function space(wide,needed){
    while(position(wide)+needed>bottom+.01 && (position(wide)>top+.01 || (!wide&&column===0))) nextSlot(wide);
  }
  function draw(wide,placement){
    const y=position(wide), x=margin+(!wide&&column===1?colWidth+gutter:0);
    page.placements.push({...placement,x,y});
    if(!wide&&options.divider){
      let rule=page.dividers.find(rule=>rule.start===band);
      if(!rule){rule={start:band,end:y};page.dividers.push(rule)}
      rule.end=Math.max(rule.end,y+placement.h);
    }
    if(wide){band=y+placement.h;ends=[band,band];column=0}
    else ends[column]=y+placement.h;
  }
  function advance(wide,distance){
    if(wide){band=Math.max(...ends)+distance;ends=[band,band];column=0}
    else ends[column]+=distance;
  }
  function blockLabels(item,width){
    const lines=[];
    for(const label of item.labels||[]){
      const size=label.role==='section'?12:label.role==='memo'?8.5:8;
      for(const line of wrapLines(label.text,width,measure,size)) lines.push({kind:'label',text:line,role:label.role,size,h:size+3});
    }
    return lines;
  }
  for(const item of items){
    if(!page || ((options.mode==='individual'||options.mode==='original'||item.newPage)&&page.placements.length))newPage();
    const widest=Math.max(1,...item.parts.map(p=>p.width));
    const wide=['one','individual','original'].includes(options.mode)||item.full ||
      (options.mode==='auto'&&item.parts.some(p=>p.oneColumn)) || widest*requested>colWidth/.90;
    const usable=wide?full:colWidth;
    const captions=blockLabels(item,usable),labelHeight=captions.reduce((n,l)=>n+l.h,0);
    const tiles=[];
    for(const part of item.parts){
      let scale=Math.min(requested,usable/part.width);
      // A very wide foldout is printed in overlapping panels rather than tiny type.
      const tiled=scale<requested*.76 && !part.wholePage;
      if(tiled)scale=requested;
      if(part.wholePage){
        const available=bottom-top-labelHeight;
        scale=Math.min(scale,(available>=(bottom-top)*.52?available:bottom-top)/part.height);
      }
      const stripWidth=Math.min(part.width,usable/scale);
      for(let left=0;left<part.width-.01;){
        const width=Math.min(stripWidth,part.width-left);
        tiles.push({part,left,width,scale});
        if(left+width>=part.width-.01)break;
        left+=width-Math.min(8,width*.05);
      }
    }
    const totalHeight=labelHeight+tiles.reduce((n,t)=>n+t.part.height*t.scale+2,0);
    if(totalHeight<=bottom-top)space(wide,totalHeight);
    else space(wide,Math.min(bottom-top,labelHeight+Math.min(tiles[0]?.part.height*tiles[0]?.scale||0,100)));
    function labels(){
      captions.forEach(line=>{space(wide,line.h);draw(wide,{...line,width:usable,item:item.id})});
    }
    // Keep the source with its first crop when the complete first region fits a fresh slot.
    if(tiles.length&&labelHeight+tiles[0].part.height*tiles[0].scale<=bottom-top)space(wide,labelHeight+tiles[0].part.height*tiles[0].scale);
    labels();
    for(const tile of tiles){
      const {part,left,width,scale}=tile;
      let from=0;
      if(part.wholePage || part.height*scale<=bottom-top-labelHeight)space(wide,part.height*scale);
      while(from<part.height-.01){
        let room=(bottom-position(wide))/scale;
        if(room<Math.min(38/scale,part.height-from)){nextSlot(wide);continue}
        let end=Math.min(part.height,from+room);
        let overlap=0;
        if(end<part.height-.01){
          const boundary=(part.breaks||[]).filter(at=>at>from+room*.40 && at<=end).at(-1);
          if(boundary!==undefined)end=boundary;
          else overlap=Math.min(10,room*.07);
        }
        draw(wide,{kind:'crop',item:item.id,part,sourceX:left,sourceY:from,sourceW:width,sourceH:end-from,w:width*scale,h:(end-from)*scale,scale});
        if(end>=part.height-.01)break;
        from=end-overlap;nextSlot(wide);
      }
      advance(wide,2);
    }
    advance(wide,gap);
  }
  return {pages:pages.filter(p=>p.placements.length),margin,top,bottom,gutter,width:A4.width,height:A4.height};
}
