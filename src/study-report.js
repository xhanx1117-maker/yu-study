export const analysisPrompt='위 학습 기록을 날짜별로 관리하고 이전 기록과 비교하여 반복 오답, 취약 과목, 취약 테마 및 다음 복습 우선순위를 분석해 줘. 장기적인 학습 이력으로 활용할 수 있도록 정리해 줘.';
export function examName(r){
  const exam=r.exam||'',grade=r.grade&&(/^\d$/.test(r.grade)?r.grade+'급':r.grade);
  return [r.year,exam,grade&&!exam.includes(grade)?grade:'',r.rank,r.round,r.cohort&&(/기$/.test(r.cohort)?r.cohort:'제'+r.cohort+'기'),r.subject,r.form&&(/형$/.test(r.form)?r.form:r.form+'형')].filter(Boolean).join(' ')||r.title;
}
const keyTheme=t=>t.id;
export function metrics(rows){
  const unique=new Set(),papers=new Set(),clean=new Set(),finished=new Set(),themes=new Map();
  let total=0,fresh=0;
  for(const r of rows){
    if(r.kind==='solved'){
      finished.add(r.doc);if(r.wrongInSession===0)clean.add(r.doc);continue;
    }
    total++;if(r.count===1)fresh++;
    unique.add(r.q);papers.add(r.doc);
    for(const t of new Map([r.primary||r.current?.primary||{id:'',label:'미분류'},...(r.primary||!r.current?r.secondary:r.current.secondary)].map(t=>[keyTheme(t),t])).values()){
      const item=themes.get(t.id)||{id:t.id,label:t.label,count:0};item.count++;themes.set(t.id,item);
    }
  }
  return {unique:unique.size,occurrences:total,new:fresh,repeated:total-fresh,wrongPapers:papers.size,completedPapers:finished.size,
    cleanCompletedPapers:clean.size,themes:[...themes.values()].sort((a,b)=>b.count-a.count||a.label.localeCompare(b.label,'ko'))};
}
function grouped(rows,key){const index=new Map();for(const r of rows){const value=r[key];if(!index.has(value))index.set(value,[]);index.get(value).push(r)}return index}
export function studyReport(rows,{from,to,subject=''}){
  const days=[...grouped(rows,'day')].sort(([a],[b])=>a.localeCompare(b)).map(([day,rs])=>({
    day,subjects:[...grouped(rs,'subject')].sort(([a],[b])=>a.localeCompare(b,'ko')).map(([name,items])=>({
      name,summary:metrics(items),exams:[...grouped(items,'doc')].map(([doc,entries])=>({doc,title:entries[0].title,label:examName(entries[0]),entries}))
    }))
  }));
  return {schemaVersion:1,reportId:['yu-study',1,from,to,subject||'전체'].join('/'),timeZone:'Asia/Seoul',from,to,subject:subject||'전체',summary:metrics(rows),days};
}
const countLine=m=>'고유 오답 '+m.unique+'문항 · 발생 '+m.occurrences+'회 · 신규 '+m.new+'회 · 반복 '+m.repeated+'회';
export function reportText(report,markdown=false,prompt=false){
  const title=(n,s)=>markdown?'#'.repeat(n)+' '+s:s;
  const lines=[title(1,'Yu: study 일일 학습 기록'),'','학습 기간 '+report.from+(report.to===report.from?'':' ~ '+report.to)+' (한국 시간)'];
  if(!report.days.length)lines.push('선택한 기간에 저장된 학습 기록이 없습니다.');
  let hasLegacy=false;
  for(const day of report.days){
    lines.push('',title(2,day.day));
    for(const subject of day.subjects){
      lines.push('',title(3,'['+subject.name+']'));
      for(const exam of subject.exams){
        const list=exam.entries,questions=grouped(list.filter(r=>r.kind==='wrong'),'number');
        lines.push('',exam.label+(exam.title&&exam.title!==exam.label?' · '+exam.title:''));
        if(questions.size)lines.push('- 오답 문항 '+[...questions.keys()].sort((a,b)=>a-b).map(n=>n+'번').join(', '));
        for(const [num,events] of [...questions].sort(([a],[b])=>a-b)){
          for(const e of events){
            hasLegacy||=e.legacy;
            lines.push('- '+num+'번 · '+e.sessionNumber+'회차 · '+(e.count===1?'신규':'반복')+' · 누적 '+e.count+'회 · 주 테마 '+(e.primary?.label||'미분류')+
              (e.secondary.length?' · 보조 '+e.secondary.map(t=>t.label).join(', '):'')+(e.status?' · '+e.status:'')+(e.current?.primary&&e.current.primary.id!==e.primary?.id?' · 현재 주 테마 '+e.current.primary.label:'')+(e.current?.status&&e.current.status!==e.status?' · 현재 '+e.current.status:''));
          }
        }
        for(const e of list.filter(e=>e.kind==='solved'))lines.push('- '+e.sessionNumber+'회차 풀이 완료'+(e.wrongInSession===0?' · 기록된 오답 없음':''));
      }
      lines.push('',subject.name+' 소계 · '+countLine(subject.summary));
    }
  }
  const m=report.summary;
  lines.push('',title(2,'[전체 학습 기록]'),'- 오답 발생 시험지 '+m.wrongPapers+'개','- '+countLine(m),
    '- 풀이 완료 시험지 '+m.completedPapers+'개 · 오답 없는 완료 회차가 있는 시험지 '+m.cleanCompletedPapers+'개');
  if(m.themes.length)lines.push('- 테마별 발생(등록 후 분류 포함) '+m.themes.map(t=>t.label+' '+t.count+'회').join(', '));
  if(hasLegacy)lines.push('이전 버전에서 이관한 기록의 테마와 숙지 상태는 이관 시점에 저장된 분류입니다.');
  if(prompt)lines.push('',analysisPrompt);
  return lines.join('\n');
}
function csvCell(value){
  let s=String(value??'');if(/^[\s]*[=+@\-\t\r]/.test(s))s="'"+s;
  return '"'+s.replace(/"/g,'""')+'"';
}
export function reportCsv(report){
  const lines=[['기록 ID','한국 날짜','발생 시각(UTC)','유형','과목','시험지 ID','시험지명','시험 연도','시험','급수','계급','회차','기수','책형','문항 ID','원문 번호','학습 회차','풀이 ID','신규/반복','발생 당시 누적','주 테마','보조 테마','숙지 상태','완료 회차 오답 수','현재 주 테마','현재 보조 테마','현재 숙지 상태']];
  for(const d of report.days)for(const s of d.subjects)for(const exam of s.exams)for(const e of exam.entries)lines.push([
    e.id,e.day,e.time,e.kind==='solved'?'풀이 완료':'오답',e.subject,e.doc,e.title,e.year,e.exam,e.grade,e.rank,e.round,e.cohort,e.form,e.q,e.number,e.sessionNumber,e.session,
    e.kind==='wrong'?(e.count===1?'신규':'반복'):'',e.count,e.kind==='wrong'?(e.primary?.label||'미분류'):'',e.secondary?.map(t=>t.label).join(' / '),e.status,e.wrongInSession,e.current?.primary?.label,e.current?.secondary.map(t=>t.label).join(' / '),e.current?.status]);
  return '\uFEFF'+lines.map(row=>row.map(csvCell).join(',')).join('\r\n');
}
