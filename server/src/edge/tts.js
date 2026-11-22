/**
 * Edge TTS client: Microsoft Edge's online read-aloud voices over the service's WebSocket
 * protocol (reference: rany2/edge-tts). This is an unofficial use of the service.
 */
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import zlib from 'node:zlib';
import WebSocket from 'ws';
import { HttpError } from '../http-util.js';
import { Semaphore } from '../limits.js';
import { bypassesProxy, openSocket } from '../net.js';
import {
  BASE_HOST,
  MP3_BITRATE_BPS,
  OUTPUT_FORMAT,
  SEC_MS_GEC_VERSION,
  TICKS_PER_SECOND,
  VOICE_HEADERS,
  VOICE_LIST_URL,
  WSS_HEADERS,
  WSS_ORIGIN,
  WSS_URL,
} from './constants.js';
import { adjustClockSkew, currentGec, generateMuid } from './drm.js';
import { makeSsml, splitForService, unescapeXml } from './ssml.js';
import { mapWordBoundaries } from './words.js';

const VOICE_CACHE_MS = 6 * 60 * 60 * 1000;
const VOICE_NAME_RE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*-[A-Za-z0-9]+Neural$/;

/** An error worth one retry (network trouble, 403 clock skew, service hiccup). */
class TransientError extends Error {}

/**
 * JavaScript-style date string the service expects in X-Timestamp.
 * @param {Date} [d]
 */
export function dateToString(d = new Date()) {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const p = (/** @type {number} */ n) => String(n).padStart(2, '0');
  return (
    `${days[d.getUTCDay()]} ${months[d.getUTCMonth()]} ${p(d.getUTCDate())} ${d.getUTCFullYear()} ` +
    `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} GMT+0000 (Coordinated Universal Time)`
  );
}

/**
 * Parse "Key:Value\r\n" header lines.
 * @param {string} head
 */
function parseHeaders(head) {
  /** @type {Record<string, string>} */
  const h = {};
  for (const line of head.split('\r\n')) {
    const i = line.indexOf(':');
    if (i > 0) h[line.slice(0, i)] = line.slice(i + 1);
  }
  return h;
}

/**
 * @typedef {object} EdgeVoice
 * @property {string} name
 * @property {string} [gender]
 * @property {string} [locale]
 * @property {string} [description]
 */

/**
 * Convert the service's voice entry to the API shape.
 * @param {any} v
 * @returns {EdgeVoice | null}
 */
export function toVoiceInfo(v) {
  if (!v || typeof v.ShortName !== 'string') return null;
  const friendly = typeof v.FriendlyName === 'string' ? v.FriendlyName : '';
  // "Microsoft Aria Online (Natural) - English (United States)" -> "Aria (United States)"
  const m = friendly.match(/^Microsoft (.+?) Online.*? - [^()]+?(?: \((.+)\))?$/);
  let description = friendly;
  if (m) description = m[2] ? `${m[1]} (${m[2]})` : m[1];
  return {
    name: v.ShortName,
    gender: typeof v.Gender === 'string' ? v.Gender : undefined,
    locale: typeof v.Locale === 'string' ? v.Locale : undefined,
    description: description || undefined,
  };
}

/**
 * English first, then by locale and name.
 * @param {Array<{ name: string, locale?: string }>} voices
 */
export function sortVoices(voices) {
  const isEn = (/** @type {{ locale?: string }} */ v) => (v.locale ?? '').toLowerCase().startsWith('en');
  return voices.sort((a, b) => {
    const ea = isEn(a) ? 0 : 1;
    const eb = isEn(b) ? 0 : 1;
    if (ea !== eb) return ea - eb;
    return (a.locale ?? '').localeCompare(b.locale ?? '') || a.name.localeCompare(b.name);
  });
}

export class EdgeTts {
  /**
   * @param {import('../config.js').Config} config
   */
  constructor(config) {
    this.config = config;
    this.defaultVoice = config.edgeDefaultVoice;
    this.timeoutMs = config.edgeTimeoutMs;
    this.proxyUrl = config.httpsProxy && !bypassesProxy(BASE_HOST, config.noProxy) ? config.httpsProxy : '';
    this.limiter = new Semaphore(config.edgeConcurrency, 64);
    /** @type {{ at: number, voices: EdgeVoice[] } | null} */
    this.voiceCache = null;
    /** @type {Promise<EdgeVoice[]> | null} */
    this.voicePending = null;
    /** @type {Set<WebSocket>} */
    this.sockets = new Set();
  }

  /** Close open connections (shutdown). */
  close() {
    for (const ws of this.sockets) ws.terminate();
  }

