export const compact=value=>String(value??'').normalize('NFKC').replace(/[\s\p{P}\p{S}]+/gu,'').toUpperCase();
export const subjectName=value=>({행정법총론:'행정법',행정학개론:'행정학'}[compact(value)]||compact(value));
export const cadetPatterns=[['경찰간부',/경찰간부|경위(?:공개경쟁|공채)/],['소방간부',/소방간부/],['법원행정고등고시',/법원행정(?:고등)?고시/],['입법고시',/입법고시/]];
export function family(value){
  const text=compact(value);
  return cadetPatterns.find(([,re])=>re.test(text))?.[0]||text.replace(/[1-9]급/g,'').replace(/^국가$/,'국가직').replace(/^지방$/,'지방직');
}
export const gradeOf=value=>compact(value).match(/[1-9]급/)?.[0]||'';
export function booklet(value){
  const s=compact(value).replace(/^(?:책형|책자형별|형별)/,'').replace(/(?:책형|형|책)$/,'');
  return /^[가나다라마바사아자차카타파하A-Z0-9]{1,2}$/.test(s)?s:'';
}
export function sitting(text){
  const raw=String(text??'').normalize('NFKC'),s=compact(raw);
  const slot=raw.match(/(?:^|[\s_(/-])(추가|(?:제\s*)?\d{1,2}차|(?:1[0-2]|[1-9])월)(?=$|[\s_)./-])/);
  return {cohort:s.match(/(?:제)?(\d{1,3})기(?:[^출]|$)/)?.[1]||'',
    schedule:s.match(/추가(?:채용|시험|모집)|추가공채|재시험|상반기|하반기|(?:1[0-2]|[1-9])월(?:시행|시험|공채)/)?.[0]?.replace(/^추가.*/,'추가')||compact(slot?.[1]).replace(/^제/,'')||(/정규/.test(s)?'정규':''),
    recruitmentYear:s.match(/((?:19|20)\d{2})년(?:도)?(?:선발|채용)/)?.[1]||''};
}
export function identity(d){
  const name=[d.filename,d.title,d.sitting].filter(Boolean).join(' '),info=sitting(name);
  let exam=family(d.exam);
  const specific=cadetPatterns.find(([,re])=>re.test(compact(name)))?.[0];
  if(!d.classificationLocked&&specific&&(!exam||specific.startsWith(exam)||exam==='법원직'&&specific.startsWith('법원')))exam=specific;
  return {exam,subject:subjectName(d.subject),year:String(d.year||''),grade:gradeOf(d.grade||d.exam),cohort:String(d.cohort||info.cohort),
    schedule:d.schedule||info.schedule||'',round:compact(d.round).replace(/^(?:제)?(\d+)회(?:차)?$/,'$1'),
    recruitmentYear:String(d.recruitmentYear||info.recruitmentYear),date:String(d.date||''),agency:compact(d.agency),rank:exam==='경찰간부'&&compact(d.rank)==='경위'?'':compact(d.rank),
    forms:[...new Set([d.form,...(Array.isArray(d.forms)?d.forms:[])].map(booklet).filter(Boolean))]};
}
export const timeKeys=i=>[...new Set([i.year&&'y'+i.year,i.cohort&&'c'+i.cohort,i.recruitmentYear&&'y'+i.recruitmentYear].filter(Boolean))];
export function conflict(a,b){
  for(const [field,label] of [['exam','시험'],['grade','급수'],['cohort','기수'],['round','회차'],['date','시행일'],['rank','계급'],['agency','기관'],['recruitmentYear','선발연도'],['schedule','채용 구분']]){
    if(a[field]&&b[field]&&a[field]!==b[field])return label+' 불일치';
  }
  if(a.year&&b.year&&a.year!==b.year&&!(a.cohort&&a.cohort===b.cohort&&Math.abs(+a.year-+b.year)<=1))return '연도 불일치';
  if(a.forms.length&&b.forms.length&&!a.forms.some(v=>b.forms.includes(v)))return '책형 불일치';
  return '';
}
