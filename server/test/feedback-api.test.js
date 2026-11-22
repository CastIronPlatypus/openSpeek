import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { parseFrontMatter, startTestServer } from './helpers.js';

const NAME = /^\d{4}-\d{2}-\d{2}-\d{6}-[0-9a-f]{6}\.md$/;
const ID = /^\d{8}-\d{6}-[0-9a-f]{6}$/;

/**
 * @param {string} base
 * @param {unknown} body
 * @param {Record<string, string>} [headers]
 */
const post = (base, body, headers = {}) =>
  fetch(`${base}/api/feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

/** @param {Response} r @param {number} status @param {RegExp} [re] */
async function expectError(r, status, re) {
  assert.equal(r.status, status);
  const j = await r.json();
  assert.equal(typeof j.error, 'string');
  if (re) assert.match(j.error, re);
}

/** @param {string} dir */
const mdFiles = (dir) => {
  try {
    return readdirSync(dir).filter((n) => n.endsWith('.md')).sort();
  } catch {
    return [];
  }
};

/** @param {Response} r */
const health = async (r) => (await r.json()).feedback;

test('happy path writes one well-formed file', async () => {
  const s = await startTestServer();
  try {
    assert.equal(await health(await fetch(`${s.url}/api/health`)), true);
    const message = 'The voice picker is hard to reach.\r\n\r\n---\nnot: "front matter"\n---\n\n- a list\n';
    const r = await post(
      s.url,
      {
        message,
        category: 'bug',
        contact: 'me@example.com',
        context: {
          route: 'reader',
          engine: 'phonon',
          voice: 'Zoey',
          theme: 'dark',
          viewport: '390x844',
          language: 'en-GB',
          appVersion: '0.1.0',
          standalone: false,
          sourceKind: 'pdf',
          documentTitle: 'secret',
        },
      },
      { 'User-Agent': 'TestAgent/1.0 "x"' },
    );
    assert.equal(r.status, 201);
    assert.equal(r.headers.get('access-control-allow-origin'), '*');
    const j = await r.json();
    assert.equal(j.ok, true);
    assert.match(j.id, ID);

    const files = mdFiles(s.config.feedbackDir);
    assert.equal(files.length, 1);
    assert.match(files[0], NAME);
    const [d, t, hex] = j.id.split('-');
    assert.equal(files[0], `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}-${t}-${hex}.md`);
    const full = path.join(s.config.feedbackDir, files[0]);
    assert.equal(statSync(full).mode & 0o777, 0o640);

    const { data, body } = parseFrontMatter(readFileSync(full, 'utf8'));
    assert.deepEqual(Object.keys(data), [
      'id', 'date', 'category', 'contact', 'route', 'engine', 'voice', 'theme', 'viewport',
      'language', 'app_version', 'standalone', 'source_kind', 'user_agent',
    ]);
    assert.equal(data.id, j.id);
    assert.match(String(data.date), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    assert.equal(String(data.date).slice(0, 10).replaceAll('-', ''), d);
    assert.equal(data.category, 'bug');
    assert.equal(data.contact, 'me@example.com');
    assert.equal(data.app_version, '0.1.0');
    assert.equal(data.standalone, false);
    assert.equal(data.source_kind, 'pdf');
    assert.equal(data.user_agent, 'TestAgent/1.0 "x"');
    assert.equal(body, 'The voice picker is hard to reach.\n\n---\nnot: "front matter"\n---\n\n- a list\n');
    const raw = readFileSync(full, 'utf8');
    assert.ok(!raw.includes('secret') && !raw.includes('127.0.0.1'), 'no unknown keys, no IP');
  } finally {
    await s.close();
  }
});

test('minimal submission: defaults and omitted keys', async () => {
  const s = await startTestServer();
  try {
    const r = await post(s.url, { message: 'hi' }, { 'User-Agent': '' });
    assert.equal(r.status, 201);
    const [file] = mdFiles(s.config.feedbackDir);
    const { data, body } = parseFrontMatter(readFileSync(path.join(s.config.feedbackDir, file), 'utf8'));
    assert.deepEqual(Object.keys(data), ['id', 'date', 'category']);
    assert.equal(data.category, 'other');
    assert.equal(body, 'hi\n');
  } finally {
    await s.close();
  }
});

test('validation errors', async () => {
  const s = await startTestServer({ feedbackRatePerHour: 0 });
  try {
    await expectError(await post(s.url, {}), 400, /message/);
    await expectError(await post(s.url, { message: '' }), 400, /message/);
    await expectError(await post(s.url, { message: '  \n\t ' }), 400, /message/);
    await expectError(await post(s.url, { message: 'x'.repeat(5001) }), 400, /5000/);
    await expectError(await post(s.url, { message: 'x', category: 'spam' }), 400, /category/);
    await expectError(await post(s.url, { message: 'x', contact: 'c'.repeat(201) }), 400, /200/);
    await expectError(await post(s.url, [1]), 400, /object/);
    await expectError(await post(s.url, '"just a string"'), 400, /object/);
    await expectError(await post(s.url, '{nope'), 400, /JSON/);
    await expectError(await post(s.url, { message: 'x' }, { 'Content-Type': 'text/plain' }), 415, /application\/json/);
    await expectError(await post(s.url, '{"message":"' + 'x'.repeat(200_000) + '"}'), 413, /large/);
    await expectError(await fetch(`${s.url}/api/feedback`), 405);
    assert.deepEqual(mdFiles(s.config.feedbackDir), []);
    // 5000 astral characters, all escaped as \uXXXX pairs, still fit under the route's cap.
    const big = '{"message":"' + '\\ud83d\\ude00'.repeat(5000) + '","contact":"' + '\\u00e9'.repeat(200) + '"}';
    assert.ok(Buffer.byteLength(big) > 16 * 1024);
    const r = await post(s.url, big, { 'Content-Type': 'application/json; charset=utf-8' });
    assert.equal(r.status, 201);
    assert.equal(mdFiles(s.config.feedbackDir).length, 1);
  } finally {
    await s.close();
  }
});

test('other routes keep the global body limit', async () => {
  const s = await startTestServer();
  try {
    const r = await fetch(`${s.url}/api/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ engine: 'edge', text: 'x'.repeat(20000) }),
    });
    assert.equal(r.status, 413);
  } finally {
    await s.close();
  }
});

