import test from 'node:test';
import assert from 'node:assert/strict';
import {pageFrame,tightBand,beforeLine} from '../src/exam-regions.js';
import {regionRecord,regionStamp,applyRegionChanges} from '../src/region-records.js';

test('a page frame is excluded while a case box and last line below 96.5% survive',()=>{
  const width=400,height=600,ink=new Uint8Array(width*height);
  const mark=(x,y,w,h)=>{for(let i=y;i<y+h;i++)ink.fill(1,i*width+x,i*width+x+w)};
  mark(15,24,370,1);mark(15,592,370,1);mark(192,25,2,567);
  mark(21,45,150,4);mark(22,60,143,1);mark(22,85,143,1);mark(22,60,1,26);mark(164,60,1,26);
  mark(24,580,155,5);mark(205,40,155,4);
  const image={ink,width,height},frame=pageFrame(image,true,.07);
  assert.deepEqual(frame,{top:25,bottom:592,lanes:[[0,192],[194,400]]});
  const crop=tightBand(image,frame,0,frame.top,frame.bottom,1);
  assert.ok(crop.x>=.04 && (crop.x+crop.w)*width<192);
  assert.ok(crop.y*height<45 && (crop.y+crop.h)*height>584);
  assert.ok(beforeLine(image,frame,1,{y:40/height,h:6/height,base:45/height})<40);
  assert.equal(tightBand(image,frame,1,100,300,1),null);
});
test('region proposals preserve study data, confirmed legacy crops and concurrent edits',()=>{
  const old=[{page:1,x:.1,y:.1,w:.3,h:.2}],q={id:'q',number:1,doc:'d',regions:old,reviewed:false,memo:'memo',theme:'theme'};
  const d={id:'d',hash:'hash',detected:{}},s={documents:[d],questions:[q],reviews:[{q:'q'}],events:[{q:'q'}]};
  const next={regions:[{...old[0],h:.3}],text:'complete'};
  const proposal={docId:'d',id:'q',hash:'hash',stamp:regionStamp(regionRecord(d,q)),next};
  applyRegionChanges(s,[proposal]);
  assert.deepEqual(q.regions,next.regions);assert.deepEqual(d.detected[1].regions,next.regions);
  assert.equal(q.memo,'memo');assert.equal(q.theme,'theme');assert.equal(s.events.length,1);assert.equal(s.reviews.length,1);
  assert.throws(()=>applyRegionChanges(s,[proposal]));
  q.reviewed=true;d.detected[1].reviewed=false;
  assert.throws(()=>applyRegionChanges(s,[{...proposal,stamp:regionStamp(q)}]));
  delete q.reviewed;
  assert.throws(()=>applyRegionChanges(s,[{...proposal,stamp:regionStamp(q)}]));
});
