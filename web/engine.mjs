// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 PON Cut contributors
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export function defaultBinary() {
  return process.env.CONCAT_BINARY || fileURLToPath(new URL('../vendor/Concat.app/Contents/MacOS/concat', import.meta.url));
}

/** One persistent native engine. Requests are correlated; mutations are never retried. */
export class Engine {
  constructor({ binary = defaultBinary(), roots, timeout = 120000 } = {}) {
    this.pending = new Map();
    this.nextId = 0;
    this.timeout = timeout;
    this.failure = null;
    this.stderr = '';
    this.child = spawn(binary, ['--mcp', 'headless'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, CONCAT_MCP_ROOTS: roots.map(p => path.resolve(p)).join(path.delimiter) },
    });
    this.child.on('error', error => this.fail(new Error(`Cannot start Concat engine: ${error.message}. Run npm run setup in web/, or set CONCAT_BINARY.`)));
    this.child.on('exit', (code, signal) => this.fail(new Error(`Concat engine stopped (${signal || code}). Restart PON Cut. ${this.stderr.slice(-600)}`)));
    this.child.stdin.on('error', error => this.fail(error));
    this.child.stderr.on('data', chunk => { this.stderr = (this.stderr + chunk).slice(-4000); });
    let buffer = '';
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', chunk => {
      buffer += chunk;
      if (buffer.length > 64 * 1024 * 1024) { this.fail(new Error('Engine response exceeded 64 MB')); this.child.kill(); return; }
      let newline;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
        if (!line.trim()) continue;
        try {
          const response = JSON.parse(line);
          const pending = this.pending.get(response.id);
          if (!pending) continue; // progress notifications have no id
          this.pending.delete(response.id);
          clearTimeout(pending.timer);
          if (response.error) pending.reject(new Error(response.error.message));
          else pending.resolve(response.result);
        } catch { this.fail(new Error('Invalid response from Concat engine')); this.child.kill(); }
      }
    });
    this.ready = this.request('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'pon-cut-web', version: '0.1.0' } })
      .then(() => this.child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n'));
    this.ready.catch(() => {}); // callers receive the same rejection through call()
  }
  fail(error) {
    this.failure ||= error;
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(this.failure); }
    this.pending.clear();
  }
  request(method, params) {
    if (this.failure) return Promise.reject(this.failure);
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.fail(new Error('Engine request timed out. Restart PON Cut before continuing.'));
        this.child.kill();
      }, this.timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }
  async call(name, args = {}) {
    await this.ready;
    const result = await this.request('tools/call', { name, arguments: args });
    if (result.isError) throw new Error(result.content?.filter(c => c.type === 'text').map(c => c.text).join('\n') || 'Engine refused the operation');
    const image = result.content?.find(c => c.type === 'image');
    if (image) return { image: image.data, mimeType: image.mimeType };
    if (result.structuredContent) return result.structuredContent;
    const text = result.content?.find(c => c.type === 'text')?.text;
    if (text) { try { return JSON.parse(text); } catch { return { message: text }; } }
    return {};
  }
  async close() {
    if (this.child.exitCode !== null || this.child.signalCode || !this.child.pid) return;
    await new Promise(resolve => {
      const timer = setTimeout(() => { this.child.kill('SIGKILL'); }, 3000);
      this.child.once('exit', () => { clearTimeout(timer); resolve(); });
      this.child.stdin.end();
    });
  }
}
