/**
 * Server-side Phonon. Two backends:
 *  - HTTP: Phonon's OpenAI-compatible server (ghcr.io/gradium-ai/ptts-openai-server), set with
 *    PHONON_URL. `POST /v1/audio/speech` (wav), `GET /v1/audio/voices`, `GET /health`.
 *  - CLI: no PHONON_URL, but a `ptts` executable on PATH (or PHONON_CMD). Each request spawns
 *    `ptts --lang <lang> [--voice V] -o <tmp.wav> -- <text>`.
 */
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { accessSync, constants as fsConstants } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { HttpError } from './http-util.js';
import { Semaphore } from './limits.js';

const PROBE_TTL_MS = 15_000;
const VOICE_TTL_MS = 10 * 60_000;
const VOICE_RE = /^[\p{L}\p{N}][\p{L}\p{N} ._'()-]{0,63}$/u;

/**
 * Patch a WAV whose RIFF / data sizes are unknown (a streamed WAV says 0 or 0xFFFFFFFF) so
 * strict decoders such as browsers' decodeAudioData accept it.
 * @param {Buffer} buf
 * @returns {Buffer}
 */
export function fixWavHeader(buf) {
  if (buf.length < 12 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new HttpError(502, 'Phonon returned audio that is not WAV');
  }
  const out = Buffer.from(buf);
  out.writeUInt32LE(out.length - 8, 4);
  let p = 12;
  while (p + 8 <= out.length) {
    const id = out.toString('ascii', p, p + 4);
    const size = out.readUInt32LE(p + 4);
    if (id === 'data') {
      const actual = out.length - (p + 8);
      if (size !== actual) out.writeUInt32LE(actual, p + 4);
      return out;
    }
    p += 8 + size + (size % 2);
  }
  throw new HttpError(502, 'Phonon returned a WAV without audio data');
}

/**
 * Find an executable on PATH.
 * @param {string} name
 * @returns {string | null}
 */
function which(name) {
  if (name.includes('/')) {
    try {
      accessSync(name, fsConstants.X_OK);
      return name;
    } catch {
      return null;
    }
  }
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    const p = path.join(dir, name);
    try {
      accessSync(p, fsConstants.X_OK);
      return p;
    } catch {
      /* next */
    }
  }
  return null;
}

/**
 * Minimal HTTP client for the Phonon backend (internal network; never proxied).
 * @param {string} url
 * @param {{ method?: string, body?: unknown, timeoutMs: number, maxBytes?: number }} opts
 * @returns {Promise<{ status: number, headers: import('node:http').IncomingHttpHeaders, body: Buffer }>}
 */
function request(url, opts) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === 'https:' ? https : http;
    const payload = opts.body === undefined ? undefined : Buffer.from(JSON.stringify(opts.body));
    const req = mod.request(
      u,
      {
        method: opts.method ?? 'GET',
        agent: false,
        headers: payload
          ? { 'Content-Type': 'application/json', 'Content-Length': String(payload.length), Accept: '*/*' }
          : { Accept: 'application/json' },
      },
      (res) => {
        /** @type {Buffer[]} */
        const chunks = [];
        let size = 0;
        const max = opts.maxBytes ?? 64 * 1024 * 1024;
        res.on('data', (d) => {
          size += d.length;
          if (size > max) {
            req.destroy(new Error('Phonon response too large'));
            return;
          }
          chunks.push(d);
        });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
        res.on('error', reject);
      },
    );
    const timer = setTimeout(() => req.destroy(new Error('Phonon request timed out')), opts.timeoutMs);
    req.on('close', () => clearTimeout(timer));
    req.on('error', reject);
    req.end(payload);
  });
}

export class Phonon {
  /** @param {import('./config.js').Config} config */
  constructor(config) {
    this.url = config.phononUrl;
    this.lang = config.phononLang;
    this.timeoutMs = config.phononTimeoutMs;
    this.limiter = new Semaphore(config.phononConcurrency, 32);
    /** @type {string[] | null} command + leading args for CLI mode */
    this.cmd = null;
    if (!this.url) {
      const parts = (config.phononCmd || 'ptts').trim().split(/\s+/);
      const exe = which(parts[0]);
      if (exe) this.cmd = [exe, ...parts.slice(1)];
    }
    /** @type {{ at: number, ok: boolean } | null} */
    this.probe = null;
    /** @type {Promise<boolean> | null} */
    this.probePending = null;
    /** @type {{ at: number, voices: Array<{ name: string, locale?: string, description?: string }> } | null} */
    this.voiceCache = null;
    /** @type {Set<import('node:child_process').ChildProcess>} */
    this.children = new Set();
  }

  /** 'http' | 'cli' | null */
  get mode() {
    return this.url ? 'http' : this.cmd ? 'cli' : null;
  }

  close() {
    for (const c of this.children) c.kill('SIGTERM');
  }

  /** Whether the backend is configured and answering (cached briefly). */
  async available() {
    if (!this.mode) return false;
    const p = this.probe;
    if (p && Date.now() - p.at < PROBE_TTL_MS) return p.ok;
    if (!this.probePending) {
      this.probePending = this.#probe()
        .catch(() => false)
        .then((ok) => {
          this.probe = { at: Date.now(), ok };
          this.probePending = null;
          return ok;
        });
    }
    return this.probePending;
  }

