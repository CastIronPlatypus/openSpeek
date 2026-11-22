import assert from 'node:assert/strict';
import http from 'node:http';
import zlib from 'node:zlib';
import { after, before, test } from 'node:test';
import { fetchPage } from '../src/fetch/fetcher.js';
import { blockedReason } from '../src/fetch/ssrf.js';
import { HttpError } from '../src/http-util.js';

// A local site stands in for the internet. `public.test` resolves (via the injected lookup)
// to 127.0.0.1, which the injected policy treats as public; everything else uses the real
// policy. This exercises the direct (no proxy) path end to end, including IP pinning.
/** @type {http.Server} */
let site;
let port = 0;
/** @type {string[]} */
const hostsSeen = [];

before(async () => {
  site = http.createServer((req, res) => {
    hostsSeen.push(String(req.headers.host));
    const url = new URL(req.url ?? '/', 'http://x');
    switch (url.pathname) {
      case '/latin1':
        res.writeHead(200, { 'Content-Type': 'text/html; charset=windows-1252' });
        res.end(Buffer.from([0x3c, 0x70, 0x3e, 0x63, 0x61, 0x66, 0xe9, 0x3c, 0x2f, 0x70, 0x3e])); // <p>café</p>
        return;
      case '/meta':
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(Buffer.concat([Buffer.from('<meta charset="iso-8859-1"><p>na'), Buffer.from([0xef]), Buffer.from('ve</p>')]));
        return;
      case '/gzip':
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Encoding': 'gzip' });
        res.end(zlib.gzipSync('<p>compressed ✓</p>'));
        return;
      case '/bomb':
        res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Encoding': 'gzip' });
        res.end(zlib.gzipSync(Buffer.alloc(6 * 1024 * 1024, 0x61)));
        return;
      case '/big':
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(Buffer.alloc(5 * 1024 * 1024 + 10, 0x61));
        return;
      case '/json':
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{}');
        return;
      case '/redirect':
        res.writeHead(302, { Location: String(url.searchParams.get('to')) });
        res.end();
        return;
      case '/loop':
        res.writeHead(301, { Location: '/loop' });
        res.end();
        return;
      case '/cookie':
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<p>${req.headers.cookie ?? 'none'}|${req.headers['user-agent']}</p>`);
        return;
      default:
        res.writeHead(404);
        res.end();
    }
  });
  await new Promise((r) => site.listen(0, '127.0.0.1', () => r(undefined)));
  port = /** @type {import('node:net').AddressInfo} */ (site.address()).port;
});
after(() => new Promise((r) => site.close(() => r(undefined))));

const opts = () => ({
  proxyUrl: '',
  allowedPorts: new Set([80, 443, port]),
  /** @param {string} host */
  lookup: async (host) => {
    if (host === 'public.test') return [{ address: '127.0.0.1', family: 4 }];
    if (host === 'private.test') return [{ address: '10.1.2.3', family: 4 }];
    if (host === 'mixed.test') return [{ address: '127.0.0.1', family: 4 }, { address: '192.168.1.1', family: 4 }];
    throw new Error('ENOTFOUND');
  },
  /** @param {string} ip */
  isAllowed: (ip) => ip === '127.0.0.1' || blockedReason(ip) === null,
});
const base = () => `http://public.test:${port}`;
/** @param {Promise<unknown>} p @param {number} status */
const rejectsWith = (p, status) => assert.rejects(p, (e) => e instanceof HttpError && e.status === status);

test('connects to the vetted address and sends the original Host', async () => {
  const r = await fetchPage(`${base()}/latin1`, opts());
  assert.equal(r.html, '<p>café</p>');
  assert.equal(hostsSeen.at(-1), `public.test:${port}`);
});

test('decodes charset from meta and gzip bodies', async () => {
  assert.equal((await fetchPage(`${base()}/meta`, opts())).html.endsWith('<p>naïve</p>'), true);
  assert.equal((await fetchPage(`${base()}/gzip`, opts())).html, '<p>compressed ✓</p>');
});

test('caps size, including after decompression', async () => {
  await rejectsWith(fetchPage(`${base()}/big`, opts()), 413);
  await rejectsWith(fetchPage(`${base()}/bomb`, opts()), 413);
});

test('refuses non-HTML and upstream errors', async () => {
  await rejectsWith(fetchPage(`${base()}/json`, opts()), 415);
  await rejectsWith(fetchPage(`${base()}/missing`, opts()), 502);
});

test('follows redirects and re-validates each hop', async () => {
  const ok = await fetchPage(`${base()}/redirect?to=/cookie`, opts());
  assert.equal(ok.url, `${base()}/cookie`);
  for (const to of [
    `http://private.test:${port}/`,
    `http://mixed.test:${port}/`,
    `http://169.254.169.254:${port}/latest/meta-data/`,
    `http://[::1]:${port}/`,
    `http://localhost:${port}/`,
  ]) {
    await rejectsWith(fetchPage(`${base()}/redirect?to=${encodeURIComponent(to)}`, opts()), 403);
  }
  await rejectsWith(fetchPage(`${base()}/redirect?to=${encodeURIComponent('file:///etc/passwd')}`, opts()), 400);
  await rejectsWith(fetchPage(`${base()}/redirect?to=${encodeURIComponent('http://public.test:2222/')}`, opts()), 400);
  await assert.rejects(fetchPage(`${base()}/loop`, opts()), /Too many redirects/);
});

test('sends a browser User-Agent and no cookies', async () => {
  const r = await fetchPage(`${base()}/cookie`, opts());
  assert.match(r.html, /^<p>none\|Mozilla\/5\.0 /);
});

test('without test overrides, the local site itself is refused', async () => {
  await rejectsWith(fetchPage(`http://127.0.0.1:${port}/latin1`, { proxyUrl: '', allowedPorts: new Set([port]) }), 403);
});
