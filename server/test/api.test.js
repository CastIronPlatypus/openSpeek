import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startTestServer } from './helpers.js';

/** @type {Awaited<ReturnType<typeof startTestServer>>} */
let srv;
before(async () => {
  srv = await startTestServer({ fetchRatePerMinute: 3 });
});
after(() => srv.close());

/** @param {unknown} body @param {Record<string, string>} [headers] */
const tts = (body, headers = { 'Content-Type': 'application/json' }) =>
  fetch(`${srv.url}/api/tts`, { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) });

/** @param {Response} r @param {number} status @param {RegExp} [re] */
async function expectError(r, status, re) {
  assert.equal(r.status, status);
  assert.match(r.headers.get('content-type') ?? '', /application\/json/);
  const j = await r.json();
  assert.equal(typeof j.error, 'string');
  if (re) assert.match(j.error, re);
  assert.ok(!/at .*\.js:\d+/.test(j.error), 'no stack traces');
}

test('health', async () => {
  const r = await fetch(`${srv.url}/api/health`);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, engines: { edge: true, phonon: false }, fetch: true, feedback: true });
  assert.equal(r.headers.get('access-control-allow-origin'), '*');
  assert.equal(r.headers.get('cross-origin-resource-policy'), 'cross-origin');
  assert.equal(r.headers.get('cross-origin-embedder-policy'), 'credentialless');
});

test('CORS preflight', async () => {
  const r = await fetch(`${srv.url}/api/tts`, {
    method: 'OPTIONS',
    headers: { Origin: 'https://app.example', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' },
  });
  assert.equal(r.status, 204);
  assert.equal(r.headers.get('access-control-allow-origin'), '*');
  assert.match(r.headers.get('access-control-allow-methods') ?? '', /POST/);
  assert.match(r.headers.get('access-control-allow-headers') ?? '', /Content-Type/i);
});

test('CORS origin list echoes only listed origins', async () => {
  const s = await startTestServer({ corsOrigin: 'https://a.example, https://b.example' });
  try {
    let r = await fetch(`${s.url}/api/health`, { headers: { Origin: 'https://b.example' } });
    assert.equal(r.headers.get('access-control-allow-origin'), 'https://b.example');
    r = await fetch(`${s.url}/api/health`, { headers: { Origin: 'https://evil.example' } });
    assert.equal(r.headers.get('access-control-allow-origin'), null);
  } finally {
    await s.close();
  }
});

test('voices', async () => {
  let r = await fetch(`${srv.url}/api/voices?engine=edge`);
  assert.equal(r.status, 200);
  assert.equal((await r.json()).voices[0].name, 'en-US-AriaNeural');
  await expectError(await fetch(`${srv.url}/api/voices`), 400, /engine/);
  await expectError(await fetch(`${srv.url}/api/voices?engine=google`), 400, /engine/);
  await expectError(await fetch(`${srv.url}/api/voices?engine=phonon`), 503, /Phonon/);
});

test('tts success shape', async () => {
  const r = await tts({ engine: 'edge', text: 'Hello there.' });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.format, 'mp3');
  assert.equal(Buffer.from(j.audio, 'base64').toString(), 'ID3fake');
  assert.deepEqual(j.words, [{ start: 0.1, end: 0.4, charStart: 0, charEnd: 5 }]);
});

test('tts validation errors', async () => {
  await expectError(await tts('{not json'), 400, /JSON/);
  await expectError(await tts(''), 400, /JSON/);
  await expectError(await tts([1, 2]), 400, /object/);
  await expectError(await tts({ text: 'hi' }), 400, /engine/);
  await expectError(await tts({ engine: 'google', text: 'hi' }), 400, /engine/);
  await expectError(await tts({ engine: 'edge' }), 400, /text/);
  await expectError(await tts({ engine: 'edge', text: '   ' }), 400, /text/);
  await expectError(await tts({ engine: 'edge', text: 42 }), 400, /text/);
  await expectError(await tts({ engine: 'edge', text: 'x'.repeat(4001) }), 400, /4000/);
  await expectError(await tts({ engine: 'edge', text: 'hi', voice: 7 }), 400, /voice/);
  await expectError(await tts({ engine: 'edge', text: 'x'.repeat(20000) }), 413, /large/);
  assert.equal((await tts({ engine: 'edge', text: 'x'.repeat(4000) })).status, 200);
});

test('wrong method and unknown routes', async () => {
  await expectError(await fetch(`${srv.url}/api/tts`), 405);
  await expectError(await fetch(`${srv.url}/api/health`, { method: 'POST' }), 405);
  await expectError(await fetch(`${srv.url}/api/nope`), 404);
});

test('engine errors are reported without internals', async () => {
  const s = await startTestServer({}, {
    edge: {
      listVoices: async () => {
        throw new Error('ECONNREFUSED 10.1.2.3 secret detail');
      },
      synthesize: async () => {
        throw new Error('boom at /srv/secret/path.js:12');
      },
      close() {},
    },
  });
  try {
    const r = await fetch(`${s.url}/api/tts`, { method: 'POST', body: JSON.stringify({ engine: 'edge', text: 'hi' }) });
    assert.equal(r.status, 502);
    const j = await r.json();
    assert.ok(!j.error.includes('secret'));
    const v = await fetch(`${s.url}/api/voices?engine=edge`);
    assert.equal(v.status, 502);
    assert.ok(!(await v.text()).includes('secret'));
  } finally {
    await s.close();
  }
});

test('fetch: missing url, success, rate limit', async () => {
  await expectError(await fetch(`${srv.url}/api/fetch`), 400, /url/);
  const r = await fetch(`${srv.url}/api/fetch?url=${encodeURIComponent('https://example.com/a')}`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'text/html; charset=utf-8');
  assert.equal(r.headers.get('x-final-url'), 'https://example.com/a');
  assert.equal(await r.text(), '<p>https://example.com/a</p>');
  await fetch(`${srv.url}/api/fetch?url=x`);
  const limited = await fetch(`${srv.url}/api/fetch?url=x`);
  await expectError(limited, 429, /many/);
  assert.ok(Number(limited.headers.get('retry-after')) > 0);
});

test('fetch: real fetcher refuses local targets end to end', async () => {
  const { fetchPage } = await import('../src/fetch/fetcher.js');
  const s = await startTestServer({}, { fetchPage: (u) => fetchPage(u, { proxyUrl: '' }) });
  try {
    for (const target of [`http://127.0.0.1:${s.port}/`, 'http://localhost/', 'http://169.254.169.254/', 'http://[::1]/', 'http://10.0.0.1/']) {
      const r = await fetch(`${s.url}/api/fetch?url=${encodeURIComponent(target)}`);
      assert.ok([400, 403].includes(r.status), `${target} -> ${r.status}`);
      assert.equal(typeof (await r.json()).error, 'string');
    }
    const r = await fetch(`${s.url}/api/fetch?url=${encodeURIComponent('file:///etc/passwd')}`);
    await expectError(r, 400, /http/);
  } finally {
    await s.close();
  }
});

test('no client build: helpful 404 at /', async () => {
  const r = await fetch(`${srv.url}/`);
  assert.equal(r.status, 404);
  assert.match(await r.text(), /not built/);
});
