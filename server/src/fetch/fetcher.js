/**
 * Fetch a public web page for the importer, with SSRF protection:
 *  - only http/https, only ports 80/443, no credentials in the URL;
 *  - the host name is resolved here and every address checked (see ssrf.js); a host with any
 *    non-public address is refused;
 *  - without a proxy, the socket is opened to the vetted address itself, so nothing re-resolves
 *    the name between check and use; TLS is still verified against the host name;
 *  - with HTTPS_PROXY set, the tunnel is opened with CONNECT <host name>:<port> by default
 *    (many egress proxies only accept names), after the same local vetting. The proxy then
 *    resolves the name again, so a DNS-rebinding race remains on this path unless the proxy
 *    itself blocks private destinations; set FETCH_PROXY_PIN_IP=1 to CONNECT to the vetted IP
 *    instead when your proxy accepts that;
 *  - redirects are followed manually (max 5), each one re-validated;
 *  - 10 s overall timeout, 5 MB cap (after decompression), HTML content types only.
 */
import dns from 'node:dns/promises';
import http from 'node:http';
import net from 'node:net';
import zlib from 'node:zlib';
import { HttpError } from '../http-util.js';
import { openSocket } from '../net.js';
import { blockedReason } from './ssrf.js';

export const FETCH_TIMEOUT_MS = 10_000;
export const FETCH_MAX_BYTES = 5 * 1024 * 1024;
export const FETCH_MAX_REDIRECTS = 5;
const ALLOWED_PORTS = new Set([80, 443]);
const HTML_TYPES = new Set(['text/html', 'application/xhtml+xml']);
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36';

/**
 * Parse and check a URL string. Throws HttpError(400) when unacceptable.
 * @param {string} raw
 * @param {URL} [base]
 * @param {Set<number>} [allowedPorts]  Tests only.
 * @returns {URL}
 */
