import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const root=path.resolve('dist');
const mime={'.html':'text/html','.js':'application/javascript','.mjs':'application/javascript','.css':'text/css','.wasm':'application/wasm'};
export function testServer({sourceModules=false}={}){
  return http.createServer((req,res)=>{
    const pathname=new URL(req.url,'http://localhost').pathname;
    if(sourceModules && pathname==='/yu-study/proof.html'){
      res.setHeader('Content-Type','text/html');res.end('<!DOCTYPE html><html lang="ko"><title>Print proof</title></html>');return;
    }
    if(sourceModules && /^\/proof-src\/[a-z-]+\.js$/.test(pathname)){
      const file=path.join(path.resolve('src'),path.basename(pathname));
      if(!fs.existsSync(file)){res.writeHead(404).end();return}
      res.setHeader('Content-Type','application/javascript');fs.createReadStream(file).pipe(res);return;
    }
    if(pathname==='/seed.html'){
      res.setHeader('Content-Type','text/html');
      res.end('<!doctype html><title>Isolated storage test</title>');
      return;
    }
    if(!pathname.startsWith('/yu-study/')){res.writeHead(404).end();return}
    const relative=decodeURIComponent(pathname.slice('/yu-study/'.length))||'index.html';
    const file=path.resolve(root,relative);
    if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.writeHead(404).end();return}
    res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  });
}
