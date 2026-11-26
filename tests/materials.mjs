import test from 'node:test';
import assert from 'node:assert/strict';
import {materialIndex,materialKind,setMaterialType,missingMaterials} from '../src/materials.js';
import {classifyExam} from '../src/exam-catalog.js';
import {applyEntry,packageManifest} from '../src/package-manifest.js';
const paper={id:'p',year:'2022',subject:'행정법',exam:'국가직 9급',round:'1',form:'가',count:20,countKnown:true};
test('same-form shared key, multiple solutions and explicit unlink survive metadata-only retyping',()=>{
  const admin={...paper,id:'admin',subject:'행정학'},key={...paper,id:'k',subject:'통합',combined:true,type:'정답지',authority:'공식',answerEdition:'최종'};
  const sol={...paper,id:'s',type:'문제·해설 혼합'},others=[{...sol,id:'s2'},{...key,id:'k2',answerEdition:'잠정'}];
  const all=[paper,admin,key,sol,...others],index=materialIndex(all);
  assert.deepEqual(index.groups.get('p').solutions.map(d=>d.id),['s','s2']);
  assert.equal(index.groups.get('p').answers[0].id,'k');assert.equal(index.parents.get('k').length,2);
  assert.equal(index.groupFor('k','admin').paper.id,'admin');assert.equal(index.groupFor('k').paper,null);
  for(const changes of [{form:'나'},{form:''},{round:'2'},{count:25},{grade:'7급'},{date:'2022-01-02'},{recruitmentYear:'2021'}]){
    assert.equal(materialIndex([paper,{...key,...changes}]).groups.get('p').answers.length,0);
  }
  const earlier={...paper,round:''},unspecified={...key,round:''};
  assert.deepEqual(materialIndex([earlier,unspecified,{...paper,id:'other-round'}]).groups.get('p').answers,[]);
  assert.deepEqual(materialIndex([{...paper,answerIds:[]},key]).groups.get('p').answers,[]);
  assert.equal(missingMaterials(index,'행정학')[0].필요자료,'해설지');
  const doc={...paper,hash:'original',detected:{1:{reviewed:true}},analysisState:'queued'};
  setMaterialType(doc,'해설지');assert.equal(materialKind(doc),'해설지');
  assert.equal(doc.id,'p');assert.equal(doc.hash,'original');assert.equal(doc.detected[1].reviewed,true);assert.equal(doc.analysisState,'off');
});
test('filename, folder and bounded body keep mixed papers out of the exam queue',()=>{
  assert.equal(materialKind(classifyExam('2026/행정학 문제 및 해설.pdf')),'해설지');
  assert.equal(materialKind(classifyExam('자료/해설지/기출.pdf')),'해설지');
  assert.equal(materialKind(classifyExam('자료/시험지.pdf',{sample:'1. 질문 [해설] 합성 예시'})),'해설지');
  assert.equal(classifyExam('시험지.pdf',{sample:'1. 질문',tailSample:'Answer: B. Explanation: example'}).type,'문제·해설 혼합');
  assert.equal(materialKind({type:'시험지'}),'문제지');
  assert.equal(materialKind(classifyExam('법.pdf',{sample:'1. 다음 중 정답을 고르시오.'})),'문제지');
});
test('verify manifest path, hash and observed role before metadata is applied',async()=>{
  const meta={files:[{path:'a.pdf',type:'solution',sha256:'x'},{path:'../b.pdf'},{path:'c.pdf'},{path:'c.pdf'}]};
  const {byPath,warnings}=await packageManifest([{path:'manifest.json',size:50,blob:()=>new Blob([JSON.stringify(meta)])},{path:'a.pdf'},{path:'c.pdf'}]);
  assert.ok(warnings.length);assert.ok(byPath.get('c.pdf').issue);
  const info=()=>classifyExam('2026/국가직9급/행정학.pdf');
  assert.equal(applyEntry(info(),byPath.get('a.pdf'),'x').type,'해설지');
  assert.ok(applyEntry(info(),byPath.get('a.pdf'),'z').reviewReasons.includes('manifest 해시 불일치'));
  assert.equal(applyEntry(classifyExam('정답지.pdf'),byPath.get('a.pdf'),'x').type,'정답지');
});
