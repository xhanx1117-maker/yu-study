import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {PDFDocument,StandardFonts,pushGraphicsState,popGraphicsState,concatTransformationMatrix,drawObject}=require('pdf-lib');
export async function fixturePaper(count=20,illustrated=false){
  const file=await PDFDocument.create(),font=await file.embedFont(StandardFonts.Helvetica);
  let illustration;
  if(illustrated){
    const gray=new Uint8Array(480*512);let random=31;
    for(let i=0;i<gray.length;i++){random=(Math.imul(random,1664525)+1013904223)>>>0;gray[i]=random>>>24}
    illustration=file.context.register(file.context.flateStream(gray,{Type:'XObject',Subtype:'Image',Width:480,Height:512,ColorSpace:'DeviceGray',BitsPerComponent:8}));
  }
  for(let first=1;first<=count;first+=6){
    const page=file.addPage([728,1031]);page.drawText('Fictional civil service examination',{x:20,y:1003,font,size:11});
    for(let n=first;n<first+6&&n<=count;n++){
      const i=n-first,x=i<3?25:378,y=950-(i%3)*270;
      page.drawText(n+'. Select the correct explanation.',{x,y,font,size:12});
      for(let a=0;a<4;a++)page.drawText('('+String.fromCharCode(65+a)+') Fictional choice '+(a+1)+' for question '+n,{x:x+10,y:y-35-a*28,font,size:11});
    }
    if(illustration){const key=page.node.newXObject('Diagram',illustration);page.pushOperators(pushGraphicsState(),concatTransformationMatrix(80,0,0,62,130,272),drawObject(key),popGraphicsState())}
  }
  return Buffer.from(await file.save());
}