  async #probe() {
    if (this.mode === 'http') {
      const r = await request(`${this.url}/health`, { timeoutMs: 3000, maxBytes: 64 * 1024 });
      return r.status === 200;
    }
    const out = await this.#run(['--version'], 15_000);
    return out.length > 0;
  }

  /**
   * @param {string[]} args
   * @param {number} timeoutMs
   * @returns {Promise<string>} stdout
   */
  #run(args, timeoutMs) {
    const [exe, ...pre] = /** @type {string[]} */ (this.cmd);
    return new Promise((resolve, reject) => {
      const child = execFile(
        exe,
        [...pre, ...args],
        { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, windowsHide: true, env: process.env },
        (err, stdout, stderr) => {
          this.children.delete(child);
          if (err) {
            const detail = String(stderr || '').trim().split('\n').slice(-1)[0] || err.message;
            reject(new Error(`ptts failed: ${detail}`));
          } else resolve(String(stdout));
        },
      );
      this.children.add(child);
    });
  }

  /** @returns {Promise<Array<{ name: string, locale?: string, description?: string }>>} */
  async listVoices() {
    if (!this.mode) throw new HttpError(503, 'Server-side Phonon is not configured');
    const c = this.voiceCache;
    if (c && Date.now() - c.at < VOICE_TTL_MS) return c.voices;
    /** @type {Array<{ name: string, locale?: string, description?: string }>} */
    let voices = [];
    try {
      if (this.mode === 'http') {
        const r = await request(`${this.url}/v1/audio/voices`, { timeoutMs: 10_000, maxBytes: 4 * 1024 * 1024 });
        if (r.status !== 200) throw new Error(`status ${r.status}`);
        const data = JSON.parse(r.body.toString('utf8'));
        const list = Array.isArray(data?.voices) ? data.voices : [];
        voices = list
          .map((/** @type {unknown} */ v) => (typeof v === 'string' ? v : /** @type {any} */ (v)?.name))
          .filter((/** @type {unknown} */ n) => typeof n === 'string' && n)
          .map((/** @type {string} */ name) => ({ name }));
      } else {
        // "Name<TAB>lang<TAB>id<TAB>description" per line.
        const out = await this.#run(['--list-voices'], 60_000);
        for (const line of out.split('\n')) {
          const [name, lang, , desc] = line.split('\t');
          if (!name || !lang) continue;
          if (this.lang !== 'none' && lang.trim() !== this.lang) continue;
          voices.push({ name: name.trim(), locale: lang.trim(), description: desc?.trim() || undefined });
        }
      }
    } catch (err) {
      if (c) return c.voices;
      console.error('[openspeek] phonon voices failed:', /** @type {Error} */ (err).message);
      throw new HttpError(502, 'Could not list Phonon voices');
    }
    voices.sort((a, b) => a.name.localeCompare(b.name));
    this.voiceCache = { at: Date.now(), voices };
    return voices;
  }

  /**
   * @param {string} text
   * @param {string | null | undefined} voice
   * @returns {Promise<Buffer>} WAV bytes
   */
  async synthesize(text, voice) {
    if (!this.mode) throw new HttpError(503, 'Server-side Phonon is not configured');
    if (voice != null && (typeof voice !== 'string' || !VOICE_RE.test(voice))) {
      throw new HttpError(400, 'Invalid Phonon voice name');
    }
    return this.limiter.run(() => (this.mode === 'http' ? this.#synthHttp(text, voice) : this.#synthCli(text, voice)));
  }

  /**
   * @param {string} text
   * @param {string | null | undefined} voice
   */
  async #synthHttp(text, voice) {
    let r;
    for (let attempt = 0; ; attempt++) {
      try {
        r = await request(`${this.url}/v1/audio/speech`, {
          method: 'POST',
          body: { model: 'tts-1', input: text, voice: voice || 'default', response_format: 'wav' },
          timeoutMs: this.timeoutMs,
        });
      } catch (err) {
        this.probe = null;
        console.error('[openspeek] phonon request failed:', /** @type {Error} */ (err).message);
        throw new HttpError(502, 'Phonon backend is unreachable');
      }
      // The backend runs a fixed number of generations and answers 429 server_busy otherwise.
      if (r.status === 429 && attempt < 20) {
        await new Promise((res) => setTimeout(res, 250 + attempt * 100));
        continue;
      }
      break;
    }
    if (r.status !== 200) {
      let msg = `Phonon backend error (${r.status})`;
      try {
        const e = JSON.parse(r.body.toString('utf8'));
        if (typeof e?.error?.message === 'string') msg = `Phonon: ${e.error.message.slice(0, 300)}`;
      } catch {
        /* keep generic */
      }
      throw new HttpError(r.status === 400 ? 400 : 502, msg);
    }
    return fixWavHeader(r.body);
  }

  /**
   * @param {string} text
   * @param {string | null | undefined} voice
   */
  async #synthCli(text, voice) {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'openspeek-ptts-'));
    const out = path.join(dir, `${randomUUID()}.wav`);
    try {
      const args = ['--lang', this.lang];
      if (voice) args.push('--voice', voice);
      args.push('-o', out, '--', text);
      try {
        await this.#run(args, this.timeoutMs);
      } catch (err) {
        console.error('[openspeek]', /** @type {Error} */ (err).message);
        throw new HttpError(502, 'Phonon synthesis failed');
      }
      return fixWavHeader(await readFile(out));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}
