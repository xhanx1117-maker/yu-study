import {$,esc,action,on,modal,notice,pick} from './ui.js';
import {classify} from './model.js';
import {change} from './db.js';
import {download} from './backup.js';
let undo=[];
export function analysisControls(){
  return '<details class="analysis-tools"><summary>분석 및 일괄 분류</summary><div class="row">'+action('export','분석 자료 내보내기')+action('prompt','GPT 분류 요청')+action('result','분류 결과 가져오기')+(undo.length?action('revert','분류 실행 취소'):'')+'</div></details>';
}
export function bindAnalysis(s,list,ts,count,show){
 function output(title,value){modal('<h2>'+title+'</h2><textarea id="out"></textarea><div class="row">'+action('copy','복사')+action('dl','파일 저장')+'</div>');$('#out').value=value;on('copy',async()=>{try{await navigator.clipboard.writeText(value);notice('복사했습니다.')}catch{$('#out').select();notice('선택한 내용을 복사하세요.')}});on('dl',()=>download(new Blob([value],{type:'text/plain;charset=utf-8'}),'Yu-study.txt'))}
 function exportRows(){const docs=new Map(s.documents.map(d=>[d.id,d]));return list.map(q=>{const d=docs.get(q.doc);return {questionId:q.id,subject:d.subject,year:d.year,exam:d.exam,number:q.number,primaryThemeId:q.theme,count:count.get(q.id),status:q.status}})}
 on('export',()=>output('분석 자료','오답 빈도와 반복 횟수를 바탕으로 복습 순서를 제안해 주세요.\n'+JSON.stringify(exportRows(),null,2)));
 on('prompt',()=>output('GPT 분류 요청','다음 문항을 같은 과목의 목차 ID로 분류하세요. 불확실하면 primaryThemeId를 null로 두세요. JSON 형식 '+JSON.stringify({version:1,results:[{questionId:'문항 ID',primaryThemeId:null,secondaryThemeIds:[],confidence:0,reason:'근거',needsReview:true}]})+'\n'+JSON.stringify({themes:ts.filter(t=>t.enabled),questions:exportRows().map((r,i)=>({...r,text:list[i].text||''}))})));
 on('result',()=>{modal('<h2>GPT 분류 결과</h2><label>결과 JSON<textarea id="json"></textarea></label>'+action('read','파일 선택')+action('preview','미리보기'));on('read',async()=>{const [f]=await pick('.json');if(f)$('#json').value=await f.text()});on('preview',()=>{const data=JSON.parse($('#json').value),rs=classify(s,data);modal('<h2>분류 미리보기</h2>'+rs.map((r,i)=>'<label><span><input type="checkbox" data-i="'+i+'" '+(r.needsReview?'':'checked')+'> '+esc(r.questionId+' → '+(r.primaryThemeId||'미분류')+' · '+r.reason)+'</span></label>').join('')+action('approve','선택 항목 적용'));on('approve',async()=>{const chosen=[...document.querySelectorAll('[data-i]:checked')].map(x=>rs[x.dataset.i]);let previous=[];await change(v=>{classify(v,{version:1,results:chosen});for(const r of chosen){const q=v.questions.find(x=>x.id===r.questionId);previous.push({id:q.id,theme:q.theme,secondary:q.secondary});q.theme=r.primaryThemeId;q.secondary=r.secondaryThemeIds}});undo=previous;$('#modal').close();await show()})})});
 on('revert',async()=>{await change(v=>{for(const r of undo){const q=v.questions.find(x=>x.id===r.id);if(q)Object.assign(q,r)}});undo=[];await show()})
}
