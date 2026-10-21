// SPDX-License-Identifier: AGPL-3.0-or-later
import http from 'node:http';
import {createReadStream,createWriteStream} from 'node:fs';
import {mkdir,readFile,stat,unlink} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {OriginalHost} from './native.mjs';
const here=path.dirname(fileURLToPath(import.meta.url));
const repo=path.resolve(here,'../..');
const data=path.resolve(process.env.CONCAT_WEB_DATA||path.join(repo,'web','original-data'));
await mkdir(path.join(data,'imports'),{recursive:true});
const host=new OriginalHost(process.env.CONCAT_WEB_BINARY||path.join(repo,'vendor','browser-host','concat'));
const schema=JSON.parse(await readFile(path.join(repo,'web/bridge/schema.json'),'utf8'));
const callbacks=new Set(Object.entries(schema).flatMap(([global,s])=>s.callbacks.filter(c=>!c.pure).map(c=>global+'.'+c.name)));
const clients=new Map(),downloads=new Map();
const json=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
async function body(req){let value='';for await(const chunk of req){value+=chunk;if(value.length>1024*1024)throw new Error('Request too large');}return JSON.parse(value||'{}');}
async function serve(req,res,file,type,download){
  const info=await stat(file);if(!info.isFile())throw new Error('File not found');
  res.writeHead(200,{'Content-Type':type,'Content-Length':info.size,...(download?{'Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(path.basename(file))}`}:{})});
  await pipeline(createReadStream(file),res);
}
const server=http.createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Cache-Control','no-store');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
  try{
    const authority=req.headers.host||'';
    if(!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(authority)||req.headers['sec-fetch-site']==='cross-site'||(req.headers.origin&&req.headers.origin!==`http://${authority}`)) {json(res,403,{error:'Local same-origin access only'});return;}
    const url=new URL(req.url,`http://${authority}`);
    if(req.method==='GET'&&url.pathname==='/api/health'){json(res,200,{ok:!host.failure,ui:'original-slint-wasm',host:'original-rust-studio'});return;}
    if(req.method==='GET'&&url.pathname==='/api/state'){
      const client=url.searchParams.get('client');if(!client||!/^[\w-]{1,64}$/.test(client))throw new Error('Invalid client');
      const state=await host.request('snapshot'),previous=clients.get(client)||new Map(),changed={};
      for(const [key,value]of Object.entries(state)){const encoded=JSON.stringify(value);if(previous.get(key)!==encoded){changed[key]=value;previous.set(key,encoded);}}
      clients.set(client,previous);if(clients.size>8)clients.delete(clients.keys().next().value);
      json(res,200,changed);return;
    }
    if(req.method==='POST'&&url.pathname==='/api/action'){
      const {name,args}=await body(req);if(!callbacks.has(name)||!Array.isArray(args))throw new Error('Unknown UI callback');
      if(name==='App.settings-install-version')throw new Error('Update this browser build through its build artifacts; desktop self-update is unavailable here');
      await host.request('invoke',{name,args});json(res,200,{ok:true});return;
    }
    if(req.method==='POST'&&url.pathname==='/api/drop'){
      const {paths}=await body(req);if(!Array.isArray(paths)||!paths.every(p=>typeof p==='string'&&path.resolve(p).startsWith(path.join(data,'imports')+path.sep)))throw new Error('Invalid imported paths');
      await host.request('import',{paths});json(res,200,{ok:true});return;
    }
    if(req.method==='GET'&&url.pathname==='/api/events'){
      const events=await host.request('events');
      for(const event of events)if(event.kind==='reveal'){
        try{if((await stat(event.path)).isFile()){const id=randomUUID();downloads.set(id,event.path);event.download='/download/'+id;}}catch{}
      }
      json(res,200,events);return;
    }
    if(req.method==='POST'&&url.pathname==='/api/picker'){
      const {picker,paths}=await body(req);if(!Number.isSafeInteger(picker)||!(paths===null||Array.isArray(paths)&&paths.every(p=>typeof p==='string'&&p.length<8192)))throw new Error('Invalid picker answer');
      await host.request('picker_reply',{picker,paths});json(res,200,{ok:true});return;
    }
    if(req.method==='POST'&&url.pathname==='/api/upload'){
      const name=path.basename(url.searchParams.get('name')||'upload').replaceAll('\0','');
      const uploadDir=path.join(data,'imports',randomUUID());await mkdir(uploadDir);
      const file=path.join(uploadDir,name);let size=0;
      try{await pipeline(req,new Transform({transform(chunk,_,done){size+=chunk.length;done(size>10*1024**3?new Error('File exceeds 10 GB'):null,chunk);}}),createWriteStream(file,{flags:'wx'}));}
      catch(error){await unlink(file).catch(()=>{});throw error;}
      json(res,200,{path:file});return;
    }
    if(req.method==='GET'&&url.pathname.startsWith('/download/')){
      const file=downloads.get(url.pathname.slice(10));if(!file)throw new Error('Unknown download');
      await serve(req,res,file,'application/octet-stream',true);return;
    }
    if(req.method==='GET'){
      const relative=url.pathname==='/'?'index.html':decodeURIComponent(url.pathname.slice(1));
      const root=relative.startsWith('pkg/')?path.resolve(here,'../wasm'):here;
      const file=path.resolve(root,relative);
      if(!file.startsWith(root+path.sep)||!['.html','.js','.css','.wasm'].includes(path.extname(file)))throw new Error('File not found');
      const type={'.html':'text/html; charset=utf-8','.js':'application/javascript','.css':'text/css','.wasm':'application/wasm'}[path.extname(file)];
      await serve(req,res,file,type);return;
    }
    json(res,404,{error:'Not found'});
  }catch(error){if(!res.headersSent)json(res,400,{error:error.message});else res.destroy();}
});
server.listen(Number(process.env.PORT||4317),'127.0.0.1',()=>console.log('Original Concat UI: http://127.0.0.1:'+(process.env.PORT||4317)));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{server.close();host.close();});
