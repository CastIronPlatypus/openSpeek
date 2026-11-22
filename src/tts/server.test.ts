import { describe, expect, it, vi } from 'vitest';
import { RemoteEngine, ServerConnection, type AudioDecoder } from './server';

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function setup(handler: Handler, now = () => 0) {
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => handler(url, init));
  const server = new ServerConnection(fetcher, now);
  const decode = vi.fn<AudioDecoder>(async (bytes) => new Float32Array(bytes.byteLength * 100));
  return { fetcher, server, decode, edge: new RemoteEngine('edge', server, decode) };
}

const HEALTH = { ok: true, engines: { edge: true, phonon: false }, fetch: true };

describe('ServerConnection', () => {
  it('reports status, caches it ~10 s and forgets it when the URL changes', async () => {
    let t = 0;
    const { server, fetcher } = setup(() => json(HEALTH), () => t);
    expect(await server.getStatus()).toEqual({ reachable: true, engines: { edge: true, phonon: false }, fetch: true });
    t = 5_000;
    await server.getStatus();
    expect(fetcher).toHaveBeenCalledTimes(1);
    t = 11_000;
    await server.getStatus();
    expect(fetcher).toHaveBeenCalledTimes(2);
    server.setUrl('http://box:8787/');
    await server.getStatus();
    expect(fetcher).toHaveBeenLastCalledWith('http://box:8787/api/health', expect.anything());
  });

  it('never rejects', async () => {
    const { server } = setup(() => Promise.reject(new TypeError('Failed to fetch')));
    expect(await server.getStatus()).toEqual({ reachable: false, engines: { phonon: false, edge: false }, fetch: false });
  });
});

describe('RemoteEngine', () => {
  it('load checks the server is reachable and offers the engine', async () => {
    const down = setup(() => Promise.reject(new TypeError('Failed to fetch')));
    await expect(down.edge.load()).rejects.toThrow(/Can't reach the openSpeek server .*npm run server/);
    expect(down.edge.ready).toBe(false);

    const up = setup(() => json(HEALTH));
    await up.edge.load();
    expect(up.edge.ready).toBe(true);
    const phonon = new RemoteEngine('phonon-server', up.server, up.decode);
    await expect(phonon.load()).rejects.toThrow(/doesn't offer server-side Phonon/);

    up.server.setUrl('http://elsewhere');
    expect(up.edge.ready).toBe(false);
  });

  it('lists voices per server, [] on failure', async () => {
    const { edge, fetcher } = setup((url) =>
      url.includes('/api/voices?engine=edge')
        ? json({ voices: [{ name: 'en-US-AriaNeural', gender: 'Female', locale: 'en-US' }, { bogus: 1 }] })
        : json({ error: 'no' }, 500),
    );
    const voices = await edge.listVoices();
    expect(voices).toEqual([{ name: 'en-US-AriaNeural', gender: 'Female', locale: 'en-US' }]);
    await edge.listVoices();
    expect(fetcher).toHaveBeenCalledTimes(1);
    const failing = setup(() => Promise.reject(new TypeError('x')));
    expect(await failing.edge.listVoices()).toEqual([]);
  });

  it('synthesises: posts the text, decodes the audio and passes word timings through', async () => {
    const { edge, fetcher, decode } = setup(() =>
      json({
        format: 'mp3',
        audio: btoa('abcd'),
        words: [
          { start: 0.5, end: 0.9, charStart: 6, charEnd: 11 },
          { start: 0.1, end: 0.4, charStart: 0, charEnd: 5 },
          { start: 1, end: 2, charStart: 'x', charEnd: 3 },
        ],
      }),
    );
    const result = await edge.synth('Hello world', { voice: 'en-US-AriaNeural' });
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe('/api/tts');
    expect(JSON.parse(String(init?.body))).toEqual({ engine: 'edge', text: 'Hello world', voice: 'en-US-AriaNeural' });
    expect(decode).toHaveBeenCalledWith(expect.any(ArrayBuffer), 24000);
    expect(new Uint8Array(decode.mock.calls[0][0])).toEqual(new Uint8Array([97, 98, 99, 100]));
    expect(result.pcm).toHaveLength(400);
    expect(result.words).toEqual([
      { start: 0.1, end: 0.4, charStart: 0, charEnd: 5 },
      { start: 0.5, end: 0.9, charStart: 6, charEnd: 11 },
    ]);
  });

  it("surfaces the server's error message", async () => {
    const { edge } = setup(() => json({ error: 'text is too long' }, 400));
    await expect(edge.synth('Hi.')).rejects.toThrow('Speech server error: text is too long');
  });

  it('rejects with AbortError when aborted', async () => {
    const { edge } = setup(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    );
    const controller = new AbortController();
    const pending = edge.synth('Hello.', { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('turns unspeakable text into silence without a request', async () => {
    const { edge, fetcher } = setup(() => json({}));
    expect((await edge.synth('…')).pcm.length).toBeGreaterThan(0);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
