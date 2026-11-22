import { describe, expect, it, vi } from 'vitest';
import {
  APP_VERSION,
  buildFeedbackBody,
  buildFeedbackContext,
  charCount,
  feedbackErrorMessage,
  isSendableMessage,
  sendFeedback,
  type FeedbackAppState,
  type FeedbackEnvironment,
  type FeedbackInput,
} from '.';
import pkg from '../../package.json';

const ENV: FeedbackEnvironment = { width: 390, height: 844, language: 'en-GB', standalone: false };
const READER: FeedbackAppState = {
  route: 'reader',
  engine: 'edge',
  voice: 'en-US-AriaNeural',
  theme: 'system',
  resolvedTheme: 'dark',
  sourceKind: 'pdf',
};
const INPUT: FeedbackInput = { message: 'Line one\n\n---\n"quoted" 🎧', category: 'bug', contact: '  me@example.com ', app: READER };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('buildFeedbackContext', () => {
  it('describes the app and browser, with the package version', () => {
    expect(APP_VERSION).toBe(pkg.version);
    expect(buildFeedbackContext(READER, ENV)).toEqual({
      route: 'reader',
      engine: 'edge',
      voice: 'en-US-AriaNeural',
      theme: 'dark (system)',
      viewport: '390x844',
      language: 'en-GB',
      appVersion: APP_VERSION,
      standalone: false,
      sourceKind: 'pdf',
    });
  });

  it('names the default voice, an explicit theme, and leaves the source kind out of the library', () => {
    const context = buildFeedbackContext(
      { route: 'library', engine: 'phonon', voice: null, theme: 'light', resolvedTheme: 'light', sourceKind: 'epub' },
      { ...ENV, width: 1280.4, height: 800, standalone: true },
    );
    expect(context).toMatchObject({ voice: 'default', theme: 'light', viewport: '1280x800', standalone: true });
    expect(context).not.toHaveProperty('sourceKind');
  });
});

describe('buildFeedbackBody', () => {
  it('keeps the message as written and trims the contact', () => {
    const body = buildFeedbackBody(INPUT, ENV);
    expect(body.message).toBe(INPUT.message);
    expect(body.category).toBe('bug');
    expect(body.contact).toBe('me@example.com');
    expect(body.context.viewport).toBe('390x844');
  });

  it('leaves out a blank contact', () => {
    expect(buildFeedbackBody({ ...INPUT, contact: '   ' }, ENV)).not.toHaveProperty('contact');
    expect(buildFeedbackBody({ ...INPUT, contact: undefined }, ENV)).not.toHaveProperty('contact');
  });

  it('only ever carries the known keys (no document details)', () => {
    const app = { ...READER, title: 'Secret title', url: 'https://example.com/x' } as FeedbackAppState;
    const body = buildFeedbackBody({ ...INPUT, app }, ENV);
    expect(Object.keys(body.context).sort()).toEqual(
      ['appVersion', 'engine', 'language', 'route', 'sourceKind', 'standalone', 'theme', 'viewport', 'voice'].sort(),
    );
    expect(JSON.stringify(body)).not.toMatch(/Secret|example\.com\/x/);
  });
});

describe('message limits', () => {
  it('counts code points and needs non-blank text within 5000 characters', () => {
    expect(charCount('a🎧b')).toBe(3);
    expect(isSendableMessage('  \n ')).toBe(false);
    expect(isSendableMessage('ok')).toBe(true);
    expect(isSendableMessage('🎧'.repeat(5000))).toBe(true);
    expect(isSendableMessage(`  ${'x'.repeat(5000)}  `)).toBe(true);
    expect(isSendableMessage('x'.repeat(5001))).toBe(false);
  });
});

describe('feedbackErrorMessage', () => {
  it('maps rate limiting and missing endpoints, else shows the server message', () => {
    expect(feedbackErrorMessage(429, { error: 'Too many requests, slow down' })).toBe(
      'You’ve sent a lot of feedback recently — try again later.',
    );
    expect(feedbackErrorMessage(404, { error: 'Not found' })).toMatch(/doesn’t accept feedback/);
    expect(feedbackErrorMessage(400, { error: 'message must be a non-empty string' })).toBe('message must be a non-empty string');
    expect(feedbackErrorMessage(502, null)).toBe('Couldn’t send feedback (server error 502).');
  });
});

describe('sendFeedback', () => {
  it('posts JSON to <serverUrl>/api/feedback and returns the id', async () => {
    const fetcher = vi.fn(async () => json({ ok: true, id: '20261122-153012-a1b2c3' }, 201));
    const result = await sendFeedback(INPUT, { baseUrl: 'http://box:8787/', fetcher, env: ENV });
    expect(result).toEqual({ id: '20261122-153012-a1b2c3' });
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://box:8787/api/feedback');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(String(init.body))).toEqual(buildFeedbackBody(INPUT, ENV));
  });

  it('uses the same origin for an empty server URL', async () => {
    const fetcher = vi.fn(async () => json({ ok: true, id: 'x' }, 201));
    await sendFeedback(INPUT, { baseUrl: '', fetcher, env: ENV });
    expect(fetcher.mock.calls[0]).toContain('/api/feedback');
  });

  it("rejects with the server's message or a readable network error", async () => {
    const failing = (res: Response) => ({ baseUrl: '', env: ENV, fetcher: async () => res });
    await expect(sendFeedback(INPUT, failing(json({ error: 'contact must be at most 200 characters' }, 400)))).rejects.toThrow(
      'contact must be at most 200 characters',
    );
    await expect(sendFeedback(INPUT, failing(json({ error: 'Too many requests, slow down' }, 429)))).rejects.toThrow(
      /sent a lot of feedback recently/,
    );
    const offline = { baseUrl: 'http://box', env: ENV, fetcher: () => Promise.reject(new TypeError('Failed to fetch')) };
    await expect(sendFeedback(INPUT, offline)).rejects.toThrow('Can’t reach the openSpeek server at http://box.');
  });
});
