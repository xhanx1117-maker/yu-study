import test from 'node:test';
import assert from 'node:assert/strict';
import {planWorkbook, MM,A4,printSettings} from '../src/workbook-layout.js';

const block=(id,w=90*MM,h=60*MM,extras={})=>({id,labels:[{role:'source',text:id}],parts:[{width:w,height:h,breaks:[],...extras}]});
const crops=plan=>plan.pages.flatMap(page=>page.placements.filter(p=>p.kind==='crop'));

test('90 × 60 mm stays 90 × 60 mm; order flows down left then right',()=>{
  const items=Array.from({length:8},(_,i)=>block('Q'+i)),p=planWorkbook(items,{});
  const placements=crops(p);
  assert.equal(placements.length,8);assert.ok(p.pages.length<4);
  assert.deepEqual(placements.map(v=>v.item),items.map(x=>x.id));
  for(const v of placements){assert.equal(v.scale,1);assert.equal(v.h,60*MM);assert.equal(v.w,90*MM)}
  assert.equal(placements[0].x,p.margin);assert.ok(p.pages[0].placements.some(v=>v.x>A4.width/2));
});
test('one column, mixed-width flow and individual page mode never auto-enlarge',()=>{
  const items=[block('short',42,40),block('wide',510,70),block('narrow',60,40)];
  for(const mode of ['auto','one','two','individual']){
    const p=planWorkbook(items,{mode});assert.equal(p.pages.length,mode==='individual'?3:1);
    assert.ok(crops(p).every(c=>c.scale===1));
    assert.ok(crops(p).every(c=>c.x>=p.margin && c.x+c.w<=p.width-p.margin+.01 && c.y+c.h<=p.bottom+.01));
  }
});
test('moves whole questions, uses natural breaks for long stems and covers uninterrupted content',()=>{
  const p=planWorkbook([block('before',240,500),block('next',240,340),block('long',500,1880,{breaks:[520,715,1140,1435]})],{});
  const all=crops(p),long=all.filter(c=>c.item==='long');
  assert.ok(all[1].x>p.width/2);assert.ok(long.length>=3);assert.equal(long[0].sourceY,0);
  assert.equal(long.at(-1).sourceY+long.at(-1).sourceH,1880);
  for(let i=1;i<long.length;i++)assert.ok(long[i].sourceY<=long[i-1].sourceY+long[i-1].sourceH+.001);
  assert.ok(p.pages.every(page=>page.placements.length));
});
test('oversized drawings tile with overlap and saved settings are range checked',()=>{
  assert.equal(printSettings({scale:0,margin:200}).scale,100);
  const p=planWorkbook([block('map',1150,600)],{mode:'two'});
  const panels=crops(p);assert.ok(panels.length>=3);assert.ok(panels.every(c=>c.scale===1));
  assert.equal(panels[0].sourceX,0);assert.equal(panels.at(-1).sourceX+panels.at(-1).sourceW,1150);
});

test('a B4 text column is normalized once per sheet and flows in reading order',()=>{
  const source={pageWidth:728,pageHeight:1031,laneWidth:333};
  const items=Array.from({length:6},(_,i)=>block('B'+i, i%2?300:331,245,source));
  const plan=planWorkbook(items,{}),placed=crops(plan);
  const ratio=Math.min(A4.width/728,A4.height/1031);
  assert.equal(printSettings().mode,'two');
  assert.equal(plan.pages.length,1);
  assert.equal(placed.length,6);
  assert.deepEqual(placed.map(v=>v.item),items.map(v=>v.id));
  for(const v of placed)assert.ok(Math.abs(v.scale-ratio)<.001);
  assert.ok(placed[2].x<A4.width/2 && placed[3].x>A4.width/2);
  assert.deepEqual(plan.pages[0].dividers,[{start:plan.top,end:plan.bottom}]);
});
