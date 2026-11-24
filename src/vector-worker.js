// A disposable one-page copy is edited in the worker. The input PDF is read-only.
let api, memory, source=0, sourceBytes=0, sourceKey='';
function closeSource(){
  if(source)api.FPDF_CloseDocument(source);
  if(sourceBytes)memory.wasmExports.free(sourceBytes);
  source=sourceBytes=0;sourceKey='';
}
async function open(data){
  if(!api){
    const {init}=await import(/* @vite-ignore */ data.module);
    const response=await fetch(data.wasm);
    if(!response.ok)throw Error('PDF 벡터 모듈을 열지 못했습니다.');
    api=await init({wasmBinary:await response.arrayBuffer()});
    api.PDFiumExt_Init();memory=api.pdfium;
  }
  if(sourceKey===data.key)return;
  closeSource();
  const bytes=new Uint8Array(data.bytes);
  sourceBytes=memory.wasmExports.malloc(bytes.length);memory.HEAPU8.set(bytes,sourceBytes);
  source=api.FPDF_LoadMemDocument(sourceBytes,bytes.length,0);
  if(!source){closeSource();throw Error('벡터 원본을 열지 못했습니다.')}
  sourceKey=data.key;
}
function clip(pageNo,[left,bottom,right,top]){
  const doc=api.FPDF_CreateNewDocument(), ptr=memory.wasmExports.malloc(16);
  let page=0,writer=0,buffer=0;
  try{
    if(!api.FPDF_ImportPages(doc,source,String(pageNo),0))return null;
    page=api.FPDF_LoadPage(doc,0);
    if(!page || api.FPDFPage_GetAnnotCount(page)>0)return null;
    let kept=0;
    for(let i=api.FPDFPage_CountObjects(page)-1;i>=0;i--){
      const obj=api.FPDFPage_GetObject(page,i),type=api.FPDFPageObj_GetType(obj);
      // Images, nested forms, shadings and boundary-crossing objects are instead
      // painted into a physically cropped high-resolution tile. No hidden page form.
      if((type!==1&&type!==2)||!api.FPDFPageObj_GetBounds(obj,ptr,ptr+4,ptr+8,ptr+12))return null;
      const vals=new Float32Array(memory.HEAPU8.buffer,ptr,4),[l,b,r,t]=vals;
      if(![l,b,r,t].every(Number.isFinite))return null;
      if(r<=left||l>=right||t<=bottom||b>=top){
        if(!api.FPDFPage_RemoveObject(page,obj))return null;
        api.FPDFPageObj_Destroy(obj);
      }else if(l>=left&&r<=right&&b>=bottom&&t<=top)kept++;
      else return null;
    }
    if(!kept || !api.FPDFPage_GenerateContent(page))return null;
    writer=api.PDFiumExt_OpenFileWriter();
    if(!api.FPDF_SaveAsCopy(doc,writer,2))return null;
    const size=api.PDFiumExt_GetFileWriterSize(writer);
    if(size<=0)return null;
    buffer=memory.wasmExports.malloc(size);
    api.PDFiumExt_GetFileWriterData(writer,buffer,size);
    return memory.HEAPU8.slice(buffer,buffer+size).buffer;
  }finally{
    if(buffer)memory.wasmExports.free(buffer);
    if(writer)api.PDFiumExt_CloseFileWriter(writer);
    if(page)api.FPDF_ClosePage(page);
    api.FPDF_CloseDocument(doc);memory.wasmExports.free(ptr);
  }
}
self.onmessage=async({data})=>{
  try{
    if(data.type==='open'){await open(data);self.postMessage({ok:true});return}
    const bytes=clip(data.page,data.bounds);
    self.postMessage({ok:true,bytes},bytes?[bytes]:[]);
  }catch(error){self.postMessage({ok:false,message:error.message})}
};
