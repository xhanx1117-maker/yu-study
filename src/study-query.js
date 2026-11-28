import {transaction} from './db.js';
import {initial} from './model.js';
import {chronological,validDay} from './study-events.js';
import {correctStudyRow} from './study-store.js';

export function queryStudy(from,to,subject=''){
  if(!validDay(from)||!validDay(to)||from>to)throw Error('학습 기간의 시작일과 종료일을 확인하세요.');
  return transaction(['studyLog'],'readonly',({studyLog},read,done)=>{
    const index=studyLog.index(subject?'subjectDay':'day');
    const range=subject?IDBKeyRange.bound([subject,from],[subject,to]):IDBKeyRange.bound(from,to);
    read(index.getAll(range),rows=>done(rows.sort(chronological)));
  });
}
export function correctStudy(row,date){
  return transaction(['meta','studyLog'],'readwrite',({meta,studyLog},read)=>{
    read(meta.get('archive'),s=>correctStudyRow(studyLog,read,row,date,s||initial(),meta));
  });
}