test('rate limit per IP', async () => {
  const s = await startTestServer({ feedbackRatePerHour: 2 });
  try {
    assert.equal((await post(s.url, { message: '1' })).status, 201);
    assert.equal((await post(s.url, { message: '2' })).status, 201);
    const r = await post(s.url, { message: '3' });
    await expectError(r, 429, /many/);
    assert.ok(Number(r.headers.get('retry-after')) > 60, 'refill is per hour');
    assert.equal(mdFiles(s.config.feedbackDir).length, 2);
  } finally {
    await s.close();
  }
});

test('disabled: 404 and health false, nothing created', async () => {
  const s = await startTestServer({ feedbackEnabled: false });
  try {
    assert.equal(await health(await fetch(`${s.url}/api/health`)), false);
    await expectError(await post(s.url, { message: 'hi' }), 404);
    assert.deepEqual(mdFiles(s.config.feedbackDir), []);
  } finally {
    await s.close();
  }
});

test('unusable directory: 503 and health false, no crash', async () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'openspeek-fb-'));
  const blocker = path.join(tmp, 'not-a-dir');
  writeFileSync(blocker, 'x');
  const s = await startTestServer({ feedbackDir: path.join(blocker, 'feedback') });
  try {
    assert.equal(await health(await fetch(`${s.url}/api/health`)), false);
    await expectError(await post(s.url, { message: 'hi' }), 503, /not available/);
    // The rest of the server still works.
    assert.equal((await fetch(`${s.url}/api/health`)).status, 200);
  } finally {
    await s.close();
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('max files: 507 once the directory is full', async () => {
  const s = await startTestServer({ feedbackMaxFiles: 3 });
  try {
    assert.equal((await post(s.url, { message: '1' })).status, 201);
    assert.equal((await post(s.url, { message: '2' })).status, 201);
    assert.equal((await post(s.url, { message: '3' })).status, 201);
    await expectError(await post(s.url, { message: '4' }), 507, /stored as much feedback/);
    assert.equal(mdFiles(s.config.feedbackDir).length, 3);
  } finally {
    await s.close();
  }
});

test('max files counts what is already there at startup', async () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'openspeek-fb-'));
  for (const n of ['a.md', 'b.md', 'notes.txt']) writeFileSync(path.join(tmp, n), 'x');
  const s = await startTestServer({ feedbackDir: tmp, feedbackMaxFiles: 3 });
  try {
    assert.equal((await post(s.url, { message: '1' })).status, 201);
    await expectError(await post(s.url, { message: '2' }), 507);
    assert.equal(await health(await fetch(`${s.url}/api/health`)), true);
  } finally {
    await s.close();
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('simultaneous submissions produce separate files', async () => {
  const s = await startTestServer();
  try {
    const rs = await Promise.all(Array.from({ length: 5 }, (_, i) => post(s.url, { message: `m${i}` })));
    const ids = await Promise.all(rs.map(async (r) => (assert.equal(r.status, 201), (await r.json()).id)));
    assert.equal(new Set(ids).size, 5);
    const files = mdFiles(s.config.feedbackDir);
    assert.equal(files.length, 5);
    const bodies = files.map((f) => parseFrontMatter(readFileSync(path.join(s.config.feedbackDir, f), 'utf8')).body).sort();
    assert.deepEqual(bodies, ['m0\n', 'm1\n', 'm2\n', 'm3\n', 'm4\n']);
  } finally {
    await s.close();
  }
});

test('preflight for POST with JSON', async () => {
  const s = await startTestServer({ corsOrigin: 'https://app.example' });
  try {
    const r = await fetch(`${s.url}/api/feedback`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://app.example', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' },
    });
    assert.equal(r.status, 204);
    assert.equal(r.headers.get('access-control-allow-origin'), 'https://app.example');
    assert.match(r.headers.get('access-control-allow-methods') ?? '', /POST/);
    assert.match(r.headers.get('access-control-allow-headers') ?? '', /Content-Type/i);
  } finally {
    await s.close();
  }
});
