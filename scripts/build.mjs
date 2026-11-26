import {mkdir,readFile,writeFile,cp,readdir,rm,access} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const dist=path.join(root,'dist');
export async function buildApp(portable=true){
  if(portable) await rm(dist,{recursive:true,force:true});
  await mkdir(dist,{recursive:true});
  const copy=(from,to)=>cp(from,path.join(dist,to),{recursive:true});
  for(const name of ['icon-192.png','icon-512.png','apple-touch-icon.png','manifest.webmanifest']) await copy(path.join(root,'public',name),name);
  if(portable){
    await copy(path.join(root,'src'),'src');
    await copy(path.join(root,'index.html'),'index.html');
  }
  const mods=process.env.YU_DEPENDENCIES||path.join(root,'node_modules');
  const fontDir=path.join(mods,'@fontsource/noto-sans-kr'),printDir=path.join(dist,'vendor/print-font');
  const hasFont=await access(path.join(fontDir,'400.css')).then(()=>true,()=>false);
  if(hasFont){
    // Ship the normal weight and only the WOFF2 slices referenced by its stylesheet.
    const css=(await readFile(path.join(fontDir,'400.css'),'utf8')).replace(/,\s*url\([^)]*\.woff['"]?\)\s*format\([^)]*\)/g,'');
    const files=new Set([...css.matchAll(/url\(['"]?\.\/files\/([^)'"]+\.woff2)['"]?\)/g)].map(match=>match[1]));
    if(!files.size)throw Error('Missing Korean print font slices');
    await mkdir(path.join(printDir,'files'),{recursive:true});
    await Promise.all([...files].map(name=>cp(path.join(fontDir,'files',name),path.join(printDir,'files',name))));
    await writeFile(path.join(printDir,'400.css'),css);await cp(path.join(fontDir,'LICENSE'),path.join(printDir,'LICENSE'));
  }else if(!portable||!process.env.YU_DEPENDENCIES)throw Error('Install the Korean print font before building.');
  const pdfium=path.join(mods,'@embedpdf/pdfium');
  const available=await access(path.join(pdfium,'dist/pdfium.wasm')).then(()=>true,()=>false);
  if(available){
    await copy(path.join(pdfium,'dist/index.browser.js'),'vendor/pdfium.js');
    await copy(path.join(pdfium,'dist/pdfium.wasm'),'vendor/pdfium.wasm');
    await copy(path.join(pdfium,'LICENSE'),'vendor/pdfium-wrapper-LICENSE.txt');
    await copy(path.join(root,'licenses/pdfium.txt'),'vendor/pdfium-LICENSE.txt');
  }else if(!portable || !process.env.YU_DEPENDENCIES)throw Error('Install @embedpdf/pdfium before building.');
  else console.log('Portable preview uses lossless crop rendering.');
  for(const name of ['pdf.min.mjs','pdf.worker.min.mjs']) await copy(path.join(mods,'pdfjs-dist/legacy/build',name),'vendor/'+name);
  for(const name of ['cmaps','standard_fonts','wasm']) await copy(path.join(mods,'pdfjs-dist',name),'vendor/'+name);


  await copy(path.join(mods,'pdfjs-dist/LICENSE'),'vendor/pdfjs-LICENSE.txt');
  async function list(dir){let out=[];for(const e of await readdir(dir,{withFileTypes:true})){const f=path.join(dir,e.name);out.push(...(e.isDirectory()?await list(f):[path.relative(dist,f).split(path.sep).join('/')]));}return out;}
  await copy(path.join(mods,'pdf-lib/dist/pdf-lib.min.js'),'vendor/pdf-lib.min.js');
  await copy(path.join(mods,'pdf-lib/LICENSE.md'),'vendor/pdf-lib-LICENSE.txt');
  const files=(await list(dist)).filter(x=>x!=='sw.js').sort();
  const hash=createHash('sha256').update('verified-shell-v3');
  for(const f of files)hash.update(f).update(await readFile(path.join(dist,f)));
  const build=hash.digest('hex').slice(0,16),cache='yu-study-shell-'+build;
  const indexPath=path.join(dist,'index.html'),html=await readFile(indexPath,'utf8');
  const marker='<meta name="yu-study-build" content="'+build+'">';
  await writeFile(indexPath,html.replace('</head>',marker+'</head>'));
  await writeFile(path.join(dist,'sw.js'),`const cache=${JSON.stringify(cache)}, files=${JSON.stringify(files)}.map(p=>new URL(p,self.registration.scope).href);
const assets=new Set(files),indexURL=new URL('index.html',self.registration.scope).href;
self.addEventListener('install',event=>event.waitUntil((async()=>{
  const shell=await fetch(indexURL,{cache:'reload'});
  if(!shell.ok||!(await shell.clone().text()).includes(${JSON.stringify(marker)}))throw Error('Index does not belong to this release');
  const store=await caches.open(cache);
  await store.addAll(files.filter(url=>url!==indexURL).map(url=>new Request(url,{cache:'reload'})));
  await store.put(indexURL,shell);
})()));
self.addEventListener('message',e=>{if(e.data?.type==='APPLY_UPDATE')e.waitUntil((async()=>{const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});if(windows.filter(c=>c.url.startsWith(self.registration.scope)).length>1){e.ports[0]?.postMessage({applied:false});return}await self.skipWaiting();e.ports[0]?.postMessage({applied:true})})())});
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(names=>Promise.all(names.filter(n=>n.startsWith('yu-study-shell-')&&n!==cache).map(n=>caches.delete(n)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{if(e.request.method!=='GET'||!e.request.url.startsWith(self.registration.scope))return;const url=e.request.mode==='navigate'?new URL('index.html',self.registration.scope).href:e.request.url;if(assets.has(url))e.respondWith(caches.open(cache).then(c=>c.match(url)).then(r=>r||fetch(e.request)));});`);
  console.log('Built',files.length,'static resources:',cache);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await buildApp();
