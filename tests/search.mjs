import test from 'node:test';
import assert from 'node:assert/strict';
import {bindSearch,searchKey} from '../src/search.js';

function field(t){
  t.mock.timers.enable({apis:['setTimeout']});
  const input=Object.assign(new EventTarget(),{value:'',isConnected:true}),applied=[];
  const binding=bindSearch(input,term=>applied.push(term));
  function fire(type,value,marked=false){
    input.value=value;
    const event=new Event(type);Object.defineProperty(event,'isComposing',{value:marked});
    input.dispatchEvent(event);
  }
  return {input,applied,binding,fire,tick:ms=>t.mock.timers.tick(ms)};
}
test('IME cancels pending searches and waits 250 ms after a confirmed final value',t=>{
  const {input,applied,fire,tick}=field(t);
  fire('input','A');tick(150);fire('compositionstart','A');
  fire('compositionupdate','Aㅎ');fire('input','Aㅎ',true);tick(500);
  fire('compositionupdate','A하');fire('input','A하',false);tick(500);
  assert.deepEqual(applied,[]);
  fire('compositionend','A한');fire('input','A한');tick(249);
  assert.deepEqual(applied,[]);tick(1);
  assert.deepEqual(applied,['A한']);assert.equal(input.value,'A한');
  fire('input','A한');fire('search','A한');tick(400);assert.equal(applied.length,1);
});
test('compositionend before the final DOM value and an isComposing-only input',t=>{
  const {applied,fire,tick}=field(t);
  fire('input','old');tick(200);fire('input','ㄱ',true);tick(600);
  assert.deepEqual(applied,[]);
  fire('compositionend','ㄱ');fire('input','글',true);tick(250);
  assert.deepEqual(applied,['글']);
  fire('compositionstart','글');fire('compositionupdate','글ㅁ');
  fire('compositionend','글');tick(250);assert.deepEqual(applied,['글']);
});
test('typing, native clear, resetting and leaving a view never replay an obsolete search',t=>{
  const {input,applied,fire,tick,binding}=field(t);
  fire('input','a');tick(130);fire('input','ab');tick(130);fire('input','abc');tick(250);
  assert.deepEqual(applied,['abc']);
  fire('search','');tick(250);assert.deepEqual(applied,['abc','']);
  fire('input','draft');binding.reset('새 값');tick(400);
  assert.equal(input.value,'새 값');assert.equal(applied.length,2);
  fire('input','other');binding.dispose();fire('input','later');tick(500);assert.equal(applied.length,2);
  assert.equal(searchKey('한글 Atlas'.normalize('NFD')), '한글 atlas');
});
