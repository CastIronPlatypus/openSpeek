import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * @param {string | undefined} v
 * @param {number} fallback
 * @param {number} [min]
 * @param {number} [max]
 */
function int(v, fallback, min = 0, max = Number.MAX_SAFE_INTEGER) {
  if (v === undefined || v.trim() === '') return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/**
 * @param {string | undefined} v
 * @param {boolean} fallback
 */
function bool(v, fallback) {
  if (v === undefined || v.trim() === '') return fallback;
  return !/^(0|false|no|off)$/i.test(v.trim());
}

/**
 * @typedef {object} Config
 * @property {number} port
 * @property {string} host
 * @property {string} staticDir      Directory holding the Vite build.
 * @property {string} corsOrigin     `*`, one origin, or a comma separated list.
 * @property {boolean} trustProxy    Use X-Forwarded-For for rate limiting.
 * @property {number} bodyLimit      Max JSON body bytes.
 * @property {number} maxTextLength  Max characters per TTS request.
 * @property {number} ttsRatePerMinute
 * @property {number} fetchRatePerMinute
 * @property {boolean} edgeEnabled
 * @property {string} edgeDefaultVoice
 * @property {number} edgeConcurrency
 * @property {number} edgeTimeoutMs
 * @property {string} phononUrl      OpenAI-compatible Phonon server base URL ('' = unset).
 * @property {string} phononCmd      Local `ptts` command ('' = look for `ptts` on PATH).
 * @property {string} phononLang
 * @property {number} phononConcurrency
 * @property {number} phononTimeoutMs
 * @property {boolean} fetchEnabled
 * @property {string} httpsProxy     Outbound proxy for Edge and page fetches ('' = direct).
 * @property {string} noProxy
 */

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Config}
 */
export function loadConfig(env = process.env) {
  return {
    port: int(env.PORT, 8787, 0, 65535),
    host: env.HOST || '0.0.0.0',
    staticDir: path.resolve(env.STATIC_DIR || path.join(here, '..', '..', 'dist')),
    corsOrigin: env.CORS_ORIGIN || '*',
    trustProxy: bool(env.TRUST_PROXY, false),
    bodyLimit: int(env.BODY_LIMIT, 16 * 1024, 1024, 1024 * 1024),
    maxTextLength: 2000,
    ttsRatePerMinute: int(env.TTS_RATE_LIMIT, 120, 0),
    fetchRatePerMinute: int(env.FETCH_RATE_LIMIT, 30, 0),
    edgeEnabled: bool(env.EDGE_TTS, true),
    edgeDefaultVoice: env.EDGE_DEFAULT_VOICE || 'en-US-AriaNeural',
    edgeConcurrency: int(env.EDGE_CONCURRENCY, 4, 1, 64),
    edgeTimeoutMs: int(env.EDGE_TIMEOUT_MS, 30000, 1000),
    phononUrl: (env.PHONON_URL || '').replace(/\/+$/, ''),
    phononCmd: env.PHONON_CMD || '',
    phononLang: env.PHONON_LANG || 'en',
    phononConcurrency: int(env.PHONON_CONCURRENCY, 1, 1, 32),
    phononTimeoutMs: int(env.PHONON_TIMEOUT_MS, 120000, 1000),
    fetchEnabled: bool(env.FETCH, true),
    httpsProxy: env.HTTPS_PROXY || env.https_proxy || '',
    noProxy: env.NO_PROXY || env.no_proxy || '',
  };
}
