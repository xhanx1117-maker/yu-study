import test from 'node:test';
import assert from 'node:assert/strict';
import {initial,validate} from '../src/model.js';
import {trashPlan,removeSources} from '../src/material-trash.js';
test('emptying document trash preserves shared answers, unrelated attempts and books',()=>{
 const s=initial(),p={id:'p',year:'2024',exam:'지방직 9급',subject:'행정학',form:'가',count:20,hash:'1'.repeat(64)},k={...p,id:'k',type:'정답지',hash:'2'.repeat(64),deleted:true};
 const gone={...p,id:'gone',subject:'행정법',hash:'3'.repeat(64),deleted:true,size:99};
 s.documents=[p,k,gone];for(const d of [p,gone]){
   s.sessions.push({id:d.id,doc:d.id});const q={id:d.id+'#1',doc:d.id,number:1,regions:[],secondary:[],memo:'keep'};
   s.questions.push(q);s.events.push({id:d.id+'e',session:d.id,q:q.id,number:1});s.reviews.push({id:d.id+'r',q:q.id});
 }
 const before=structuredClone(s),plan=trashPlan(s,['p','k','gone']);assert.equal(plan.protectedCount,1);
 assert.equal(plan.bytes,99);assert.deepEqual(plan.rows.map(x=>[x.id,x.events,x.reviews]),[['gone',1,1]]);
 removeSources(s,plan.rows);assert.deepEqual(s.documents,[before.documents[0],before.documents[1]]);
 assert.deepEqual(s.questions,[before.questions[0]]);assert.equal(s.events[0].id,'pe');validate(s);
});
