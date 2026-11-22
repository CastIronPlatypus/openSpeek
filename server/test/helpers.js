import http from 'node:http';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';

/**
 * Start the app on an ephemeral port with fake engines unless overridden.
 * @param {Partial<import('../src/config.js').Config>} [overrides]
 * @param {import('../src/app.js').Deps} [deps]
 */
export async function startTestServer(overrides = {}, deps = {}) {
  const config = { ...loadConfig({}), staticDir: '/nonexistent-openspeek-dist', ...overrides };
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
    port: addr.port,
    url: `http://127.0.0.1:${addr.port}`,
    close: () =>
      new Promise((resolve) => {
        app.close();
        server.closeAllConnections();
        server.close(() => resolve(undefined));
      }),
  };
}
