// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 PON Cut contributors
import http from 'node:http';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, writeFile, readdir, stat, realpath, rename, rm } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Engine } from './engine.mjs';

const webDir = fileURLToPath(new URL('.', import.meta.url));
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const operations = new Set(['addClip','addClipAtFirstFree','addClipsInSequence','trimClip','splitClips','moveClips','removeClips','updateClip','setClipTransform','setClipSpeed','frameClip','addTextClip','addTrack','removeTrack','setTrackFlag','setClipKey','clearClipKey','detachAudio','reattachAudio']);
const mediaTypes = { '.mp4':'video/mp4','.mov':'video/quicktime','.webm':'video/webm','.m4v':'video/mp4','.mkv':'video/x-matroska','.mp3':'audio/mpeg','.wav':'audio/wav','.m4a':'audio/mp4','.aac':'audio/aac','.ogg':'audio/ogg','.flac':'audio/flac','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif' };
const error = (message, status = 400) => Object.assign(new Error(message), { status });
const send = (res, value, status = 200) => { res.writeHead(status, { 'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store' }); res.end(JSON.stringify(value)); };

async function json(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw error('Expected application/json', 415);
  let size = 0, chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > 1024*1024) throw error('Request too large',413); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString()); } catch { throw error('Invalid JSON'); }
}

function validateCommand(command, depth = 0) {
  if (!command || typeof command !== 'object' || depth > 8) throw error('Invalid edit command');
  if (command.op === 'batch') {
    if (!Array.isArray(command.commands) || command.commands.length > 100) throw error('Invalid edit batch');
    command.commands.forEach(c => validateCommand(c, depth + 1));
  } else if (!operations.has(command.op)) throw error('This edit is not supported by the web editor');
}

async function serveFile(req, res, file, type, download = false) {
  const info = await stat(file);
  if (!info.isFile()) throw error('File not found',404);
  const headers = { 'Content-Type':type, 'Accept-Ranges':'bytes', 'Cache-Control':'private, max-age=0' };
  if (download) headers['Content-Disposition'] = 'attachment; filename="pon-cut-export.mp4"';
  let start = 0, end = info.size - 1, status = 200;
  if (req.headers.range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
    if (!match || (!match[1] && !match[2])) throw error('Invalid range',416);
    if (!match[1]) start = Math.max(0, info.size - Number(match[2]));
    else { start = Number(match[1]); if (match[2]) end = Math.min(Number(match[2]), end); }
    if (start > end || start >= info.size) { res.writeHead(416,{'Content-Range':`bytes */${info.size}`}); res.end(); return; }
    headers['Content-Range'] = `bytes ${start}-${end}/${info.size}`; status = 206;
  }
  headers['Content-Length'] = Math.max(0, end-start+1);
  res.writeHead(status, headers);
  if (req.method === 'HEAD' || !info.size) { res.end(); return; }
  await pipeline(createReadStream(file, { start, end }), res);
}

