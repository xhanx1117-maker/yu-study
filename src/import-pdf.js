import {change} from './db.js';

export function pdfPicker(){
  return '<label id="import" class="btn primary file-picker"><span>＋ PDF 가져오기</span><input id="pdf-files" type="file" accept="application/pdf,.pdf" multiple aria-label="PDF 가져오기"></label>';
}

export function importError(error){
  if(error.name==='QuotaExceededError'){
    return '기기 저장 공간이 부족해 등록하지 못했습니다. 파일 앱에서 여유 공간을 확보한 뒤 다시 시도하세요.';
  }
  if(['NotReadableError','NotFoundError','SecurityError'].includes(error.name)){
    return '선택한 파일을 읽지 못했습니다. 파일 앱에서 PDF를 먼저 열어 다운로드를 완료하거나 ‘나의 iPad’에 복사한 뒤 다시 선택하세요.';
  }
  if(error.name==='AbortError')return '파일 읽기를 취소했습니다. 다시 시도하거나 다른 파일을 선택하세요.';
  if(error.name==='UnknownError')return '브라우저 저장소에 PDF를 저장하지 못했습니다. 비공개 탐색 중이라면 Safari 일반 탭이나 홈 화면 앱에서 다시 열어 주세요. 일반 모드에서도 계속되면 앱을 종료 후 다시 실행하세요. 사이트 데이터는 삭제하지 마세요.';
  return error.message||'등록하지 못했습니다. 파일을 다시 선택해 주세요.';
}

function readFile(file,signal,onProgress){
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    const abort=()=>reader.abort();
    const cleanup=()=>signal.removeEventListener('abort',abort);
    reader.onload=()=>{cleanup();resolve(reader.result)};
    reader.onerror=()=>{cleanup();reject(reader.error||new DOMException('파일 읽기 실패','NotReadableError'))};
    reader.onabort=()=>{cleanup();reject(new DOMException('파일 읽기 취소','AbortError'))};
    reader.onprogress=e=>onProgress('파일 읽는 중',e.lengthComputable?Math.round(e.loaded*100/e.total):null);
    if(signal.aborted){reject(new DOMException('파일 읽기 취소','AbortError'));return}
    signal.addEventListener('abort',abort,{once:true});
    try{reader.readAsArrayBuffer(file)}catch(error){cleanup();reject(error)}
  });
}

export async function savePdf(file,metadata,{signal,onProgress}){
  if(!file.size)throw Error('선택한 파일이 비어 있습니다. 파일 앱에서 PDF 다운로드를 완료한 뒤 다시 선택하세요.');
  onProgress('저장 공간 확인 중');
  const estimate=await navigator.storage?.estimate?.().catch(()=>undefined);
  if(estimate?.quota&&estimate.quota-estimate.usage<file.size){
    throw new DOMException('저장 공간 부족','QuotaExceededError');
  }
  // Copy the provider-backed File into app-owned bytes before persisting it.
  // This also works when the native provider returns an empty MIME type.
  const buffer=await readFile(file,signal,onProgress);
  signal.throwIfAborted();
  const header=new TextDecoder().decode(new Uint8Array(buffer,0,Math.min(buffer.byteLength,1024)));
  if(!header.includes('%PDF-'))throw Error('PDF 형식을 확인할 수 없습니다. 파일 앱에서 정상적으로 열리는 PDF를 선택하세요.');
  onProgress('중복 파일 확인 중');
  const digest=await crypto.subtle.digest('SHA-256',buffer);
  const key=[...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
  signal.throwIfAborted();
  const id=crypto.randomUUID(),session=crypto.randomUUID(),created=new Date().toISOString();
  const blob=new Blob([buffer],{type:'application/pdf'});
  onProgress('기기에 저장 중');
  await change(archive=>{
    const duplicate=archive.documents.find(doc=>doc.hash===key);
    if(duplicate)throw Error(duplicate.deleted
      ?'이미 휴지통에 있는 PDF입니다. 자료실 → 휴지통에서 복구하세요.'
      :'이미 등록된 PDF입니다. 자료실에서 기존 자료를 열어 주세요.');
    archive.documents.push({...metadata,id,hash:key,filename:file.name,size:blob.size,session,created,favorite:false});
    archive.sessions.push({id:session,doc:id,date:created});
    if(metadata.exam&&!archive.examTypes.includes(metadata.exam))archive.examTypes.push(metadata.exam);
  },[[key,blob]]);
  return id;
}