  /** @returns {Promise<import('node:net').Socket>} */
  #connect() {
    return openSocket({
      address: BASE_HOST,
      port: 443,
      secure: true,
      servername: BASE_HOST,
      proxyUrl: this.proxyUrl,
      timeoutMs: 10_000,
    });
  }

  // ───────────── voices ─────────────

  /** @returns {Promise<EdgeVoice[]>} */
  async listVoices() {
    const c = this.voiceCache;
    if (c && Date.now() - c.at < VOICE_CACHE_MS) return c.voices;
    if (!this.voicePending) {
      this.voicePending = this.#fetchVoicesWithRetry()
        .then((voices) => {
          this.voiceCache = { at: Date.now(), voices };
          return voices;
        })
        .catch((err) => {
          if (c) return c.voices; // serve stale on failure
          throw err;
        })
        .finally(() => {
          this.voicePending = null;
        });
    }
    return this.voicePending;
  }

  async #fetchVoicesWithRetry() {
    try {
      return await this.#fetchVoices();
    } catch (err) {
      if (!(err instanceof TransientError)) throw err;
      return this.#fetchVoices();
    }
  }

  /** @returns {Promise<EdgeVoice[]>} */
  async #fetchVoices() {
    const url = new URL(`${VOICE_LIST_URL}&Sec-MS-GEC=${currentGec()}&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}`);
    let socket;
    try {
      socket = await this.#connect();
    } catch (err) {
      throw new TransientError(`could not reach Edge TTS: ${/** @type {Error} */ (err).message}`);
    }
    const body = await new Promise((resolve, reject) => {
      const req = http.request(
        {
          createConnection: () => socket,
          method: 'GET',
          path: url.pathname + url.search,
          setHost: false,
          headers: {
            ...VOICE_HEADERS,
            'Accept-Encoding': 'gzip, deflate, br',
            Host: BASE_HOST,
            Cookie: `muid=${generateMuid()};`,
            Connection: 'close',
          },
          timeout: this.timeoutMs,
        },
        (res) => {
          if (res.statusCode === 403) {
            adjustClockSkew(res.headers.date);
            res.resume();
            reject(new TransientError('Edge TTS refused the voice list request (403)'));
            return;
          }
          if (res.statusCode !== 200) {
            res.resume();
            const E = (res.statusCode ?? 500) >= 500 ? TransientError : Error;
            reject(new E(`Edge TTS voice list failed (${res.statusCode})`));
            return;
          }
          /** @type {NodeJS.ReadableStream} */
          let stream = res;
          const enc = String(res.headers['content-encoding'] || '').toLowerCase();
          if (enc === 'gzip') stream = res.pipe(zlib.createGunzip());
          else if (enc === 'deflate') stream = res.pipe(zlib.createInflate());
          else if (enc === 'br') stream = res.pipe(zlib.createBrotliDecompress());
          /** @type {Buffer[]} */
          const chunks = [];
          let size = 0;
          stream.on('data', (/** @type {Buffer} */ d) => {
            size += d.length;
            if (size > 8 * 1024 * 1024) {
              req.destroy(new Error('voice list too large'));
              return;
            }
            chunks.push(d);
          });
          stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
          stream.on('error', reject);
        },
      );
      req.on('timeout', () => req.destroy(new TransientError('Edge TTS voice list timed out')));
      req.on('error', (err) => reject(err instanceof TransientError ? err : new TransientError(err.message)));
      req.end();
    });
    /** @type {unknown} */
    let data;
    try {
      data = JSON.parse(body);
    } catch {
      throw new Error('Edge TTS returned an invalid voice list');
    }
    if (!Array.isArray(data)) throw new Error('Edge TTS returned an invalid voice list');
    return sortVoices(/** @type {EdgeVoice[]} */ (data.map(toVoiceInfo).filter(Boolean)));
  }

  // ───────────── synthesis ─────────────

  /**
   * @param {string | null | undefined} voice
   */
  resolveVoice(voice) {
    const v = voice || this.defaultVoice;
    if (!VOICE_NAME_RE.test(v) || v.length > 100) throw new HttpError(400, `Unknown Edge voice: ${String(voice).slice(0, 100)}`);
    const cached = this.voiceCache?.voices;
    if (cached && cached.length && !cached.some((x) => x.name === v)) {
      throw new HttpError(400, `Unknown Edge voice: ${v}`);
    }
    return v;
  }

  /**
   * Synthesise `text`. Returns MP3 audio and word timings mapped onto `text`.
   * @param {string} text
   * @param {string | null | undefined} voice
   * @returns {Promise<{ audio: Buffer, words: import('./words.js').WordTiming[] }>}
   */
  async synthesize(text, voice) {
    const v = this.resolveVoice(voice);
    return this.limiter.run(async () => {
      /** @type {Buffer[]} */
      const audio = [];
      /** @type {import('./words.js').Boundary[]} */
      const boundaries = [];
      let compensation = 0;
      let totalBytes = 0;
      for (const piece of splitForService(text)) {
        let result;
        try {
          result = await this.#synthOnce(piece.text, v);
        } catch (err) {
          if (!(err instanceof TransientError)) throw err;
          result = await this.#synthOnce(piece.text, v); // one retry
        }
        for (const b of result.boundaries) boundaries.push({ ...b, offset: b.offset + compensation });
        audio.push(...result.audio);
        // CBR stream: elapsed ticks follow exactly from byte count (as the reference does).
        totalBytes += result.audio.reduce((n, a) => n + a.length, 0);
        compensation = Math.floor((totalBytes * 8 * TICKS_PER_SECOND) / MP3_BITRATE_BPS);
      }
      const buf = Buffer.concat(audio);
      if (!buf.length) throw new HttpError(502, 'Edge TTS returned no audio');
      return { audio: buf, words: mapWordBoundaries(text, boundaries) };
    });
  }

  /**
   * One WebSocket session: speech.config, SSML, collect audio + boundaries until turn.end.
   * @param {string} text
   * @param {string} voice
   * @returns {Promise<{ audio: Buffer[], boundaries: import('./words.js').Boundary[] }>}
   */
  async #synthOnce(text, voice) {
    let socket;
    try {
      socket = await this.#connect();
    } catch (err) {
      throw new TransientError(`could not reach Edge TTS: ${/** @type {Error} */ (err).message}`);
    }
    const url =
      `${WSS_URL}&ConnectionId=${randomUUID().replace(/-/g, '')}` +
      `&Sec-MS-GEC=${currentGec()}&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}`;

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url, {
        createConnection: () => /** @type {any} */ (socket),
        origin: WSS_ORIGIN,
        headers: { ...WSS_HEADERS, Cookie: `muid=${generateMuid()};` },
        handshakeTimeout: 10_000,
        perMessageDeflate: true,
        maxPayload: 16 * 1024 * 1024,
      });
      this.sockets.add(ws);
      /** @type {Buffer[]} */
      const audio = [];
      /** @type {import('./words.js').Boundary[]} */
      const boundaries = [];
      let settled = false;
      let timer = setTimeout(() => finish(new TransientError('Edge TTS timed out')), this.timeoutMs);

      /** @param {Error | null} err */
      const finish = (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.sockets.delete(ws);
        try {
          ws.terminate();
        } catch {
          /* ignore */
        }
        if (err) reject(err);
        else if (!audio.length) reject(new TransientError('Edge TTS returned no audio'));
        else resolve({ audio, boundaries });
      };

      ws.on('unexpected-response', (_req, res) => {
        const status = res.statusCode ?? 0;
        res.resume();
        if (status === 403) {
          adjustClockSkew(res.headers.date);
          finish(new TransientError('Edge TTS refused the connection (403)'));
        } else if (status === 429 || status >= 500) {
          finish(new TransientError(`Edge TTS is unavailable (${status})`));
        } else {
          finish(new HttpError(502, `Edge TTS refused the request (${status})`));
        }
      });
      ws.on('error', (err) => finish(new TransientError(`Edge TTS connection failed: ${err.message}`)));
      ws.on('close', () => finish(new TransientError('Edge TTS closed the connection early')));

      ws.on('open', () => {
        const ts = dateToString();
        ws.send(
          `X-Timestamp:${ts}\r\n` +
            'Content-Type:application/json; charset=utf-8\r\n' +
            'Path:speech.config\r\n\r\n' +
            '{"context":{"synthesis":{"audio":{"metadataoptions":{' +
            '"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"true"},' +
            `"outputFormat":"${OUTPUT_FORMAT}"}}}}\r\n`,
        );
        ws.send(
          `X-RequestId:${randomUUID().replace(/-/g, '')}\r\n` +
            'Content-Type:application/ssml+xml\r\n' +
            `X-Timestamp:${ts}Z\r\n` + // the trailing Z mirrors Edge itself
            'Path:ssml\r\n\r\n' +
            makeSsml(voice, text),
        );
      });

      ws.on('message', (data, isBinary) => {
        // Any traffic resets the idle timer.
        clearTimeout(timer);
        timer = setTimeout(() => finish(new TransientError('Edge TTS timed out')), this.timeoutMs);
        const buf = Buffer.isBuffer(data) ? data : Buffer.concat(/** @type {Buffer[]} */ (Array.isArray(data) ? data : [Buffer.from(/** @type {ArrayBuffer} */ (data))]));
        if (!isBinary) {
          const str = buf.toString('utf8');
          const sep = str.indexOf('\r\n\r\n');
          const headers = parseHeaders(sep >= 0 ? str.slice(0, sep) : str);
          const body = sep >= 0 ? str.slice(sep + 4) : '';
          const path = headers.Path;
          if (path === 'audio.metadata') {
            try {
              const meta = JSON.parse(body);
              for (const m of meta.Metadata ?? []) {
                if (m.Type !== 'WordBoundary') continue;
                const d = m.Data ?? {};
                const t = d.text?.Text;
                if (typeof d.Offset !== 'number' || typeof t !== 'string') continue;
                boundaries.push({ offset: d.Offset, duration: Number(d.Duration) || 0, text: unescapeXml(t) });
              }
            } catch {
              /* ignore malformed metadata */
            }
          } else if (path === 'turn.end') {
            finish(null);
          }
          return;
        }
        if (buf.length < 2) return;
        const headerLen = buf.readUInt16BE(0);
        if (headerLen + 2 > buf.length) return;
        const headers = parseHeaders(buf.subarray(2, 2 + headerLen).toString('utf8'));
        if (headers.Path !== 'audio') return;
        const payload = buf.subarray(2 + headerLen);
        if (payload.length && headers['Content-Type'] === 'audio/mpeg') audio.push(Buffer.from(payload));
      });
    });
  }
}
