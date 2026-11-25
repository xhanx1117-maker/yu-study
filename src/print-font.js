export const printFont='"Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
let stylesheet;
export async function loadPrintFont(text){
  if(!document.fonts)return;
  stylesheet??=new Promise(resolve=>{
    const link=document.createElement('link');
    link.rel='stylesheet';link.href=new URL('vendor/print-font/400.css',document.baseURI).href;
    link.onload=()=>resolve(true);link.onerror=()=>{stylesheet=null;resolve(false)};
    document.head.append(link);
  });
  if(await stylesheet){
    const glyphs=[...new Set(text)].join('');
    await document.fonts.load('12px "Noto Sans KR"',glyphs);
  }
}