export function validateUrl(raw, base, allowedPorts = ALLOWED_PORTS) {
  let u;
  try {
    u = new URL(raw, base);
  } catch {
    throw new HttpError(400, 'Invalid URL');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new HttpError(400, 'Only http and https URLs can be fetched');
  if (u.username || u.password) throw new HttpError(400, 'URLs with credentials are not allowed');
  const port = Number(u.port) || (u.protocol === 'https:' ? 443 : 80);
  if (!allowedPorts.has(port)) throw new HttpError(400, 'Only the standard ports 80 and 443 are allowed');
  if (!u.hostname) throw new HttpError(400, 'Invalid URL');
  return u;
}

/**
 * Resolve a URL's host and return one vetted address. Throws HttpError(403) if any address
 * is not public.
 * @param {URL} u
 * @param {(host: string) => Promise<Array<{ address: string, family: number }>>} [lookup]
 * @param {(ip: string) => boolean} [isAllowed]  Tests only.
 * @returns {Promise<string>}
 */
export async function resolvePublicAddress(u, lookup = defaultLookup, isAllowed = (/** @type {string} */ ip) => blockedReason(ip) === null) {
  const host = u.hostname.replace(/^\[|\]$/g, '');
  /** @type {string[]} */
  let addrs;
  if (net.isIP(host)) addrs = [host];
  else {
    if (/^localhost\.?$|\.localhost\.?$/i.test(host)) {
      throw new HttpError(403, 'Refusing to fetch a local address');
    }
    try {
      addrs = (await lookup(host)).map((a) => a.address);
    } catch {
      throw new HttpError(502, 'Could not resolve the host name');
    }
  }
  if (!addrs.length) throw new HttpError(502, 'Could not resolve the host name');
  for (const a of addrs) {
    if (!isAllowed(a)) throw new HttpError(403, 'Refusing to fetch a private or local address');
  }
  return addrs[0];
}

/** @param {string} host */
async function defaultLookup(host) {
  return dns.lookup(host, { all: true, verbatim: true });
}

/**
 * Find a charset: Content-Type, then BOM, then <meta> in the first 4 KB. Defaults to UTF-8.
 * @param {string | undefined} contentType
 * @param {Buffer} body
 */
export function detectCharset(contentType, body) {
  const fromHeader = /charset\s*=\s*"?([\w.:-]+)/i.exec(contentType || '')?.[1];
  if (fromHeader) return fromHeader;
  if (body[0] === 0xef && body[1] === 0xbb && body[2] === 0xbf) return 'utf-8';
  if (body[0] === 0xff && body[1] === 0xfe) return 'utf-16le';
  if (body[0] === 0xfe && body[1] === 0xff) return 'utf-16be';
  const head = body.subarray(0, 4096).toString('latin1');
  const meta =
    /<meta[^>]+charset\s*=\s*["']?\s*([\w.:-]+)/i.exec(head)?.[1] ??
    /<meta[^>]+content\s*=\s*["'][^"']*charset\s*=\s*([\w.:-]+)/i.exec(head)?.[1];
  return meta || 'utf-8';
}

/**
 * @param {Buffer} body
 * @param {string} charset
 */
export function decodeBody(body, charset) {
  let decoder;
  try {
    decoder = new TextDecoder(charset.toLowerCase());
  } catch {
    decoder = new TextDecoder('utf-8');
  }
  return decoder.decode(body);
}

/**
 * One HTTP exchange against a vetted address. Resolves with status, headers and (for 2xx) body.
 * @param {URL} u
 * @param {string} address
 * @param {{ proxyUrl: string, pinIp: boolean, signal: AbortSignal, deadline: number }} ctx
 * @returns {Promise<{ status: number, headers: import('node:http').IncomingHttpHeaders, body: Buffer | null }>}
 */
async function exchange(u, address, ctx) {
  const secure = u.protocol === 'https:';
  const port = Number(u.port) || (secure ? 443 : 80);
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const socket = await openSocket({
    // Direct connections always go to the vetted IP; through a proxy, by name unless pinned.
    address: ctx.proxyUrl && !ctx.pinIp ? host : address,
    port,
    secure,
    servername: host,
    proxyUrl: ctx.proxyUrl,
    timeoutMs: Math.max(1, ctx.deadline - Date.now()),
  });
  if (ctx.signal.aborted) {
    socket.destroy();
    throw new HttpError(504, 'Fetching the page timed out');
  }
  return new Promise((resolve, reject) => {
    const req = http.request({
      createConnection: () => socket,
      method: 'GET',
      path: u.pathname + u.search,
      setHost: false,
      headers: {
        Host: u.host,
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        Connection: 'close',
      },
    });
    const onAbort = () => req.destroy(new HttpError(504, 'Fetching the page timed out'));
    ctx.signal.addEventListener('abort', onAbort, { once: true });
    req.on('close', () => ctx.signal.removeEventListener('abort', onAbort));
    req.on('error', (err) => {
      reject(err instanceof HttpError ? err : new HttpError(502, 'Could not fetch the page'));
    });
    req.on('response', (res) => {
      const status = res.statusCode ?? 0;
      if (status < 200 || status >= 300) {
        res.resume();
        resolve({ status, headers: res.headers, body: null });
        req.destroy();
        return;
      }
      const type = String(res.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      if (!HTML_TYPES.has(type)) {
        req.destroy();
        reject(new HttpError(415, `Not an HTML page (${type || 'no content type'})`));
        return;
      }
      const declared = Number(res.headers['content-length']);
      if (Number.isFinite(declared) && declared > FETCH_MAX_BYTES) {
        req.destroy();
        reject(new HttpError(413, 'The page is too large'));
        return;
      }
      /** @type {NodeJS.ReadableStream} */
      let stream = res;
      const enc = String(res.headers['content-encoding'] || 'identity').toLowerCase().trim();
      if (enc === 'gzip' || enc === 'x-gzip') stream = res.pipe(zlib.createGunzip());
      else if (enc === 'deflate') stream = res.pipe(zlib.createInflate());
      else if (enc === 'br') stream = res.pipe(zlib.createBrotliDecompress());
      else if (enc !== 'identity') {
        req.destroy();
        reject(new HttpError(502, 'The page uses an unsupported encoding'));
        return;
      }
      /** @type {Buffer[]} */
      const chunks = [];
      let size = 0;
      stream.on('data', (/** @type {Buffer} */ d) => {
        size += d.length;
        if (size > FETCH_MAX_BYTES) {
          req.destroy();
          reject(new HttpError(413, 'The page is too large'));
          return;
        }
        chunks.push(d);
      });
      stream.on('end', () => resolve({ status, headers: res.headers, body: Buffer.concat(chunks) }));
      stream.on('error', () => reject(new HttpError(502, 'Could not decode the page')));
    });
    req.end();
  });
}

/**
 * @typedef {object} FetchOptions
 * @property {string} [proxyUrl]   HTTP proxy for outbound connections ('' = direct).
 * @property {boolean} [pinIp]      Through a proxy, CONNECT to the vetted IP instead of the name.
 * @property {(ip: string) => boolean} [isAllowed]  Tests only: override the address policy.
 * @property {Set<number>} [allowedPorts]           Tests only: override the port policy.
 * @property {(host: string) => Promise<Array<{ address: string, family: number }>>} [lookup]
 */

/**
 * Fetch a page. Returns its HTML decoded to a JS string, and the final URL.
 * @param {string} rawUrl
 * @param {FetchOptions} [opts]
 * @returns {Promise<{ html: string, url: string }>}
 */
export async function fetchPage(rawUrl, opts = {}) {
  const deadline = Date.now() + FETCH_TIMEOUT_MS;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  try {
    let u = validateUrl(rawUrl, undefined, opts.allowedPorts);
    for (let hop = 0; ; hop++) {
      const address = await resolvePublicAddress(u, opts.lookup, opts.isAllowed);
      if (ac.signal.aborted) throw new HttpError(504, 'Fetching the page timed out');
      let r;
      try {
        r = await exchange(u, address, { proxyUrl: opts.proxyUrl ?? '', pinIp: opts.pinIp ?? false, signal: ac.signal, deadline });
      } catch (err) {
        if (err instanceof HttpError) throw err;
        if (ac.signal.aborted) throw new HttpError(504, 'Fetching the page timed out');
        throw new HttpError(502, 'Could not connect to the site');
      }
      if ([301, 302, 303, 307, 308].includes(r.status)) {
        const loc = r.headers.location;
        if (!loc) throw new HttpError(502, 'Redirect without a location');
        if (hop >= FETCH_MAX_REDIRECTS) throw new HttpError(502, 'Too many redirects');
        u = validateUrl(loc, u, opts.allowedPorts);
        continue;
      }
      if (!r.body) throw new HttpError(502, `The site answered ${r.status}`);
      const charset = detectCharset(/** @type {string | undefined} */ (r.headers['content-type']), r.body);
      return { html: decodeBody(r.body, charset), url: u.href };
    }
  } finally {
    clearTimeout(timer);
  }
}