export async function createApp({ dataDir = path.join(webDir,'data'), engine, maxUploadBytes = 10*1024**3 } = {}) {
  await mkdir(dataDir, { recursive:true });
  dataDir = await realpath(dataDir);
  engine ||= new Engine({ roots:[dataDir] });
  const jobs = new Map();
  let queue = Promise.resolve();
  const serialize = fn => { const result = queue.then(fn); queue = result.catch(() => {}); return result; };
  const projectPath = id => { if (!uuid.test(id)) throw error('Project not found',404); return path.join(dataDir,id); };
  async function meta(id) { return JSON.parse(await readFile(path.join(projectPath(id),'.web.json'),'utf8')); }
  async function getView(id) {
    const folder = projectPath(id); await meta(id);
    await engine.call('project_open', { path:folder });
    return engine.call('project_get', { path:folder });
  }
  async function save(id) { await engine.call('project_save',{path:projectPath(id)}); return { id, view:await getView(id) }; }
  async function confined(folder, file) {
    const real = await realpath(file);
    const relative = path.relative(await realpath(folder), real);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw error('File outside project',403);
    return real;
  }
  const server = http.createServer(async (req,res) => {
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Cross-Origin-Resource-Policy','same-origin');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      const host = req.headers.host || '';
      if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) throw error('Local access only',403);
      if (req.headers.origin && req.headers.origin !== `http://${host}`) throw error('Cross-origin request refused',403);
      if (req.headers['sec-fetch-site'] === 'cross-site') throw error('Cross-site request refused',403);
      const url = new URL(req.url, `http://${host}`);
      const parts = url.pathname.split('/').filter(Boolean);
      const method = req.method;
      if (url.pathname === '/api/health' && method === 'GET') {
        const version = await engine.call('concat_version');
        return send(res,{ok:true,service:'pon-cut',version});
      }
      if (url.pathname === '/api/effects' && method === 'GET') return send(res,await engine.call('effects_list',{kind:'filter'}));
      if (url.pathname === '/api/projects') {
        if (method === 'GET') {
          const projects = [];
          for (const entry of await readdir(dataDir)) if (uuid.test(entry)) {
            try { projects.push(await meta(entry)); } catch { /* incomplete project creation */ }
          }
          return send(res,{projects:projects.sort((a,b)=>b.createdAt.localeCompare(a.createdAt))});
        }
        if (method === 'POST') {
          const body = await json(req);
          const name = typeof body.name === 'string' ? body.name.trim().slice(0,100) : '';
          const width = body.width ?? 1080, height = body.height ?? 1920, fps = body.fps ?? 30;
          if (!name || ![width,height].every(x=>Number.isInteger(x)&&x>=64&&x<=3840&&x%2===0) || ![24,25,30,50,60].includes(fps)) throw error('Invalid project name, size or frame rate');
          return send(res,await serialize(async () => {
            const id = randomUUID(), folder = projectPath(id);
            await engine.call('project_create',{location:dataDir,name:id,video:{width,height,rateNum:fps,rateDen:1}});
            await engine.call('project_save',{path:folder,name});
            await mkdir(path.join(folder,'uploads'),{recursive:true});
            await mkdir(path.join(folder,'exports'),{recursive:true});
            await writeFile(path.join(folder,'.web.json'),JSON.stringify({id,name,width,height,fps,createdAt:new Date().toISOString()}));
            return {id,view:await getView(id)};
          }));
        }
      }
      if (parts[0]==='api' && parts[1]==='projects' && parts[2]) {
        const id = parts[2], folder = projectPath(id), action = parts[3];
        await meta(id);
        if (!action && method==='GET') return send(res,await serialize(async()=>({id,view:await getView(id)})));
        if (['edit','undo','redo','save'].includes(action) && method==='POST') {
          const body = await json(req);
          if (action==='edit') validateCommand(body.command);
          return send(res,await serialize(async()=>{
            await getView(id);
            if (action==='edit') await engine.call('edit_apply',{path:folder,command:body.command});
            if (action==='undo' || action==='redo') await engine.call(`edit_${action}`,{path:folder});
            return save(id);
          }));
        }
        if (action==='media' && method==='POST') {
          if (req.headers['content-type'] !== 'application/octet-stream') throw error('Expected file upload',415);
          const name = path.basename((url.searchParams.get('name') || '').replaceAll('\\','/')).replace(/[\x00-\x1f]/g,'').slice(0,180);
          if (!mediaTypes[path.extname(name).toLowerCase()]) throw error('Unsupported media file type');
          if (Number(req.headers['content-length']) > maxUploadBytes) throw error('File exceeds upload limit',413);
          const uploadId=randomUUID(), uploadDir=path.join(folder,'uploads',uploadId);
          await mkdir(uploadDir);
          const file=path.join(uploadDir,name), temporary=file+'.partial';
          let size=0, imported=false;
          try {
            const output=createWriteStream(temporary,{flags:'wx'});
            const limiter=new Transform({transform(chunk,encoding,callback){size+=chunk.length;callback(size>maxUploadBytes?error('File exceeds upload limit',413):null,chunk);}});
            await pipeline(req,limiter,output);
            if (!size) throw error('Empty upload');
            await rename(temporary,file);
            const result=await serialize(async()=>{
              await getView(id);
              await engine.call('media_import',{path:folder,file});
              imported=true; // From here the native session owns a reference to this file.
              return save(id);
            });
            return send(res,result);
          } catch (e) {
            if (!imported) await rm(uploadDir,{recursive:true,force:true});
            else e.message='Imported media is preserved, but saving failed. Free disk space and save the project again. '+e.message;
            throw e;
          }
        }
        if (action==='media' && parts[4] && (method==='GET'||method==='HEAD')) {
          const view=await serialize(()=>getView(id));
          const item=view.project.media.find(m=>m.id===parts[4]);
          if (!item) throw error('Media not found',404);
          const file=await confined(folder,path.resolve(folder,item.path));
          return await serveFile(req,res,file,mediaTypes[path.extname(file).toLowerCase()]||'application/octet-stream');
        }
        if (action==='frame' && method==='GET') {
          const time=Number(url.searchParams.get('time')||0);
          if (!Number.isFinite(time)||time<0) throw error('Invalid preview time');
          const frame=await serialize(async()=>{
            const view=await getView(id),scale=Math.min(1,640/Math.max(view.settings.width,view.settings.height));
            return engine.call('preview_frame',{path:folder,time,width:Math.max(2,Math.round(view.settings.width*scale/2)*2),height:Math.max(2,Math.round(view.settings.height*scale/2)*2)});
          });
          if (!frame.image) throw error('Engine returned no preview frame',502);
          res.writeHead(200,{'Content-Type':'image/png','Cache-Control':'no-store'});
          return res.end(Buffer.from(frame.image,'base64'));
        }
        if (action==='render' && method==='POST') {
          const body=await json(req);
          return send(res,await serialize(async()=>{
            const view=await getView(id);
            const timeline=view.project.timelines.find(t=>t.id===view.project.activeTimelineId);
            if (!timeline?.clips.length) throw error('Add a clip before rendering');
            const preview=body.preview===true, file=randomUUID()+'.mp4',output=path.join(folder,'exports',file);
            const args={path:folder,output,codec:'h264',preset:preview?'ultrafast':'medium',crf:preview?28:20};
            if (preview) { const scale=Math.min(1,640/Math.max(view.settings.width,view.settings.height)); args.width=Math.round(view.settings.width*scale/2)*2;args.height=Math.round(view.settings.height*scale/2)*2; }
            const result=await engine.call('export_start',args);
            const job=randomUUID(); jobs.set(job,{engineJob:result.job,project:id,file,preview});
            return {job,preview};
          }));
        }
        if (action==='jobs' && parts[4]) {
          const job=jobs.get(parts[4]);
          if (!job||job.project!==id) throw error('Job not found',404);
          if (method==='GET') {
            const status=await engine.call('export_status',{job:job.engineJob});
            return send(res,{...status,url:status.state==='done'?`/api/projects/${id}/files/${job.file}`:null,preview:job.preview});
          }
          if (method==='POST' && parts[5]==='cancel') { await json(req);return send(res,await engine.call('export_cancel',{job:job.engineJob})); }
        }
        if (action==='files' && parts[4] && (method==='GET'||method==='HEAD')) {
          const file=parts[4];
          if (!uuid.test(file.slice(0,-4))||!file.endsWith('.mp4')) throw error('File not found',404);
          return await serveFile(req,res,await confined(folder,path.join(folder,'exports',file)),'video/mp4',url.searchParams.has('download'));
        }
      }
      const assets={'/':'index.html','/app.js':'app.js','/timeline.js':'timeline.js','/styles.css':'styles.css'};
      if (assets[url.pathname] && (method==='GET'||method==='HEAD')) {
        const file=assets[url.pathname],type=file.endsWith('.js')?'text/javascript; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8';
        return await serveFile(req,res,path.join(webDir,'public',file),type);
      }
      throw error('Not found',404);
    } catch(e) {
      if (res.headersSent || res.destroyed) return;
      send(res,{error:e.code==='ENOENT'?'Not found':e.message},e.status || (e.code==='ENOENT'?404:400));
    }
  });
  server.requestTimeout=30*60*1000;
  server.headersTimeout=30000;
  server.engine=engine;
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port=Number(process.env.PORT||4317);
  const server=await createApp({dataDir:process.env.PON_CUT_DATA_DIR||path.join(webDir,'data')});
  server.on('error',async e=>{console.error(e.code==='EADDRINUSE'?`Port ${port} is already in use. Open http://127.0.0.1:${port} or set PORT.`:e.message);await server.engine.close();process.exitCode=1;});
  server.listen(port,'127.0.0.1',()=>console.log(`PON Cut → http://127.0.0.1:${port}`));
  const shutdown=()=>{server.closeAllConnections();server.close();server.engine.close().then(()=>process.exit());};
  process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
}
