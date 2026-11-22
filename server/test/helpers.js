import { mkdtempSync, rmSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';

/**
 * Start the app on an ephemeral port with fake engines unless overridden.
 * @param {Partial<import('../src/config.js').Config>} [overrides]
 * @param {import('../src/app.js').Deps} [deps]
 */
export async function startTestServer(overrides = {}, deps = {}) {
  // Feedback goes to a fresh temp directory unless the test names one.
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'openspeek-test-'));
  const config = {
    ...loadConfig({}),
    staticDir: '/nonexistent-openspeek-dist',
    feedbackDir: path.join(tmp, 'feedback'),
    ...overrides,
  };
  const app = createApp(config, {
    edge: {
      listVoices: async () => [{ name: 'en-US-AriaNeural', gender: 'Female', locale: 'en-US', description: 'Aria (United States)' }],
      synthesize: async (text) => ({ audio: Buffer.from('ID3fake'), words: [{ start: 0.1, end: 0.4, charStart: 0, charEnd: Math.min(5, text.length) }] }),
      close() {},
    },
    phonon: {
      available: async () => false,
      listVoices: async () => [],
      synthesize: async () => {
        throw new Error('unused');
      },
      close() {},
    },
    fetchPage: async (url) => ({ html: `<p>${url}</p>`, url }),
    ...deps,
  });
  const server = http.createServer((req, res) => app.handler(req, res));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
  const addr = /** @type {import('node:net').AddressInfo} */ (server.address());
  return {
    config,
    port: addr.port,
    url: `http://127.0.0.1:${addr.port}`,
    close: () =>
      new Promise((resolve) => {
        app.close();
        server.closeAllConnections();
        server.close(() => {
          rmSync(tmp, { recursive: true, force: true });
          resolve(undefined);
        });
      }),
  };
}

/**
 * A deliberately strict front-matter reader for tests (there is no YAML dependency). The file
 * must start with a `---` line; the block ends at the next `---` line and must be followed by a
 * blank line. Each line must be `key: <JSON string | true | false | number>`.
 * @param {string} text
 * @returns {{ data: Record<string, string | boolean | number>, body: string }}
 */
export function parseFrontMatter(text) {
  if (!text.startsWith('---\n')) throw new Error('no opening ---');
  const end = text.indexOf('\n---\n', 3);
  if (end < 0) throw new Error('no closing ---');
  const block = text.slice(4, end);
  const rest = text.slice(end + 5);
  if (!rest.startsWith('\n')) throw new Error('no blank line after front matter');
  /** @type {Record<string, string | boolean | number>} */
  const data = Object.create(null);
  for (const line of block.split('\n')) {
    const m = /^([a-z][a-z0-9_]*): (.*)$/.exec(line);
    if (!m) throw new Error(`bad front-matter line: ${JSON.stringify(line)}`);
    const [, key, raw] = m;
    if (key in data) throw new Error(`duplicate key ${key}`);
    if (raw.startsWith('"')) {
      if (!raw.endsWith('"') || raw.length < 2) throw new Error(`unterminated string: ${line}`);
      // Only \\ and \" escapes: the same text is then a valid YAML double-quoted scalar.
      if (/\\[^"\\]/.test(raw.replace(/\\\\/g, ''))) throw new Error(`unexpected escape: ${line}`);
      data[key] = JSON.parse(raw); // also rejects raw control characters
    } else if (raw === 'true' || raw === 'false') {
      data[key] = raw === 'true';
    } else if (/^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/.test(raw)) {
      data[key] = Number(raw);
    } else {
      throw new Error(`bad value: ${line}`);
    }
  }
  return { data, body: rest.slice(1) };
}
