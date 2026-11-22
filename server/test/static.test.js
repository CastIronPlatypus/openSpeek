import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { isImmutableAsset, resolveStaticPath } from '../src/static.js';
import { startTestServer } from './helpers.js';

const root = '/srv/dist';

test('resolves normal paths inside the root', () => {
  assert.equal(resolveStaticPath(root, '/index.html'), '/srv/dist/index.html');
  assert.equal(resolveStaticPath(root, '/assets/app-abc.js'), '/srv/dist/assets/app-abc.js');
  assert.equal(resolveStaticPath(root, '/'), '/srv/dist');
  assert.equal(resolveStaticPath(root, '/a%20b.txt'), '/srv/dist/a b.txt');
});

test('refuses traversal and malformed paths', () => {
  for (const p of ['/../etc/passwd', '/%2e%2e/etc/passwd', '/assets/../../etc/passwd', '/a/%2E%2E/%2E%2E/x',
    '/%2e%2e%2fetc%2fpasswd', '/..%5c..%5cwindows', '/a\\b', '/%00', '/%E0%A4%A', 'relative']) {
    assert.equal(resolveStaticPath(root, p), null, p);
  }
});

test('immutable asset detection', () => {
  assert.equal(isImmutableAsset('/assets/index-DsW3bq1x.js'), true);
  assert.equal(isImmutableAsset('/index.html'), false);
  assert.equal(isImmutableAsset('/favicon.svg'), false);
});

/** @type {Awaited<ReturnType<typeof startTestServer>>} */
let srv;
/** @type {string} */
let dir;
before(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'openspeek-static-'));
  await mkdir(path.join(dir, 'dist', 'assets'), { recursive: true });
  await writeFile(path.join(dir, 'dist', 'index.html'), '<!doctype html><title>app</title>');
  await writeFile(path.join(dir, 'dist', 'assets', 'index-AbCdEf12.js'), 'console.log(1)');
  await writeFile(path.join(dir, 'dist', 'assets', 'ort-wasm-simd-threaded.wasm'), Buffer.from([0, 0x61, 0x73, 0x6d]));
  await writeFile(path.join(dir, 'dist', 'worker.mjs'), 'export {}');
  await writeFile(path.join(dir, 'secret.txt'), 'top secret');
  await symlink(path.join(dir, 'secret.txt'), path.join(dir, 'dist', 'leak.txt'));
  srv = await startTestServer({ staticDir: path.join(dir, 'dist') });
});
after(async () => {
  await srv.close();
  await rm(dir, { recursive: true, force: true });
});

test('serves files with MIME types, caching and isolation headers', async () => {
  let r = await fetch(`${srv.url}/`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type') ?? '', /text\/html/);
  assert.equal(r.headers.get('cache-control'), 'no-cache');
  assert.equal(r.headers.get('cross-origin-opener-policy'), 'same-origin');
  assert.equal(r.headers.get('cross-origin-embedder-policy'), 'credentialless');

  r = await fetch(`${srv.url}/assets/index-AbCdEf12.js`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type') ?? '', /text\/javascript/);
  assert.match(r.headers.get('cache-control') ?? '', /immutable/);

  r = await fetch(`${srv.url}/assets/ort-wasm-simd-threaded.wasm`);
  assert.equal(r.headers.get('content-type'), 'application/wasm');
  r = await fetch(`${srv.url}/worker.mjs`);
  assert.match(r.headers.get('content-type') ?? '', /text\/javascript/);
});

test('SPA fallback for routes, 404 for missing files', async () => {
  let r = await fetch(`${srv.url}/library/some-doc`);
  assert.equal(r.status, 200);
  assert.match(await r.text(), /<title>app<\/title>/);
  r = await fetch(`${srv.url}/assets/missing-file.js`);
  assert.equal(r.status, 404);
});

test('no traversal or symlink escape over HTTP', async () => {
  const http = await import('node:http');
  /** @param {string} p */
  const raw = (p) =>
    new Promise((resolve) => {
      http.get({ host: '127.0.0.1', port: srv.port, path: p }, (res) => {
        let body = '';
        res.on('data', (d) => (body += d));
        res.on('end', () => resolve({ status: res.statusCode, body }));
      });
    });
  for (const p of ['/../secret.txt', '/%2e%2e/secret.txt', '/assets/..%2f..%2fsecret.txt', '/leak.txt']) {
    const r = /** @type {{ status: number, body: string }} */ (await raw(p));
    assert.ok(!r.body.includes('top secret'), p);
    assert.ok([400, 404].includes(r.status), `${p} -> ${r.status}`);
  }
});
