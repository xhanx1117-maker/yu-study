import {state,get,change,hash} from './db.js';
import {validate} from './model.js';
import {reconcilePurged} from './notebook-model.js';
let loaded;
async function zip(){if(!loaded)loaded=new Promise((res,rej)=>{const s=document.createElement('script');s.src=new URL('vendor/jszip.min.js',document.baseURI);s.onload=()=>res(window.JSZip);s.onerror=()=>{loaded=null;rej(Error('백업 모듈을 불러오지 못했습니다.'))};document.head.append(s)});return loaded}
export function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000)}
export async function backup(){const Zip=await zip(),z=new Zip(),s=await state(),created=new Date().toISOString(),meta=new Blob([JSON.stringify(s)]),keys=[...new Set(s.documents.map(d=>d.hash))];
 z.file('archive.json',await meta.arrayBuffer());z.file('manifest.json',JSON.stringify({format:'yu-study',version:1,created,files:keys,metadataHash:await hash(meta)}));for(const k of keys){const b=await get('files',k);if(!b||await hash(b)!==k)throw Error('원본 PDF 무결성 오류');z.file('files/'+k,await b.arrayBuffer())}
 download(await z.generateAsync({type:'blob'}),'Yu-study-backup-'+created.slice(0,10)+'.zip');await change(current=>{current.lastBackup=created})}
export async function restore(file){const Zip=await zip(),z=await Zip.loadAsync(file,{checkCRC32:true});const read=async name=>{if(!z.file(name))throw Error('백업 파일 누락');return z.file(name).async('blob')};
 const m=JSON.parse(await (await read('manifest.json')).text()),meta=await read('archive.json');if(m.format!=='yu-study'||m.version!==1||await hash(meta)!==m.metadataHash)throw Error('백업 형식 또는 체크섬 오류');const s=validate(JSON.parse(await meta.text())),keys=[...new Set(s.documents.map(d=>d.hash))];if(!Array.isArray(m.files)||m.files.length!==keys.length||keys.some(k=>!m.files.includes(k)))throw Error('파일 목록 불일치');
 const files=[];for(const k of keys){const blob=await read('files/'+k);if(await hash(blob)!==k)throw Error('손상된 PDF');files.push([k,new Blob([blob],{type:'application/pdf'})])}
 if(!confirm('PDF '+s.documents.length+'건과 오답 이력 '+s.events.length+'건으로 현재 자료를 교체할까요? 현재 자료는 먼저 백업해 두세요.'))return false;
 await change(current=>reconcilePurged(s,current.purgedAttempts),files,true);return true}
