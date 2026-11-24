import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {initial,record} from '../src/model.js';

const require=createRequire(import.meta.url);
const {PDFDocument,StandardFonts,rgb,degrees}=require('pdf-lib');
const mm=72/25.4, W=210*mm,H=297*mm;
const box=(page,x,y,w,h,width=W,height=H)=>({page,x:x/width,y:y/height,w:w/width,h:h/height});
const titles=['Public records','Review dates','A fictional timetable','Study sessions',
  'A practice diagram','Ordering records','Choosing a category','Neighbor outside selection'];
const options=['A. Read the first record.','B. Compare the two dates.','C. Check the final entry.','D. Mark the matching item.'];
function structure(s,doc,regions,numbers,theme){
  s.documents.push(doc);s.sessions.push({id:doc.session,doc:doc.id,date:'2025-04-01'});
  doc.detected={};doc.scanned=true;
  for(const [n,areas] of Object.entries(regions))doc.detected[n]={regions:areas,reviewed:true,text:doc.title+' '+n};
  record(s,doc,doc.session,numbers);
  for(const q of s.questions.filter(q=>q.doc===doc.id))Object.assign(q,doc.detected[q.number],{theme,secondary:[]});
  for(const e of s.events.filter(e=>e.session===doc.session))e.date='2025-04-01';
}
export async function fixture(koreanPng){
  const s=initial(),files=[];
  s.books=[{id:'law-book',title:'가상 법 교재',subject:'행정법',themes:[
    {id:'case',number:'29',title:'가상 사례',page:91},{id:'example',number:'30',title:'연습 분류',page:96}]},
    {id:'admin-book',title:'가상 행정 교재',subject:'행정학',parts:[{id:'part',title:'PART A',chapters:[
      {id:'chapter',title:'CHAPTER A',themes:[{id:'public',number:'003',title:'가상 행정 항목'}]}]}]}];
  function addFile(bytes){
    const data=Buffer.from(bytes),hash=createHash('sha256').update(data).digest('hex');
    files.push({hash,bytes:[...data]});return hash;
  }
  function meta(id,title,subject,year,hash,count){return {id,title,subject,year,hash,count,type:'시험지',exam:'가상 시험',page:1,filename:id+'.pdf',session:id+'-session'}}
  const exam=await PDFDocument.create(),p=exam.addPage([W,H]),font=await exam.embedFont(StandardFonts.Helvetica);
  const text=(str,x,top,size=10)=>p.drawText(str,{x,y:H-top-size,size,font,color:rgb(.1,.14,.13)});
  const rect=(x,top,w,h,color)=>p.drawRectangle({x,y:H-top-h,width:w,height:h,color});
  const line=(x,y,x2,y2)=>p.drawLine({start:{x,y:H-y},end:{x:x2,y:H-y2},thickness:.7,color:rgb(.19,.31,.25)});
  text('Practice examination',29,22,16);text('EXCLUDED-HEADER',365,28,9);
  rect(350,42,91,3,rgb(.94,0,.60));line(29,52,W-30,52);line(W/2,66,W/2,765);
  const regions={},heights=[60*mm,143,159,124,60*mm,140,152,130],offsets=[72,263,428,609,72,263,428,609];
  for(let i=0;i<8;i++){
    const n=i+1,x=i<4?30:310,y=offsets[i],height=heights[i];
    regions[n]=[box(1,x,y,90*mm,height)];
    text('Q'+String(n).padStart(2,'0')+'   '+titles[i],x+4,y+3,10);
    rect(x+4,y+19,63+n*2,3,rgb(.05,.45,.85));
    text('Which choice is supported by the sample?',x+4,y+27);
    options.forEach((t,j)=>text(t,x+9,y+44+14*j));
    if(n===3){
      const top=y+104;
      for(const k of [0,13,26])line(x+10,top+k,x+156,top+k);
      for(const k of [10,72,156])line(x+k,top,x+k,top+26);
      text('Day',x+14,top+1,8);text('Entries',x+78,top+1,8);
      text('Mon',x+14,top+14,8);text('3',x+78,top+14,8);
    }
    if(n===5){
      p.drawCircle({x:x+32,y:H-y-122,size:12,borderWidth:1.2,borderColor:rgb(.13,.38,.25),color:rgb(.86,.92,.88)});
      line(x+45,y+122,x+76,y+122);rect(x+76,y+114,41,16,rgb(.25,.48,.36));
    }
  }
  text('EXCLUDED-FOOTER',29,797,9);
  const bytes=await exam.save(),law=meta('law','연습 A','행정법','2025',addFile(bytes),8);
  structure(s,law,regions,[1,2,3,4,5,6,7],'case');
  s.questions.find(q=>q.id==='law#1').secondary=['example'];
  const repeat='law-repeat';s.sessions.push({id:repeat,doc:law.id,date:'2025-05-05'});
  record(s,law,repeat,[1]);s.events.find(e=>e.session===repeat).date='2025-05-05';
  const other=await PDFDocument.create(),otherPage=other.addPage([W,H]);
  otherPage.drawText('Q09 Different exam year',{x:40,y:H-120,size:10});
  structure(s,meta('older','연습 B','행정법','2023',addFile(await other.save()),1),{1:[box(1,36,90,90*mm,92)]},[1],'case');
  // Bitmap Korean passage and table, a second source page, and a changed page size.
  const reading=await PDFDocument.create(),first=reading.addPage([W,H]),next=reading.addPage([450,630]);
  const image=await reading.embedPng(koreanPng);
  first.drawImage(image,{x:35,y:H-205,width:515,height:120});
  first.drawText('Reading item one',{x:40,y:H-299,size:10});
  first.drawText('Reading item two',{x:40,y:H-429,size:10});
  next.drawText('Continuation of item one',{x:40,y:530,size:10});
  const shared={...box(1,30,80,530,140),shared:true};
  structure(s,meta('korean','가상 독해','국어','2024',addFile(await reading.save()),2),
    {1:[shared,box(1,30,260,530,110),box(2,30,65,380,85,450,630)],2:[shared,box(1,30,390,530,110)]},[1,2],null);
  s.questions.find(q=>q.id==='korean#1').solution={text:'연습 정답 ②',doc:null,page:null};
  const rotated=await PDFDocument.create(),r=rotated.addPage([400,600]);
  r.drawText('ROTATED MARKER',{x:80,y:170,size:10});
  r.drawRectangle({x:80,y:180,width:48,height:4,color:rgb(.05,.45,.85)});
  r.setRotation(degrees(90));
  // For Rotate 90 the scale-1 viewport maps original (x,y) to (y,x).
  structure(s,meta('english','회전 연습','영어','2024',addFile(await rotated.save()),1),{1:[box(1,145,65,105,155,600,400)]},[1],null);
  const admin=await PDFDocument.create(),a=admin.addPage([W,H]);
  a.drawText('Administrative practice',{x:37,y:721,size:10});
  structure(s,meta('admin','행정 연습','행정학','2025',addFile(await admin.save()),2),
    {1:[box(1,30,80,250,120)],2:[box(1,30,250,250,120)]},[1],'public');
  return {archive:s,files,source:Buffer.from(bytes)};
}
