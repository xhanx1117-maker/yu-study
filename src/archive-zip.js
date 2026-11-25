// Read only the central directory and the current member. Offsets stay in the
// source Blob; even very large collections never become one giant ArrayBuffer.
const MiB=1024*1024, marker=0xffffffff, utf8=new TextEncoder();
const table=Uint32Array.from({length:256},(_,n)=>{
  for(let i=0;i<8;i++)n=(n>>>1)^((n&1)?0xedb88320:0);
  return n>>>0;
});
function updateCRC(crc,bytes){for(const byte of bytes)crc=table[(crc^byte)&255]^(crc>>>8);return crc}
export function crc32(bytes){return (updateCRC(-1,bytes)^-1)>>>0}
const view=bytes=>new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
const readBytes=async(blob,start,size)=>new Uint8Array(await blob.slice(start,start+size).arrayBuffer());
function bad(){throw Error('ZIP의 디렉터리 또는 파일 범위가 손상되었습니다.')}
function u64(v,offset){const n=Number(v.getBigUint64(offset,true));if(!Number.isSafeInteger(n))bad();return n}
function fields(bytes){
  const result=new Map(),v=view(bytes);let p=0;
  while(p+4<=bytes.length){const id=v.getUint16(p,true),n=v.getUint16(p+2,true);p+=4;if(p+n>bytes.length)bad();result.set(id,bytes.subarray(p,p+n));p+=n}
  return result;
}
function decodeName(raw,flags,extra){
  const path=extra.get(0x7075);
  if(path?.length>=5&&path[0]===1&&view(path).getUint32(1,true)===crc32(raw))return new TextDecoder().decode(path.subarray(5));
  try{return new TextDecoder('utf-8',{fatal:true}).decode(raw)}catch{
    if(flags&0x800)throw Error('ZIP 내부 UTF-8 파일명 오류');
    return new TextDecoder('euc-kr').decode(raw);
  }
}
export function safePath(value){
  const path=value.normalize('NFC').replace(/\\/g,'/');
  if(/^(?:\/|[a-z]:)|[\0-\x1f]/i.test(path)||path.split('/').includes('..'))return '';
  return path.split('/').filter(part=>part&&part!=='.').join('/');
}
export const ignoredPath=path=>path.split('/').some(part=>part.startsWith('.')||part==='__MACOSX');
export async function openZip(file){
  if(file.size<22)bad();
  const tail=await readBytes(file,Math.max(0,file.size-65557),65557),v=view(tail);
  let end=tail.length-22;
  while(end>=0 && (v.getUint32(end,true)!==0x06054b50||end+22+v.getUint16(end+20,true)!==tail.length))end--;
  if(end<0)bad();
  if(v.getUint16(end+4,true)||v.getUint16(end+6,true))throw Error('분할 ZIP을 하나의 ZIP으로 합친 후 선택하세요.');
  let count=v.getUint16(end+10,true),length=v.getUint32(end+12,true),offset=v.getUint32(end+16,true);
  if(count===65535||length===marker||offset===marker){
    const loc=view(await readBytes(file,file.size-tail.length+end-20,20));
    if(loc.getUint32(0,true)!==0x07064b50||loc.getUint32(16,true)!==1)bad();
    const wide=view(await readBytes(file,u64(loc,8),56));
    if(wide.getUint32(0,true)!==0x06064b50||wide.getUint32(16,true)||wide.getUint32(20,true))bad();
    count=u64(wide,32);length=u64(wide,40);offset=u64(wide,48);
  }
  if(count>100000||length>32*MiB||offset+length>file.size)throw Error('ZIP 목록이 너무 크거나 손상되었습니다. 여러 파일로 나누어 주세요.');
  const directory=await readBytes(file,offset,length),d=view(directory),entries=[];let index=0;
  for(let i=0;i<count;i++){
    if(index+46>length||d.getUint32(index,true)!==0x02014b50)bad();
    const b=index,flags=d.getUint16(b+8,true),method=d.getUint16(b+10,true),crc=d.getUint32(b+16,true);
    let compressed=d.getUint32(b+20,true),size=d.getUint32(b+24,true),local=d.getUint32(b+42,true);
    const names=d.getUint16(b+28,true),ext=d.getUint16(b+30,true),comment=d.getUint16(b+32,true);
    index+=46+names+ext+comment;if(index>length)bad();
    const raw=directory.subarray(b+46,b+46+names),extra=fields(directory.subarray(b+46+names,b+46+names+ext));
    if([compressed,size,local].includes(marker)){
      if(!extra.has(1))bad();const x=view(extra.get(1));let p=0;
      if(size===marker){size=u64(x,p);p+=8}if(compressed===marker){compressed=u64(x,p);p+=8}if(local===marker)local=u64(x,p);
    }
    const name=decodeName(raw,flags,extra),path=safePath(name);
    if(!path||name.endsWith('/')||ignoredPath(path))continue;
    const error=(flags&1)?'암호가 설정된 ZIP 항목입니다.':![0,8].includes(method)?'지원하지 않는 ZIP 압축 방식입니다.':
      (size>512*MiB||compressed>512*MiB||size>Math.max(8*MiB,compressed*500))?'파일 크기 또는 압축률 안전 한도를 초과했습니다.':'';
    async function blob(type='application/pdf'){
      if(error)throw Error(error);
      const head=view(await readBytes(file,local,30));
      if(head.byteLength!==30||head.getUint32(0,true)!==0x04034b50||head.getUint16(8,true)!==method||(head.getUint16(6,true)&1))bad();
      const start=local+30+head.getUint16(26,true)+head.getUint16(28,true);
      if(start+compressed>offset)bad();
      const source=file.slice(start,start+compressed,type);
      if(method===0&&compressed!==size)bad();
      let stream=source.stream();
      if(method===8){
        try{stream=stream.pipeThrough(new DecompressionStream('deflate-raw'))}
        catch{throw Error('이 브라우저는 ZIP 압축 해제를 지원하지 않습니다. Safari를 업데이트하거나 PDF를 선택하세요.')}
      }
      const reader=stream.getReader(),parts=[];let sum=-1,total=0;
      try{for(;;){const {done,value}=await reader.read();if(done)break;
        total+=value.length;if(total>size){await reader.cancel();bad()}
        sum=updateCRC(sum,value);if(method===8)parts.push(value);
      }}finally{reader.releaseLock()}
      if(total!==size||((sum^-1)>>>0)!==crc)throw Error('손상된 ZIP 항목입니다. 원본 CRC가 일치하지 않습니다.');
      return method===0?source:new Blob(parts,{type});
    }
    entries.push({path,size,crc,blob,error});
  }
  return entries;
}
// STORE keeps compressed PDF streams intact and lets the browser reference each
// immutable Blob in the final download. Only CRC chunks and directory headers use JS heap.
export async function makeZip(entries){
  const parts=[],directory=[],names=new Set();let offset=0,count=0;
  function header(size){const bytes=new Uint8Array(size);return [bytes,view(bytes)]}
  for await(const {path,blob} of entries){
    if(safePath(path)!==path||names.has(path))throw Error('ZIP 파일 이름이 중복되거나 잘못되었습니다.');
    names.add(path);const name=utf8.encode(path);
    if(name.length>65535||blob.size>=marker)throw Error('단일 ZIP 항목 크기 한도를 초과했습니다.');
    let sum=-1;
    const reader=blob.stream().getReader();
    try{for(;;){const {done,value}=await reader.read();if(done)break;sum=updateCRC(sum,value)}}finally{reader.releaseLock()}
    const crc=(sum^-1)>>>0,[lh,l]=header(30),wide=offset>=marker,[ch,c]=header(46+(wide?12:0)+name.length);
    l.setUint32(0,0x04034b50,true);l.setUint16(4,20,true);l.setUint16(6,0x800,true);
    l.setUint32(14,crc,true);l.setUint32(18,blob.size,true);l.setUint32(22,blob.size,true);l.setUint16(26,name.length,true);
    c.setUint32(0,0x02014b50,true);c.setUint16(4,45,true);c.setUint16(6,wide?45:20,true);c.setUint16(8,0x800,true);
    c.setUint32(16,crc,true);c.setUint32(20,blob.size,true);c.setUint32(24,blob.size,true);c.setUint16(28,name.length,true);c.setUint16(30,wide?12:0,true);c.setUint32(42,wide?marker:offset,true);ch.set(name,46);
    if(wide){const p=46+name.length;c.setUint16(p,1,true);c.setUint16(p+2,8,true);c.setBigUint64(p+4,BigInt(offset),true)}
    parts.push(lh,name,blob);directory.push(ch);offset+=lh.length+name.length+blob.size;count++;
  }
  const end=offset,length=directory.reduce((n,h)=>n+h.length,0);for(const item of directory)parts.push(item);
  if(end>=marker||length>=marker||count>=65535){
    const [z,v]=header(56),[locator,k]=header(20);v.setUint32(0,0x06064b50,true);v.setBigUint64(4,44n,true);
    v.setUint16(12,45,true);v.setUint16(14,45,true);v.setBigUint64(24,BigInt(count),true);v.setBigUint64(32,BigInt(count),true);
    v.setBigUint64(40,BigInt(length),true);v.setBigUint64(48,BigInt(end),true);k.setUint32(0,0x07064b50,true);k.setBigUint64(8,BigInt(end+length),true);k.setUint32(16,1,true);parts.push(z,locator);
  }
  const [e,v]=header(22);v.setUint32(0,0x06054b50,true);v.setUint16(8,Math.min(65535,count),true);v.setUint16(10,Math.min(65535,count),true);
  v.setUint32(12,Math.min(marker,length),true);v.setUint32(16,Math.min(marker,end),true);parts.push(e);
  return new Blob(parts,{type:'application/zip'});
}
