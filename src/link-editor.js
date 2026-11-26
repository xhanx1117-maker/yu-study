import {materialKind,answerLabel,coversSubject} from './materials.js';
import {bindSearch,searchKey} from './search.js';
import {esc,options} from './ui.js';

export function linkEditor(root,doc,docs){
  const kinds=[['정답지','answerIds'],['해설지','solutionIds']];
  const controls=[];
  for(const [kind,key] of kinds){
    const available=docs.filter(d=>!d.deleted&&d.id!==doc.id&&materialKind(d)===kind);
    available.sort((a,b)=>Number(coversSubject(b,doc.subject))-Number(coversSubject(a,doc.subject))||
      Number(b.year===doc.year)-Number(a.year===doc.year)||String(a.title).localeCompare(b.title,'ko'));
    const old=doc[key]??(key==='answerIds'&&doc.answerId?[doc.answerId]:null);
    const chosen=new Set(old||[]),section=document.createElement('div'),mode=old?(old.length?'직접 연결':'연결 안 함'):'자동 연결';
    section.innerHTML='<label>'+kind+' 연결<select class="link-mode">'+options(['자동 연결','직접 연결','연결 안 함'],mode)+'</select></label>'+
      '<div class="link-picks"><label>'+kind+' 찾기<input type="search"></label><div class="check-list"></div><button type="button" class="more-links">더 보기</button></div>';
    root.append(section);
    const select=section.querySelector('select'),box=section.querySelector('.link-picks'),list=section.querySelector('.check-list'),more=section.querySelector('.more-links');
    const needle=section.querySelector('[type=search]'),terms=available.map(d=>[d,searchKey([d.title,d.exam,d.year,d.form].filter(Boolean).join(' '))]);
    let query='',limit=32;
    function draw(){
      box.hidden=select.value!=='직접 연결';if(box.hidden)return;
      const items=terms.filter(([,text])=>text.includes(searchKey(query)));
      list.innerHTML=items.slice(0,limit).map(([d])=>'<label><input type="checkbox" data-link="'+esc(d.id)+'" '+(chosen.has(d.id)?'checked':'')+'> '+esc(d.title)+(kind==='정답지'?' · '+esc(answerLabel(d)):'')+'</label>').join('');
      more.hidden=items.length<=limit;
    }
    const search=bindSearch(needle,value=>{query=value;limit=32;draw()});
    select.onchange=draw;more.onclick=()=>{limit+=32;draw()};list.onchange=e=>{
      const id=e.target.dataset.link;if(e.target.checked)chosen.add(id);else chosen.delete(id);
    };
    draw();
    controls.push({save(d){
      if(select.value==='직접 연결'&&!chosen.size)throw Error(kind+'를 선택하거나 자동 연결을 선택하세요.');
      if(select.value==='자동 연결')delete d[key];else d[key]=select.value==='직접 연결'?[...chosen]:[];
      if(key==='answerIds')delete d.answerId;
    },dispose:()=>search.dispose()});
  }
  document.querySelector('#modal').addEventListener('close',()=>controls.forEach(c=>c.dispose()),{once:true});
  return d=>controls.forEach(c=>c.save(d));
}
