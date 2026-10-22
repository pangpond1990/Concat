// SPDX-License-Identifier: AGPL-3.0-or-later
// Concat Web Server & Engine Bridge
// Drives the native Concat Rust engine (concat --mcp headless) over JSON-RPC stdio
// and exposes a rich HTTP API + Web UI for editing video in the browser.

import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import readline from 'node:readline';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(__dirname, 'public');
const PROJECTS_DIR = path.join(__dirname, 'projects');
const CACHE_DIR = path.join(__dirname, '.cache');
const THUMBS_DIR = path.join(CACHE_DIR, 'thumbs');
const WAVEFORMS_DIR = path.join(CACHE_DIR, 'waveforms');
const EXPORTS_DIR = path.join(__dirname, 'exports');

const PORT = Number(process.env.PORT || 3420);

for (const dir of [PUBLIC_DIR, PROJECTS_DIR, CACHE_DIR, THUMBS_DIR, WAVEFORMS_DIR, EXPORTS_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

function resolveConcatBinary() {
  const candidates = [
    process.env.CONCAT_BIN,
    path.join(REPO_ROOT, 'bin', 'Concat.app', 'Contents', 'MacOS', 'concat'),
    path.join(REPO_ROOT, 'src', 'target', 'release', 'concat'),
    path.join(REPO_ROOT, 'src', 'target', 'app', 'concat'),
    path.join(REPO_ROOT, 'src', 'target', 'quick', 'concat'),
    path.join(REPO_ROOT, 'src', 'target', 'debug', 'concat'),
    '/Applications/Concat.app/Contents/MacOS/concat',
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return 'concat';
}

function resolveFfmpegBinary() {
  const candidates = [
    process.env.FFMPEG_BIN,
    '/opt/homebrew/bin/ffmpeg',
    '/usr/local/bin/ffmpeg',
    'ffmpeg',
  ].filter(Boolean);
  for (const c of candidates) {
    if (c === 'ffmpeg' || fs.existsSync(c)) return c;
  }
  return 'ffmpeg';
}

const CONCAT_BIN = resolveConcatBinary();
const FFMPEG_BIN = resolveFfmpegBinary();

// ── Persistent JSON-RPC Bridge to `concat --mcp headless` ───────────────────
class ConcatEngineBridge {
  constructor(binaryPath) {
    this.binaryPath = binaryPath;
    this.proc = null;
    this.nextId = 1;
    this.pending = new Map();
    this.openProjects = new Set();
    this.projectRevisions = new Map();
    this.frameCache = new Map(); // key -> Buffer
    this.maxFrameCache = 120;
    this.starting = null;
  }

  async ensureStarted() {
    if (this.proc && !this.proc.killed && this.proc.exitCode === null) {
      return;
    }
    if (this.starting) {
      return this.starting;
    }
    this.starting = this._spawn();
    try {
      await this.starting;
    } finally {
      this.starting = null;
    }
  }

  async _spawn() {
    const roots = [os.homedir(), '/tmp', '/private/tmp', REPO_ROOT, PROJECTS_DIR, EXPORTS_DIR].join(path.delimiter);
    console.log(`[ConcatWeb] Spawning engine: ${this.binaryPath} --mcp headless`);
    const child = spawn(this.binaryPath, ['--mcp', 'headless'], {
      env: {
        ...process.env,
        CONCAT_MCP_ROOTS: roots,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.proc = child;

    const rl = readline.createInterface({ input: child.stdout });
    rl.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('{')) return;
      try {
        const msg = JSON.parse(trimmed);
        if (msg.id !== undefined && this.pending.has(msg.id)) {
          const { resolve, reject, timer } = this.pending.get(msg.id);
          clearTimeout(timer);
          this.pending.delete(msg.id);
          if (msg.error) {
            reject(new Error(msg.error.message || JSON.stringify(msg.error)));
          } else {
            resolve(msg.result);
          }
        }
      } catch (err) {
        console.error('[ConcatWeb] Failed to parse engine line:', err);
      }
    });

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString().trim();
      if (text) {
        for (const l of text.split('\n')) {
          if (!l.includes('WARN')) {
            console.log(`[concat-engine] ${l}`);
          }
        }
      }
    });

    child.on('exit', (code, signal) => {
      console.warn(`[ConcatWeb] Engine exited (code=${code}, signal=${signal})`);
      for (const [, entry] of this.pending) {
        clearTimeout(entry.timer);
        entry.reject(new Error('Concat engine process exited'));
      }
      this.pending.clear();
      this.proc = null;
    });

    // Re-open any projects that were open before a restart
    if (this.openProjects.size > 0) {
      for (const projectPath of Array.from(this.openProjects)) {
        try {
          await this._rawToolCall('project_open', { path: projectPath });
        } catch {
          this.openProjects.delete(projectPath);
        }
      }
    }
  }

  _rawRequest(method, params, timeoutMs = 60000) {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Engine request timed out: ${method}`));
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timer });
      const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
      this.proc.stdin.write(payload, (err) => {
        if (err) {
          clearTimeout(timer);
          this.pending.delete(id);
          reject(err);
        }
      });
    });
  }

  async _rawToolCall(name, args = {}, timeoutMs = 60000) {
    const result = await this._rawRequest('tools/call', { name, arguments: args }, timeoutMs);
    if (result?.isError) {
      const errMsg =
        result?.structuredContent?.error?.message ||
        result?.content?.[0]?.text ||
        `Tool ${name} failed`;
      const err = new Error(errMsg);
      err.code = result?.structuredContent?.error?.code || 'failed';
      throw err;
    }
    if (name === 'preview_frame') {
      const imgBlock = result?.content?.find((c) => c.type === 'image');
      return {
        pngBase64: imgBlock?.data || null,
        ...(result?.structuredContent || {}),
      };
    }
    if (result?.structuredContent) {
      return result.structuredContent;
    }
    const textBlock = result?.content?.find((c) => c.type === 'text');
    if (textBlock?.text) {
      try {
        return JSON.parse(textBlock.text);
      } catch {
        return textBlock.text;
      }
    }
    return result;
  }

  async callTool(name, args = {}, timeoutMs = 60000) {
    await this.ensureStarted();
    return this._rawToolCall(name, args, timeoutMs);
  }

  bumpRevision(projectPath) {
    const rev = (this.projectRevisions.get(projectPath) || 0) + 1;
    this.projectRevisions.set(projectPath, rev);
    return rev;
  }

  getRevision(projectPath) {
    return this.projectRevisions.get(projectPath) || 0;
  }

  async openAndGetView(projectPath) {
    await this.callTool('project_open', { path: projectPath });
    this.openProjects.add(projectPath);
    const view = await this.callTool('project_get', { path: projectPath });
    return view;
  }

  async mutateAndGetView(projectPath, toolName, args) {
    let outcome;
    try {
      outcome = await this.callTool(toolName, args);
    } catch (err) {
      if (err.code === 'notOpen' || String(err.message).includes('not open')) {
        await this.callTool('project_open', { path: projectPath });
        this.openProjects.add(projectPath);
        outcome = await this.callTool(toolName, args);
      } else {
        throw err;
      }
    }
    this.bumpRevision(projectPath);
    const view = await this.callTool('project_get', { path: projectPath });
    if (outcome && typeof outcome === 'object' && outcome.createdId) {
      view.createdId = outcome.createdId;
    }
    return view;
  }

  async getPreviewPng(projectPath, timeSeconds, width, height) {
    const rev = this.getRevision(projectPath);
    const roundedTime = Math.round(Number(timeSeconds || 0) * 60) / 60;
    const key = `${projectPath}|${rev}|${roundedTime.toFixed(4)}|${width || 0}x${height || 0}`;
    if (this.frameCache.has(key)) {
      return this.frameCache.get(key);
    }
    const args = {
      path: projectPath,
      time: Math.max(0, Number(timeSeconds || 0)),
    };
    if (width && height) {
      args.width = Math.round(Number(width));
      args.height = Math.round(Number(height));
    }
    let res;
    try {
      res = await this.callTool('preview_frame', args);
    } catch (err) {
      if (err.code === 'notOpen' || String(err.message).includes('not open')) {
        await this.callTool('project_open', { path: projectPath });
        this.openProjects.add(projectPath);
        res = await this.callTool('preview_frame', args);
      } else {
        throw err;
      }
    }
    if (!res?.pngBase64) {
      throw new Error('No frame returned by engine');
    }
    const buf = Buffer.from(res.pngBase64, 'base64');
    if (this.frameCache.size >= this.maxFrameCache) {
      const oldestKey = this.frameCache.keys().next().value;
      this.frameCache.delete(oldestKey);
    }
    this.frameCache.set(key, buf);
    return buf;
  }
}

const engine = new ConcatEngineBridge(CONCAT_BIN);

// ── Parse built-in Text Presets from `src/crates/concat/text-presets` ───────
function loadTextPresets() {
  const presetsDir = path.join(REPO_ROOT, 'src', 'crates', 'concat', 'text-presets');
  const presets = [];
  if (fs.existsSync(presetsDir)) {
    for (const entry of fs.readdirSync(presetsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const tomlPath = path.join(presetsDir, entry.name, 'preset.toml');
      if (!fs.existsSync(tomlPath)) continue;
      const content = fs.readFileSync(tomlPath, 'utf8');
      const parsed = parseSimpleToml(content);
      if (parsed.id) {
        presets.push({
          id: parsed.id,
          name: parsed.name || parsed.id,
          language: parsed.language || 'Latin',
          order: parsed.order !== undefined ? Number(parsed.order) : 999,
          offsetY: parsed.offsetY !== undefined ? Number(parsed.offsetY) : 0,
          sample: parsed.sample || (parsed.language && parsed.language !== 'Latin' ? (parsed.style?.content || 'Aa').slice(0, 2) : 'Aa'),
          style: {
            content: parsed.style?.content || parsed.name || 'Your text',
            fontFamily: parsed.style?.fontFamily || 'Hanken Grotesk',
            fontSize: parsed.style?.fontSize !== undefined ? Number(parsed.style.fontSize) : 0.09,
            fontWeight: parsed.style?.fontWeight !== undefined ? Number(parsed.style.fontWeight) : 700,
            italic: Boolean(parsed.style?.italic),
            color: parsed.style?.color || '#ffffff',
            align: parsed.style?.align || 'center',
            opacity: parsed.style?.opacity !== undefined ? Number(parsed.style.opacity) : 1.0,
            strokeWidth: parsed.style?.strokeWidth !== undefined ? Number(parsed.style.strokeWidth) : 0.0,
            strokeColor: parsed.style?.strokeColor || '#000000',
            shadow: parsed.style?.shadow !== undefined ? Boolean(parsed.style.shadow) : true,
            background: parsed.style?.background || '',
            lineHeight: parsed.style?.lineHeight !== undefined ? Number(parsed.style.lineHeight) : 1.2,
            tracking: parsed.style?.tracking !== undefined ? Number(parsed.style.tracking) : 0.0,
          },
        });
      }
    }
  }

  // Add built-in Thai language presets so Thai users have native looks out of the box
  presets.push(
    {
      id: 'concat.thai-headline',
      name: 'พาดหัวข่าว (Thai Headline)',
      language: 'Thai',
      order: 1,
      offsetY: 0.3,
      sample: 'กข',
      style: {
        content: 'พาดหัวข่าวเด่นวันนี้',
        fontFamily: 'Thonburi',
        fontSize: 0.085,
        fontWeight: 700,
        italic: false,
        color: '#cbf53f',
        align: 'center',
        opacity: 1.0,
        strokeWidth: 0.012,
        strokeColor: '#000000',
        shadow: true,
        background: '#000000cc',
        lineHeight: 1.25,
        tracking: 0.0,
      },
    },
    {
      id: 'concat.thai- vlog',
      name: 'ซับไตเติลไทย (Thai Subtitle)',
      language: 'Thai',
      order: 2,
      offsetY: 0.35,
      sample: 'ไทย',
      style: {
        content: 'คำบรรยายวิดีโอภาษาไทย',
        fontFamily: 'Ayuthaya',
        fontSize: 0.055,
        fontWeight: 700,
        italic: false,
        color: '#ffffff',
        align: 'center',
        opacity: 1.0,
        strokeWidth: 0.01,
        strokeColor: '#151517',
        shadow: true,
        background: '',
        lineHeight: 1.2,
        tracking: 0.0,
      },
    }
  );

  presets.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  return presets;
}

function parseSimpleToml(text) {
  const result = { style: {} };
  let currentSection = result;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    if (line === '[style]') {
      currentSection = result.style;
      continue;
    }
    const eqIdx = line.indexOf('=');
    if (eqIdx === -1) continue;
    const key = line.slice(0, eqIdx).trim();
    let val = line.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    } else if (val === 'true') {
      val = true;
    } else if (val === 'false') {
      val = false;
    } else if (!Number.isNaN(Number(val))) {
      val = Number(val);
    }
    currentSection[key] = val;
  }
  return result;
}

const TEXT_PRESETS = loadTextPresets();

// ── Media Thumbnail & Waveform Helpers ──────────────────────────────────────
async function getMediaThumbnail(filePath, timeSec = 0.5) {
  const stat = await fsp.stat(filePath);
  const hash = crypto
    .createHash('sha1')
    .update(`${filePath}|${stat.mtimeMs}|${timeSec}`)
    .digest('hex');
  const outPath = path.join(THUMBS_DIR, `${hash}.jpg`);
  if (fs.existsSync(outPath)) {
    return fsp.readFile(outPath);
  }
  await execFileAsync(FFMPEG_BIN, [
    '-y',
    '-ss',
    String(Math.max(0, timeSec)),
    '-i',
    filePath,
    '-frames:v',
    '1',
    '-vf',
    'scale=320:-1',
    '-q:v',
    '5',
    outPath,
  ]);
  return fsp.readFile(outPath);
}

async function getMediaWaveform(filePath, numBars = 80) {
  const stat = await fsp.stat(filePath);
  const hash = crypto
    .createHash('sha1')
    .update(`${filePath}|${stat.mtimeMs}|${numBars}`)
    .digest('hex');
  const cachePath = path.join(WAVEFORMS_DIR, `${hash}.json`);
  if (fs.existsSync(cachePath)) {
    return JSON.parse(await fsp.readFile(cachePath, 'utf8'));
  }

  try {
    // Extract raw 8000Hz mono float32 samples (max 120 seconds)
    const { stdout } = await execFileAsync(
      FFMPEG_BIN,
      [
        '-v',
        'error',
        '-i',
        filePath,
        '-t',
        '120',
        '-ac',
        '1',
        '-ar',
        '2000',
        '-f',
        'f32le',
        'pipe:1',
      ],
      { encoding: 'buffer', maxBuffer: 10 * 1024 * 1024 }
    );

    const sampleCount = Math.floor(stdout.length / 4);
    if (sampleCount === 0) {
      return Array(numBars).fill(0.15);
    }
    const floats = new Float32Array(stdout.buffer, stdout.byteOffset, sampleCount);
    const step = Math.max(1, Math.floor(sampleCount / numBars));
    const bars = [];
    let maxPeak = 0.01;
    for (let i = 0; i < numBars; i++) {
      const start = i * step;
      const end = Math.min(sampleCount, start + step);
      let sum = 0;
      let count = 0;
      for (let j = start; j < end; j++) {
        const v = Math.abs(floats[j]);
        if (Number.isFinite(v)) {
          sum += v * v;
          count++;
        }
      }
      const rms = count > 0 ? Math.sqrt(sum / count) : 0.05;
      if (rms > maxPeak) maxPeak = rms;
      bars.push(rms);
    }
    const normalized = bars.map((v) => Math.max(0.08, Math.min(1.0, Number((v / maxPeak).toFixed(3)))));
    await fsp.writeFile(cachePath, JSON.stringify(normalized));
    return normalized;
  } catch {
    const fallback = Array.from({ length: numBars }, (_, i) =>
      Number((0.2 + 0.5 * Math.abs(Math.sin(i * 0.45) * Math.cos(i * 0.18))).toFixed(2))
    );
    return fallback;
  }
}

// ── Demo Project Generator ──────────────────────────────────────────────────
async function createDemoProject() {
  const demoSamplesDir = path.join(CACHE_DIR, 'demo-media');
  await fsp.mkdir(demoSamplesDir, { recursive: true });

  const clip1Path = path.join(demoSamplesDir, 'neon-city-intro.mp4');
  const clip2Path = path.join(demoSamplesDir, 'sunset-horizon.mp4');
  const audioPath = path.join(demoSamplesDir, 'ambient-beat.wav');

  // Generate 2 vibrant sample HD video clips + 1 ambient stereo soundtrack if not cached
  if (!fs.existsSync(clip1Path)) {
    await execFileAsync(FFMPEG_BIN, [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=1280x720:rate=30:duration=5',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:sample_rate=44100:duration=5',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-preset',
      'ultrafast',
      '-c:a',
      'aac',
      clip1Path,
    ]);
  }
  if (!fs.existsSync(clip2Path)) {
    await execFileAsync(FFMPEG_BIN, [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'color=c=#1e3a8a:s=1280x720:r=30:d=5,drawgrid=w=80:h=80:t=2:c=#38bdf8@0.35',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=554.37:sample_rate=44100:duration=5',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-preset',
      'ultrafast',
      '-c:a',
      'aac',
      clip2Path,
    ]);
  }
  if (!fs.existsSync(audioPath)) {
    await execFileAsync(FFMPEG_BIN, [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=220:sample_rate=44100:duration=10',
      '-af',
      'volume=0.35,afade=t=in:st=0:d=1,afade=t=out:st=8.5:d=1.5',
      audioPath,
    ]);
  }

  let demoName = 'Concat Studio Demo';
  let candidatePath = path.join(PROJECTS_DIR, demoName);
  let suffix = 1;
  while (fs.existsSync(candidatePath)) {
    suffix++;
    demoName = `Concat Studio Demo ${suffix}`;
    candidatePath = path.join(PROJECTS_DIR, demoName);
  }

  await engine.callTool('project_create', {
    location: PROJECTS_DIR,
    name: demoName,
    video: { width: 1280, height: 720, rateNum: 30, rateDen: 1 },
  });
  engine.openProjects.add(candidatePath);

  const imp1 = await engine.callTool('media_import', { path: candidatePath, file: clip1Path });
  const imp2 = await engine.callTool('media_import', { path: candidatePath, file: clip2Path });
  const imp3 = await engine.callTool('media_import', { path: candidatePath, file: audioPath });

  // Read project to get media IDs and tracks
  const view0 = await engine.callTool('project_get', { path: candidatePath });
  const mediaList = view0.project.media || [];
  const m1 = mediaList[0]?.id || imp1?.createdId || 'm1';
  const m2 = mediaList[1]?.id || imp2?.createdId || 'm2';
  const m3 = mediaList[2]?.id || imp3?.createdId || 'm3';

  // Lay video clips on T3 (main visual lane) and audio on T4
  await engine.callTool('clips_add_sequence', {
    path: candidatePath,
    mediaIds: [m1, m2],
    trackId: 'T3',
    start: 0,
  });

  await engine.callTool('clip_add', {
    path: candidatePath,
    mediaId: m3,
    trackId: 'T4',
    start: 0,
  });

  // Add a vivid filter layer on T2
  await engine.callTool('effect_layer_add', {
    path: candidatePath,
    trackId: 'T2',
    start: 0,
    duration: 10,
    effectId: 'concat.vivid',
    name: 'Vivid Look',
  });

  // Add title and captions on T1
  await engine.callTool('title_add', {
    path: candidatePath,
    trackId: 'T1',
    above: true,
    start: 0.4,
    duration: 4.2,
    offsetY: -0.25,
    style: {
      content: 'Concat Web Studio',
      fontFamily: 'Hanken Grotesk',
      fontSize: 0.09,
      fontWeight: 800,
      color: '#cbf53f',
      strokeWidth: 0.01,
      strokeColor: '#000000',
      shadow: true,
      background: '#000000aa',
    },
  });

  await engine.callTool('title_add', {
    path: candidatePath,
    trackId: 'T1',
    above: true,
    start: 5.0,
    duration: 4.5,
    offsetY: 0.32,
    style: {
      content: 'ตัดต่อวิดีโอผ่านเว็บด้วย Rust Engine แท้ 100%',
      fontFamily: 'Thonburi',
      fontSize: 0.06,
      fontWeight: 700,
      color: '#ffffff',
      strokeWidth: 0.008,
      strokeColor: '#000000',
      shadow: true,
      background: '#151517cc',
    },
  });

  await engine.callTool('project_save', { path: candidatePath });
  engine.bumpRevision(candidatePath);
  const finalView = await engine.callTool('project_get', { path: candidatePath });
  return { path: candidatePath, view: finalView };
}

// ── HTTP Helpers ────────────────────────────────────────────────────────────
function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.aac': 'audio/aac',
  '.m4a': 'audio/mp4',
  '.flac': 'audio/flac',
};

async function streamFileWithRange(req, res, filePath, downloadName = null) {
  if (!fs.existsSync(filePath)) {
    res.writeHead(404);
    res.end('File not found');
    return;
  }
  const stat = await fsp.stat(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  const headers = {
    'Content-Type': contentType,
    'Accept-Ranges': 'bytes',
  };
  if (downloadName) {
    headers['Content-Disposition'] = `attachment; filename="${encodeURIComponent(downloadName)}"`;
  }

  const range = req.headers.range;
  if (range) {
    const match = /bytes=(\d*)-(\d*)/.exec(range);
    if (match) {
      const start = match[1] ? parseInt(match[1], 10) : 0;
      const end = match[2] ? parseInt(match[2], 10) : stat.size - 1;
      if (start >= stat.size || end >= stat.size || start > end) {
        res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
        res.end();
        return;
      }
      headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
      headers['Content-Length'] = end - start + 1;
      res.writeHead(206, headers);
      fs.createReadStream(filePath, { start, end }).pipe(res);
      return;
    }
  }

  headers['Content-Length'] = stat.size;
  res.writeHead(200, headers);
  fs.createReadStream(filePath).pipe(res);
}

// Cached effects catalogue
let cachedCatalogue = null;

// ── HTTP Server ─────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;

    // 1. Bootstrap endpoint: version, recent projects, effects catalogue, text presets, templates
    if (req.method === 'GET' && pathname === '/api/bootstrap') {
      const version = await engine.callTool('concat_version', {});
      const recentProjects = await engine.callTool('project_list', {});
      if (!cachedCatalogue) {
        cachedCatalogue = await engine.callTool('effects_list', {});
      }
      const templates = await engine.callTool('template_list', {});

      // Also scan local web/projects directory for any project folders
      const localFolders = [];
      if (fs.existsSync(PROJECTS_DIR)) {
        for (const d of fs.readdirSync(PROJECTS_DIR, { withFileTypes: true })) {
          if (d.isDirectory()) {
            const p = path.join(PROJECTS_DIR, d.name);
            const manifestPath = path.join(p, 'concat.json');
            if (fs.existsSync(manifestPath)) {
              try {
                const doc = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
                localFolders.push({
                  path: p,
                  name: doc.name || d.name,
                  width: doc.video?.width || 1920,
                  height: doc.video?.height || 1080,
                  rateNum: doc.video?.rateNum || 30,
                  rateDen: doc.video?.rateDen || 1,
                });
              } catch {
                // ignore unreadable
              }
            }
          }
        }
      }

      // Merge recentProjects and localFolders without duplicates
      const seenPaths = new Set();
      const mergedProjects = [];
      for (const item of [...localFolders, ...(Array.isArray(recentProjects) ? recentProjects : [])]) {
        if (item?.path && !seenPaths.has(item.path) && fs.existsSync(item.path)) {
          seenPaths.add(item.path);
          mergedProjects.push(item);
        }
      }

      // Group catalogue by kind for convenience
      const allFx = Array.isArray(cachedCatalogue) ? cachedCatalogue : [];
      const catalog = {
        effects: allFx.filter((e) => e.kind === 'effect'),
        filters: allFx.filter((e) => e.kind === 'filter'),
        transitions: allFx.filter((e) => e.kind === 'transition'),
        audio: allFx.filter((e) => e.kind === 'audio'),
      };

      return sendJson(res, 200, {
        version,
        projects: mergedProjects,
        projectsDir: PROJECTS_DIR,
        exportsDir: EXPORTS_DIR,
        effects: allFx,
        catalog,
        textPresets: TEXT_PRESETS,
        templates: Array.isArray(templates) ? templates : [],
      });
    }

    // 2. Create project
    if (req.method === 'POST' && pathname === '/api/project/create') {
      const body = await readJsonBody(req);
      const location = body.location || PROJECTS_DIR;
      await fsp.mkdir(location, { recursive: true });
      const rawName = (body.name || 'Untitled Project').trim();
      let name = rawName;
      let folderPath = path.join(location, name);
      let idx = 2;
      while (fs.existsSync(folderPath)) {
        name = `${rawName} ${idx++}`;
        folderPath = path.join(location, name);
      }

      const video = body.video || {
        width: Number(body.width) || 1920,
        height: Number(body.height) || 1080,
        rateNum: Number(body.fps || body.rateNum) || 30,
        rateDen: Number(body.rateDen) || 1,
      };

      await engine.callTool('project_create', {
        location,
        name,
        video,
      });
      engine.openProjects.add(folderPath);
      const view = await engine.callTool('project_get', { path: folderPath });
      return sendJson(res, 200, { path: folderPath, view });
    }

    // 3. Create Demo Project
    if (req.method === 'POST' && pathname === '/api/project/demo') {
      const result = await createDemoProject();
      return sendJson(res, 200, result);
    }

    // 4. Open project
    if (req.method === 'POST' && pathname === '/api/project/open') {
      const body = await readJsonBody(req);
      const view = await engine.openAndGetView(body.path);
      return sendJson(res, 200, { path: body.path, view });
    }

    // 5. Save project
    if (req.method === 'POST' && pathname === '/api/project/save') {
      const body = await readJsonBody(req);
      const args = { path: body.path };
      if (body.name) args.name = body.name;
      await engine.callTool('project_save', args);
      const view = await engine.callTool('project_get', { path: body.path });
      return sendJson(res, 200, { ok: true, view });
    }

    // 6. Close project
    if (req.method === 'POST' && pathname === '/api/project/close') {
      const body = await readJsonBody(req);
      await engine.callTool('project_close', { path: body.path, save: Boolean(body.save) });
      engine.openProjects.delete(body.path);
      return sendJson(res, 200, { ok: true });
    }

    // 7. Set video settings
    if (req.method === 'POST' && pathname === '/api/project/video') {
      const body = await readJsonBody(req);
      const video = body.video || {
        width: Number(body.width) || 1920,
        height: Number(body.height) || 1080,
        rateNum: Number(body.fps || body.rateNum) || 30,
        rateDen: Number(body.rateDen) || 1,
      };
      const view = await engine.mutateAndGetView(body.path, 'project_set_video', {
        path: body.path,
        video,
      });
      return sendJson(res, 200, { view });
    }

    // 8. Apply any edit command (`edit_apply`)
    if (req.method === 'POST' && pathname === '/api/edit') {
      const body = await readJsonBody(req);
      const view = await engine.mutateAndGetView(body.path, 'edit_apply', {
        path: body.path,
        command: body.command,
      });
      return sendJson(res, 200, { view, createdId: view.createdId });
    }

    // 9. Undo / Redo
    if (req.method === 'POST' && pathname === '/api/undo') {
      const body = await readJsonBody(req);
      const view = await engine.mutateAndGetView(body.path, 'edit_undo', { path: body.path });
      return sendJson(res, 200, { view });
    }
    if (req.method === 'POST' && pathname === '/api/redo') {
      const body = await readJsonBody(req);
      const view = await engine.mutateAndGetView(body.path, 'edit_redo', { path: body.path });
      return sendJson(res, 200, { view });
    }

    // 10. Batch Captions (`captions_add`)
    if (req.method === 'POST' && pathname === '/api/captions') {
      const body = await readJsonBody(req);
      const view = await engine.mutateAndGetView(body.path, 'captions_add', {
        path: body.path,
        captions: body.captions,
        style: body.style || null,
        offsetY: body.offsetY ?? 0.35,
      });
      return sendJson(res, 200, { view });
    }

    // 11. Upload media file from browser & import into project bin
    if (req.method === 'POST' && pathname === '/api/upload') {
      const projectPath =
        url.searchParams.get('projectPath') ||
        decodeURIComponent(req.headers['x-project-path'] || '');
      const rawFileName =
        url.searchParams.get('filename') ||
        decodeURIComponent(req.headers['x-file-name'] || `upload-${Date.now()}.mp4`);
      const safeName = path.basename(rawFileName).replace(/[^\w.\-\u0E00-\u0E7F ]+/g, '_');
      if (!projectPath) {
        return sendJson(res, 400, { error: 'Missing projectPath' });
      }
      const mediaDir = path.join(projectPath, 'media');
      await fsp.mkdir(mediaDir, { recursive: true });
      let destPath = path.join(mediaDir, safeName);
      if (fs.existsSync(destPath)) {
        const ext = path.extname(safeName);
        const base = path.basename(safeName, ext);
        destPath = path.join(mediaDir, `${base}-${Date.now()}${ext}`);
      }
      const buf = await readRawBody(req);
      await fsp.writeFile(destPath, buf);

      const view = await engine.mutateAndGetView(projectPath, 'media_import', {
        path: projectPath,
        file: destPath,
      });
      return sendJson(res, 200, { view, filePath: destPath, createdId: view.createdId });
    }

    // 12. Import local media file by path
    if (req.method === 'POST' && pathname === '/api/import-path') {
      const body = await readJsonBody(req);
      const view = await engine.mutateAndGetView(body.path, 'media_import', {
        path: body.path,
        file: body.file,
      });
      return sendJson(res, 200, { view, createdId: view.createdId });
    }

    // 13. Text-to-Speech (TTS) generation & import
    if (req.method === 'POST' && pathname === '/api/tts') {
      const body = await readJsonBody(req);
      const { path: projectPath, text, voice } = body;
      const start = Number(body.start ?? body.offset ?? 0);
      const addToTimeline = body.addToTimeline !== false;
      if (!projectPath || !text?.trim()) {
        return sendJson(res, 400, { error: 'Project path and text are required' });
      }
      const mediaDir = path.join(projectPath, 'media');
      await fsp.mkdir(mediaDir, { recursive: true });
      const stamp = Date.now();
      const aiffPath = path.join(mediaDir, `speech-${stamp}.aiff`);
      const wavPath = path.join(mediaDir, `speech-${stamp}.wav`);

      const args = ['-o', aiffPath];
      if (voice && voice !== 'auto') {
        args.push('-v', voice);
      } else if (/[\u0E00-\u0E7F]/.test(text)) {
        args.push('-v', 'Kanya');
      }
      args.push(text.trim());

      await execFileAsync('/usr/bin/say', args);
      await execFileAsync(FFMPEG_BIN, ['-y', '-i', aiffPath, '-ar', '44100', '-ac', '2', wavPath]);
      await fsp.unlink(aiffPath).catch(() => {});

      // Probe & add with Speech origin
      const probed = await engine.callTool('media_probe', { path: wavPath });
      let view = await engine.mutateAndGetView(projectPath, 'edit_apply', {
        path: projectPath,
        command: {
          op: 'addMedia',
          item: {
            path: wavPath,
            name: `TTS: ${text.trim().slice(0, 24)}`,
            duration: probed.duration || 3.0,
            kind: 'audio',
            hasAudio: true,
            origin: 'speech',
          },
        },
      });
      const mediaId = view.createdId || view.project.media[view.project.media.length - 1]?.id;
      if (addToTimeline && mediaId) {
        view = await engine.mutateAndGetView(projectPath, 'edit_apply', {
          path: projectPath,
          command: {
            op: 'addClipAtFirstFree',
            mediaId,
            start,
          },
        });
      }
      return sendJson(res, 200, { view, mediaId, filePath: wavPath });
    }

    // 14. True Engine Frame Preview (`/api/preview`)
    if (req.method === 'GET' && pathname === '/api/preview') {
      const projectPath = url.searchParams.get('path');
      const time = Number(url.searchParams.get('time') ?? url.searchParams.get('timeSec') ?? 0);
      const width = Number(url.searchParams.get('width') ?? url.searchParams.get('maxWidth') ?? 0);
      const height = Number(url.searchParams.get('height') ?? 0);
      if (!projectPath) {
        return sendJson(res, 400, { error: 'Missing path parameter' });
      }
      const pngBuffer = await engine.getPreviewPng(projectPath, time, width, height);
      res.writeHead(200, {
        'Content-Type': 'image/png',
        'Content-Length': pngBuffer.length,
        'Cache-Control': 'no-cache',
      });
      res.end(pngBuffer);
      return;
    }

    // 15. Media streaming & thumbnails & waveforms
    if (req.method === 'GET' && pathname === '/api/media-stream') {
      const file = url.searchParams.get('file') || url.searchParams.get('path');
      if (!file) return sendJson(res, 400, { error: 'Missing file param' });
      return streamFileWithRange(req, res, file);
    }

    if (req.method === 'GET' && pathname === '/api/media-thumb') {
      const file = url.searchParams.get('file') || url.searchParams.get('path');
      const time = Number(url.searchParams.get('time') || 0.5);
      if (!file || !fs.existsSync(file)) {
        res.writeHead(404);
        res.end();
        return;
      }
      try {
        const jpg = await getMediaThumbnail(file, time);
        res.writeHead(200, {
          'Content-Type': 'image/jpeg',
          'Content-Length': jpg.length,
          'Cache-Control': 'public, max-age=3600',
        });
        res.end(jpg);
      } catch {
        res.writeHead(404);
        res.end();
      }
      return;
    }

    if (req.method === 'GET' && pathname === '/api/media-waveform') {
      const file = url.searchParams.get('file') || url.searchParams.get('path');
      const bars = Number(url.searchParams.get('bars') || 80);
      if (!file || !fs.existsSync(file)) {
        const empty = Array(bars).fill(0.15);
        return sendJson(res, 200, { bars: empty, peaks: empty });
      }
      const waveform = await getMediaWaveform(file, bars);
      return sendJson(res, 200, { bars: waveform, peaks: waveform });
    }

    // 16. Export endpoints (`export_start`, `export_status`, `export_cancel`, `export/download`)
    if (req.method === 'POST' && pathname === '/api/export/start') {
      const body = await readJsonBody(req);
      const { path: projectPath, filename, crf, preset, width, height, rateNum, rateDen, codec, tenBit, colorRange, hdr } = body;
      await fsp.mkdir(EXPORTS_DIR, { recursive: true });
      const safeFilename = (filename || `concat-export-${Date.now()}.mp4`).replace(/[^\w.\-\u0E00-\u0E7F ]+/g, '_');
      const output = body.output || path.join(EXPORTS_DIR, safeFilename.endsWith('.mp4') ? safeFilename : `${safeFilename}.mp4`);

      const args = { path: projectPath, output };
      if (crf !== undefined) args.crf = Number(crf);
      if (preset) args.preset = preset;
      if (width) args.width = Number(width);
      if (height) args.height = Number(height);
      if (rateNum) args.rateNum = Number(rateNum);
      if (rateDen) args.rateDen = Number(rateDen);
      if (codec) args.codec = codec;
      if (tenBit !== undefined) args.tenBit = Boolean(tenBit);
      if (colorRange) args.colorRange = colorRange;
      if (hdr !== undefined) args.hdr = Boolean(hdr);

      const started = await engine.callTool('export_start', args);
      return sendJson(res, 200, { ...started, jobId: started.job, output });
    }

    if (req.method === 'GET' && pathname === '/api/export/status') {
      const job = url.searchParams.get('job') || url.searchParams.get('jobId');
      if (!job) return sendJson(res, 400, { error: 'Missing job parameter' });
      const status = await engine.callTool('export_status', { job });
      return sendJson(res, 200, {
        ...status,
        jobId: status.job || job,
        status: status.state || status.status,
      });
    }

    if (req.method === 'POST' && pathname === '/api/export/cancel') {
      const body = await readJsonBody(req);
      const job = body.job || body.jobId;
      const result = await engine.callTool('export_cancel', { job });
      return sendJson(res, 200, result);
    }

    if (req.method === 'GET' && pathname === '/api/export/download') {
      const file = url.searchParams.get('file');
      const jobId = url.searchParams.get('jobId') || url.searchParams.get('job');
      let targetFile = file;
      if (!targetFile && jobId) {
        const status = await engine.callTool('export_status', { job: jobId });
        targetFile = status.output;
      }
      if (!targetFile || !fs.existsSync(targetFile)) {
        return sendJson(res, 404, { error: 'Export file not found' });
      }
      return streamFileWithRange(req, res, targetFile, path.basename(targetFile));
    }

    // 17. Serve repository assets (`/assets/...`)
    if (req.method === 'GET' && pathname.startsWith('/assets/')) {
      const rel = pathname.slice('/assets/'.length);
      const assetPath = path.resolve(REPO_ROOT, 'assets', rel);
      if (assetPath.startsWith(path.join(REPO_ROOT, 'assets')) && fs.existsSync(assetPath)) {
        return streamFileWithRange(req, res, assetPath);
      }
    }

    // 18. Static files from `web/public`
    const cleanPath = pathname === '/' ? '/index.html' : pathname;
    const staticFile = path.resolve(PUBLIC_DIR, `.${cleanPath}`);
    if (staticFile.startsWith(PUBLIC_DIR) && fs.existsSync(staticFile) && fs.statSync(staticFile).isFile()) {
      return streamFileWithRange(req, res, staticFile);
    }

    sendJson(res, 404, { error: `Not found: ${pathname}` });
  } catch (err) {
    console.error('[ConcatWeb Error]', err);
    sendJson(res, 400, {
      error: err.message || 'Internal error',
      code: err.code || 'failed',
    });
  }
});

server.listen(PORT, '127.0.0.1', async () => {
  console.log(`\n=============================================================`);
  console.log(`🎬 Concat Web Studio running at http://127.0.0.1:${PORT}`);
  console.log(`🔧 Engine Binary: ${CONCAT_BIN}`);
  console.log(`📁 Projects Dir : ${PROJECTS_DIR}`);
  console.log(`=============================================================\n`);
  try {
    await engine.ensureStarted();
  } catch (err) {
    console.error('[ConcatWeb] Initial engine warm-up failed:', err.message);
  }
});
