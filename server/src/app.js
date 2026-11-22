/**
 * Request routing for the openSpeek server. `createApp` returns a Node request handler plus a
 * `close()` for shutdown; `index.js` binds it to a port. Dependencies can be injected for tests.
 */
import { EdgeTts } from './edge/tts.js';
import { FeedbackStore, charCount, validateFeedback } from './feedback.js';
import { fetchPage } from './fetch/fetcher.js';
import { HttpError, readJsonBody, sendError, sendJson } from './http-util.js';
import { RateLimiter } from './limits.js';
import { Phonon } from './phonon.js';
import { StaticFiles } from './static.js';

const ENGINES = new Set(['edge', 'phonon']);

/**
 * @typedef {object} Deps
 * @property {Pick<EdgeTts, 'listVoices' | 'synthesize' | 'close'>} [edge]
 * @property {Pick<Phonon, 'available' | 'listVoices' | 'synthesize' | 'close'>} [phonon]
 * @property {(url: string) => Promise<{ html: string, url: string }>} [fetchPage]
 * @property {FeedbackStore} [feedback]
 */

/**
 * @param {import('./config.js').Config} config
 * @param {Deps} [deps]
 */
export function createApp(config, deps = {}) {
  const edge = deps.edge ?? new EdgeTts(config);
  const phonon = deps.phonon ?? new Phonon(config);
  const fetcher = deps.fetchPage ?? ((/** @type {string} */ url) => fetchPage(url, {
      proxyUrl: config.fetchUseProxy ? config.httpsProxy : '',
      pinIp: config.fetchProxyPinIp,
    }));
  const statics = new StaticFiles(config.staticDir);
  const ttsLimiter = new RateLimiter(config.ttsRatePerMinute);
  const fetchLimiter = new RateLimiter(config.fetchRatePerMinute);
  const feedbackLimiter = new RateLimiter(config.feedbackRatePerHour / 60, config.feedbackRatePerHour);
  const feedback = deps.feedback ?? new FeedbackStore({ dir: config.feedbackDir, maxFiles: config.feedbackMaxFiles });
  if (config.feedbackEnabled) void feedback.init(); // create the directory now; logs if it cannot
  const origins = config.corsOrigin.split(',').map((s) => s.trim()).filter(Boolean);

  /** @param {import('node:http').IncomingMessage} req */
  function clientIp(req) {
    if (config.trustProxy) {
      const xff = req.headers['x-forwarded-for'];
      const first = (Array.isArray(xff) ? xff[0] : xff)?.split(',')[0]?.trim();
      if (first) return first;
    }
    return req.socket.remoteAddress || 'unknown';
  }

  /**
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res
   */
  function setCors(req, res) {
    const origin = req.headers.origin;
    if (origins.includes('*')) res.setHeader('Access-Control-Allow-Origin', '*');
    else {
      res.setHeader('Vary', 'Origin');
      if (origin && origins.includes(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Expose-Headers', 'X-Final-Url');
    res.setHeader('Access-Control-Max-Age', '86400');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  }

  /**
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res
   * @param {URL} url
   */
  async function handleApi(req, res, url) {
    setCors(req, res);
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'Content-Length': '0' });
      res.end();
      return;
    }
    const route = url.pathname.replace(/\/+$/, '');
    /** @param {...string} methods */
    const allow = (...methods) => {
      if (!methods.includes(req.method ?? '')) {
        throw new HttpError(405, 'Method not allowed', { Allow: [...methods, 'OPTIONS'].join(', ') });
      }
    };

    switch (route) {
      case '/api/health': {
        allow('GET', 'HEAD');
        const phononOk = await phonon.available().catch(() => false);
        const feedbackOk = config.feedbackEnabled && (await feedback.available());
        sendJson(res, 200, {
          ok: true,
          engines: { edge: config.edgeEnabled, phonon: phononOk },
          fetch: config.fetchEnabled,
          feedback: feedbackOk,
        });
        return;
      }
      case '/api/voices': {
        allow('GET');
        const engine = url.searchParams.get('engine') ?? '';
        if (!ENGINES.has(engine)) throw new HttpError(400, 'engine must be "edge" or "phonon"');
        let voices;
        if (engine === 'edge') {
          if (!config.edgeEnabled) throw new HttpError(503, 'Edge TTS is disabled on this server');
          try {
            voices = await edge.listVoices();
          } catch (err) {
            if (err instanceof HttpError) throw err;
            console.error('[openspeek] edge voices failed:', /** @type {Error} */ (err).message);
            throw new HttpError(502, 'Could not list Edge voices');
          }
        } else {
          if (!(await phonon.available())) throw new HttpError(503, 'Server-side Phonon is not available');
          voices = await phonon.listVoices();
        }
        sendJson(res, 200, { voices }, { 'Cache-Control': 'public, max-age=600' });
        return;
      }
      case '/api/tts': {
        allow('POST');
        ttsLimiter.take(clientIp(req));
        const body = /** @type {any} */ (await readJsonBody(req, config.bodyLimit));
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Request body must be a JSON object');
        const { engine, text, voice } = body;
        if (typeof engine !== 'string' || !ENGINES.has(engine)) throw new HttpError(400, 'engine must be "edge" or "phonon"');
        if (typeof text !== 'string' || !text.trim()) throw new HttpError(400, 'text must be a non-empty string');
        if (text.length > config.maxTextLength) throw new HttpError(400, `text must be at most ${config.maxTextLength} characters`);
        if (voice !== undefined && voice !== null && (typeof voice !== 'string' || voice.length > 100)) {
          throw new HttpError(400, 'voice must be a string');
        }
        if (engine === 'edge') {
          if (!config.edgeEnabled) throw new HttpError(503, 'Edge TTS is disabled on this server');
          let r;
          try {
            r = await edge.synthesize(text, voice || null);
          } catch (err) {
            if (err instanceof HttpError) throw err;
            console.error('[openspeek] edge tts failed:', /** @type {Error} */ (err).message);
            throw new HttpError(502, 'Edge TTS failed, try again');
          }
          sendJson(res, 200, { format: 'mp3', audio: r.audio.toString('base64'), words: r.words });
        } else {
          const wav = await phonon.synthesize(text, voice || null);
          sendJson(res, 200, { format: 'wav', audio: wav.toString('base64') });
        }
        return;
      }
      case '/api/fetch': {
        allow('GET');
        if (!config.fetchEnabled) throw new HttpError(503, 'Page fetching is disabled on this server');
        fetchLimiter.take(clientIp(req));
        const target = url.searchParams.get('url');
        if (!target) throw new HttpError(400, 'Missing url parameter');
        if (target.length > 4096) throw new HttpError(400, 'URL too long');
        const page = await fetcher(target);
        const data = Buffer.from(page.html, 'utf8');
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Length': String(data.length),
          'Cache-Control': 'no-store',
          'X-Final-Url': encodeURI(page.url),
          'X-Content-Type-Options': 'nosniff',
          // Never let the fetched page run as this origin if opened directly.
          'Content-Security-Policy': "sandbox; default-src 'none'",
        });
        res.end(data);
        return;
      }
      case '/api/feedback': {
        if (!config.feedbackEnabled) throw new HttpError(404, 'Not found');
        allow('POST');
        feedbackLimiter.take(clientIp(req));
        if (!(await feedback.available())) {
          throw new HttpError(503, 'Feedback storage is not available on this server right now');
        }
        const type = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
        if (type !== 'application/json') throw new HttpError(415, 'Content-Type must be application/json');
        const input = validateFeedback(await readJsonBody(req, config.feedbackBodyLimit));
        const ua = req.headers['user-agent'];
        const id = await feedback.save({ ...input, userAgent: typeof ua === 'string' ? ua : undefined });
        console.log(`[openspeek] feedback ${id}: category=${input.category} length=${charCount(input.message)}`);
        sendJson(res, 201, { ok: true, id });
        return;
      }
      default:
        throw new HttpError(404, 'Not found');
    }
  }

  /**
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res
   */
  async function handler(req, res) {
    // Cross-origin isolation for the client's threaded WebAssembly, on every response.
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
    try {
      let url;
      try {
        url = new URL(req.url || '/', 'http://localhost');
      } catch {
        throw new HttpError(400, 'Bad request');
      }
      if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
        await handleApi(req, res, url);
        return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        throw new HttpError(405, 'Method not allowed', { Allow: 'GET, HEAD' });
      }
      const served = await statics.serve(req, res, url.pathname);
      if (!served) {
        const built = await statics.available();
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(built ? 'Not found' : 'openSpeek server is running, but the client is not built (run `npm run build`).');
      }
    } catch (err) {
      sendError(res, err);
    }
  }

  function close() {
    ttsLimiter.close();
    fetchLimiter.close();
    feedbackLimiter.close();
    edge.close();
    phonon.close();
  }

  return { handler, close };
}
