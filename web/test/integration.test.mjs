// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 PON Cut contributors
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import http from 'node:http';
import { Engine, defaultBinary } from '../engine.mjs';
import { createApp } from '../server.mjs';

test('native engine workflow: import, edit, undo, save, reopen, preview and MP4 with audio', { timeout: 120000 }, async t => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'pon-cut-test-'));
  const engine = new Engine({ binary: defaultBinary(), roots: [dataDir] });
  const server = await createApp({ dataDir, engine, maxUploadBytes: 2 * 1024 * 1024 });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(r => server.close(r)); await engine.close(); await rm(dataDir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (url, body, method = 'POST') => {
    const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const result = await res.json();
    assert.equal(res.status, 200, JSON.stringify(result));
    return result;
  };
  const health = await request('/api/health', undefined, 'GET');
  assert.equal(health.ok, true);
  const { id, view } = await request('/api/projects', { name: 'ทดสอบ cutting', width: 320, height: 180, fps: 24 });
  assert.equal(view.settings.name, 'ทดสอบ cutting');
  const p = `/api/projects/${id}`;
  const fixture = path.join(dataDir, 'fixture.mp4');
  execFileSync('ffmpeg', ['-v','error','-f','lavfi','-i','color=c=blue:s=320x180:r=24:d=2','-f','lavfi','-i','sine=frequency=440:duration=2','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-shortest',fixture]);
  let res = await fetch(base + p + '/media?name=clip.mp4', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: await readFile(fixture) });
  assert.equal(res.status, 200, await res.clone().text());
  let state = await res.json();
  const media = state.view.project.media[0];
  assert.equal(media.name, 'clip.mp4');
  state = await request(p + '/edit', { command: { op: 'addClipAtFirstFree', mediaId: media.id, start: 0 } });
  const timeline = v => v.project.timelines.find(x => x.id === v.project.activeTimelineId);
  const clip = timeline(state.view).clips[0];
  assert.ok(clip.duration >= 1.9);
  state = await request(p + '/edit', { command: { op: 'splitClips', clipIds: [clip.id], time: 1 } });
  assert.equal(timeline(state.view).clips.length, 2);
  state = await request(p + '/undo', {});
  assert.equal(timeline(state.view).clips.length, 1);
  state = await request(p + '/edit', { command: { op: 'trimClip', clipId: clip.id, edge: 'end', delta: -1, ripple: false } });
  assert.ok(Math.abs(timeline(state.view).clips[0].duration - 1) < 0.1);
  state = await request(p + '/edit', { command: { op: 'addTextClip', above: true, start: 0, duration: 1, style: { content: 'PON CUT', fontSize: 0.15 } } });
  assert.equal(timeline(state.view).clips.length, 2);
  res = await fetch(base + p + '/frame?time=0.5');
  assert.equal(res.status, 200, await res.clone().text());
  assert.equal(res.headers.get('content-type'), 'image/png');
  assert.ok((await res.arrayBuffer()).byteLength > 1000);
  const { job } = await request(p + '/render', { preview: false });
  let status;
  for (let n = 0; n < 200; n++) {
    status = await request(p + '/jobs/' + job, undefined, 'GET');
    if (status.state !== 'running') break;
    await new Promise(r => setTimeout(r, 100));
  }
  assert.equal(status.state, 'done', JSON.stringify(status));
  res = await fetch(base + status.url);
  assert.equal(res.status, 200);
  assert.ok((await res.arrayBuffer()).byteLength > 1000);
  const output = path.join(dataDir, id, 'exports', status.url.split('/').at(-1));
  const probe = JSON.parse(execFileSync('ffprobe', ['-v','error','-show_streams','-show_format','-of','json',output], { encoding:'utf8' }));
  assert.ok(probe.streams.some(s => s.codec_type === 'audio'));
  assert.ok(Math.abs(Number(probe.format.duration) - 1) < 0.2);
  assert.equal(probe.streams.find(s => s.codec_type === 'video').width, 320);
  res = await fetch(base + status.url, { headers: { Range: 'bytes=0-31' } });
  assert.equal(res.status, 206);
  assert.equal((await res.arrayBuffer()).byteLength, 32);
  await engine.call('project_close', { path: path.join(dataDir, id), save: true });
  state = await request(p, undefined, 'GET');
  assert.equal(timeline(state.view).clips.length, 2);
  const projects = await request('/api/projects', undefined, 'GET');
  assert.equal(projects.projects[0].name, 'ทดสอบ cutting');

  // A browser must not gain access to arbitrary host files or engine commands.
  for (const command of [{ op: 'replaceClipMedia', item: { path: '/etc/passwd' } }, { op: 'batch', commands: [{ op: 'importMedia' }] }]) {
    res = await fetch(base + p + '/edit', { method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({command}) });
    assert.equal(res.status, 400);
  }
  res = await fetch(base + p + '/edit', { method:'POST',headers:{'Content-Type':'application/json',Origin:'https://evil.test'},body:'{}' });
  assert.equal(res.status, 403);
  const hostileHostStatus = await new Promise((resolve,reject) => {
    http.get(base + '/api/projects', {headers:{Host:'evil.test'}}, response => { response.resume(); resolve(response.statusCode); }).on('error',reject);
  });
  assert.equal(hostileHostStatus, 403);
  res = await fetch(base + p + '/media?name=bad.mp4', {method:'POST',headers:{'Content-Type':'application/octet-stream'},body:'not a video'});
  assert.equal(res.status, 400);
  assert.equal((await readdir(path.join(dataDir,id,'uploads'))).length, 1);
  res = await fetch(base + p + '/media?name=large.mp4', {method:'POST',headers:{'Content-Type':'application/octet-stream'},body:Buffer.alloc(2*1024*1024+1)});
  assert.equal(res.status, 413);
  assert.equal((await readdir(path.join(dataDir,id,'uploads'))).length, 1);
  const overLimitStream = new ReadableStream({start(controller){controller.enqueue(Buffer.alloc(2*1024*1024+1));controller.close();}});
  res = await fetch(base + p + '/media?name=chunked.mp4', {method:'POST',headers:{'Content-Type':'application/octet-stream'},body:overLimitStream,duplex:'half'});
  assert.equal(res.status, 413);
  assert.equal((await readdir(path.join(dataDir,id,'uploads'))).length, 1);
  res = await fetch(base + p + '/files/not-an-export');
  assert.equal(res.status, 404);

  // A save failure after a successful import must never delete referenced media.
  const nativeCall = engine.call.bind(engine);
  engine.call = async (name,args) => {
    if(name==='project_save') throw new Error('Simulated disk full while saving');
    return nativeCall(name,args);
  };
  res = await fetch(base + p + '/media?name=preserved.mp4', {method:'POST',headers:{'Content-Type':'application/octet-stream'},body:await readFile(fixture)});
  assert.equal(res.status, 400);
  engine.call = nativeCall;
  state = await request(p,undefined,'GET');
  const preserved=state.view.project.media.find(item=>item.name==='preserved.mp4');
  assert.ok(preserved,'Native import remains in the session after a save failure');
  await access(path.resolve(dataDir,id,preserved.path));

  await request(p + '/edit',{command:{op:'addTextClip',above:true,start:0,duration:120,style:{content:'Cancellation test'}}});
  const cancelling=await request(p + '/render',{preview:true});
  await request(p + '/jobs/' + cancelling.job + '/cancel',{});
  for(let attempt=0;attempt<100;attempt++){
    status=await request(p + '/jobs/' + cancelling.job,undefined,'GET');
    if(status.state!=='running')break;
    await new Promise(resolve=>setTimeout(resolve,50));
  }
  assert.equal(status.state,'cancelled',JSON.stringify(status));
});

test('missing engine gives an actionable error and does not hang', async () => {
  const engine = new Engine({ binary: '/nonexistent/concat', roots: [tmpdir()] });
  await assert.rejects(engine.call('concat_version', {}), /engine|ENOENT|setup/i);
  await engine.close();
});
