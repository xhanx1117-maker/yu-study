export function vectorCrops(signal){
  let worker,key,disabled=false,pending;
  function close(){
    worker?.terminate();worker=undefined;
    if(pending){pending.reject(new DOMException('출력 취소','AbortError'));pending=null}
    signal.removeEventListener('abort',close);
  }
  signal.addEventListener('abort',close,{once:true});
  function send(data,transfer=[]){
    return new Promise((resolve,reject)=>{pending={resolve,reject};worker.postMessage(data,transfer)});
  }
  return {close,async clip(hash,blob,page,bounds){
    signal.throwIfAborted();
    if(disabled)return null;
    try{
      if(!worker){
        worker=new Worker(new URL('./vector-worker.js',import.meta.url),{type:'module'});
        worker.onmessage=({data})=>{const current=pending;pending=null;if(data.ok)current?.resolve(data);else current?.reject(Error(data.message))};
        worker.onerror=e=>{pending?.reject(Error(e.message));pending=null};
      }
      if(key!==hash){
        const bytes=await blob.arrayBuffer();signal.throwIfAborted();
        const base=new URL('vendor/',document.baseURI);
        await send({type:'open',key:hash,bytes,module:new URL('pdfium.js',base).href,wasm:new URL('pdfium.wasm',base).href},[bytes]);key=hash;
      }
      return (await send({type:'crop',page,bounds})).bytes;
    }catch(error){
      signal.throwIfAborted();
      disabled=true;close();return null;
    }
  }};
}
