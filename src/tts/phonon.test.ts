import { describe, expect, it, vi } from 'vitest';
import type { LoadOptions, SpeechOptions, SpeechStream } from 'phonon-tts';
import type { ModelProgress } from '../types';
import { PhononEngine, type PhononApi, type PhononModel } from './phonon';
import { ProgressAggregator } from './progress';
import { VoiceCatalog, parseCatalog } from './voices';

const CATALOG = [
  { filename: 'voices/z.safetensors', name: 'Zoey', language: 'en', locale: 'en-us', gender: 'female', age: 'Adult', description: 'Playful' },
  { filename: 'voices/m.safetensors', name: 'Marie', language: 'fr', locale: 'fr-fr' },
  { filename: 'voices/z2.safetensors', name: 'Zoey', language: 'en' },
]
  .map((v) => JSON.stringify(v))
  .join('\n')
  .concat('\nnot json\n');

class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length() {
    return this.data.size;
  }
  clear() {
    this.data.clear();
  }
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  key(i: number) {
    return [...this.data.keys()][i] ?? null;
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
}

function catalogFetch(ok = true) {
  return vi.fn(async () => (ok ? new Response(CATALOG) : Promise.reject(new TypeError('offline'))));
}

class FakeModel implements PhononModel {
  readonly sampleRate = 24000;
  readonly device = 'cpu';
  readonly threads = 3;
  readonly threadsReason = 'test';
  voices = ['default'];
  addVoice = vi.fn(async (name: string) => {
    this.voices.push(name);
  });
  streams: { text: string; options?: SpeechOptions }[] = [];

  stream(text: string, options?: SpeechOptions): SpeechStream {
    this.streams.push({ text, options });
    const signal = options?.signal;
    return {
      sampleRate: 24000,
      done: Promise.resolve({ cancelled: false }),
      cancel() {},
      async *[Symbol.asyncIterator]() {
        for (let i = 0; i < 3; i++) {
          await new Promise((r) => setTimeout(r, 1));
          if (signal?.aborted) return; // like phonon-tts: an abort just ends the stream
          yield new Float32Array(10).fill(0.5);
        }
      },
    };
  }

  dispose = vi.fn();
}

function fakeApi(model = new FakeModel()) {
  const load = vi.fn(async (options: LoadOptions) => {
    options.onProgress?.({ file: 'config', loaded: 10, total: 10, cached: false });
    options.onProgress?.({ file: 'weights', loaded: 50, total: null, cached: false });
    options.onProgress?.({ file: 'weights', loaded: 100, total: 1000, cached: false });
    await new Promise((r) => setTimeout(r, 1));
    return model;
  });
  const api: PhononApi = {
    load,
    concatPcm: (chunks) => {
      const out = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
      let o = 0;
      for (const c of chunks) {
        out.set(c, o);
        o += c.length;
      }
      return out;
    },
  };
  return { api, load, model };
}

function engineWith(fetchOk = true) {
  const { api, load, model } = fakeApi();
  const importApi = vi.fn(async () => api);
  const engine = new PhononEngine(importApi, new VoiceCatalog(catalogFetch(fetchOk), new MemoryStorage()));
  return { engine, load, model, importApi };
}

describe('ProgressAggregator', () => {
  it('is monotonic across files of unknown and growing size and completes at 1', () => {
    const agg = new ProgressAggregator();
    const fractions = [
      agg.update({ file: 'config', loaded: 10, total: 10 }),
      agg.update({ file: 'weights', loaded: 5, total: null }),
      agg.update({ file: 'weights', loaded: 50, total: 1000 }),
      agg.update({ file: 'weights', loaded: 1000, total: 1000 }),
    ].map((p) => p.fraction);
    expect(fractions[0]).toBe(0.99);
    for (let i = 1; i < fractions.length; i++) expect(fractions[i]).toBeGreaterThanOrEqual(fractions[i - 1]);
    expect(agg.complete()).toEqual({ loaded: 1010, total: 1010, fraction: 1 });
  });

  it('counts expected files before they report, so early small files do not read as done', () => {
    const agg = new ProgressAggregator({ weights: 1000 });
    expect(agg.update({ file: 'config', loaded: 10, total: 10 }).fraction).toBeCloseTo(10 / 1010);
    expect(agg.update({ file: 'weights', loaded: 500, total: null }).fraction).toBeCloseTo(510 / 1010);
    expect(agg.update({ file: 'weights', loaded: 900, total: 900 }).fraction).toBe(0.99);
  });
});

describe('voice catalog', () => {
  it('keeps unique English voices', () => {
    expect(parseCatalog(CATALOG)).toEqual([
      { name: 'Zoey', filename: 'voices/z.safetensors', gender: 'female', age: 'Adult', locale: 'en-us', description: 'Playful' },
    ]);
  });

  it('caches in localStorage for offline use and returns [] when nothing is available', async () => {
    const storage = new MemoryStorage();
    expect(await new VoiceCatalog(catalogFetch(), storage).list()).toHaveLength(1);
    const offline = catalogFetch(false);
    expect(await new VoiceCatalog(offline, storage).list()).toHaveLength(1);
    expect(await new VoiceCatalog(offline, new MemoryStorage()).list()).toEqual([]);
  });
});

describe('PhononEngine', () => {
  it('loads once for concurrent callers and reports aggregated progress up to 1', async () => {
    const { engine, load, importApi } = engineWith();
    const a: ModelProgress[] = [];
    const b: ModelProgress[] = [];
    expect(engine.ready).toBe(false);
    await Promise.all([engine.load((p) => a.push(p)), engine.load((p) => b.push(p)), engine.load()]);
    expect(load).toHaveBeenCalledTimes(1);
    expect(importApi).toHaveBeenCalledTimes(1);
    expect(load.mock.calls[0][0]).toMatchObject({ lang: 'en', device: 'cpu' });
    expect(engine.ready).toBe(true);
    expect(a.at(-1)?.fraction).toBe(1);
    expect(b.at(-1)?.fraction).toBe(1);
    for (let i = 1; i < a.length; i++) expect(a[i].fraction).toBeGreaterThanOrEqual(a[i - 1].fraction);
    await engine.load();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('lists catalog voices before loading', async () => {
    const { engine, load } = engineWith();
    expect(await engine.listVoices()).toEqual([
      { name: 'Zoey', gender: 'female', age: 'Adult', locale: 'en-us', description: 'Playful' },
    ]);
    expect(load).not.toHaveBeenCalled();
  });

  it('synthesises with the default voice, and registers a catalog voice once', async () => {
    const { engine, model } = engineWith();
    const plain = await engine.synth('Hello.');
    expect(plain.pcm).toHaveLength(30);
    expect(plain.words).toBeUndefined();
    expect(model.streams[0].options?.voice).toBeUndefined();

    await Promise.all([engine.synth('One.', { voice: 'Zoey' }), engine.synth('Two.', { voice: 'Zoey' })]);
    expect(model.addVoice).toHaveBeenCalledTimes(1);
    expect(model.addVoice).toHaveBeenCalledWith(
      'Zoey',
      'https://huggingface.co/gradium/phonon-voices/resolve/main/voices/z.safetensors',
    );
    expect(model.streams.at(-1)?.options?.voice).toBe('Zoey');
  });

  it('falls back to the default voice for names missing from the catalog', async () => {
    const { engine, model } = engineWith();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await engine.synth('Hi.', { voice: 'Nobody' });
    expect(model.addVoice).not.toHaveBeenCalled();
    expect(model.streams[0].options?.voice).toBeUndefined();
  });

  it('rejects with AbortError when aborted mid-stream', async () => {
    const { engine } = engineWith();
    await engine.load();
    const controller = new AbortController();
    const pending = engine.synth('Hello.', { signal: controller.signal });
    setTimeout(() => controller.abort(), 2);
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('turns unspeakable text into a short silence without loading', async () => {
    const { engine, load } = engineWith();
    const { pcm } = await engine.synth(' ... — ');
    expect(pcm.length).toBeGreaterThan(0);
    expect(pcm.every((s) => s === 0)).toBe(true);
    expect(load).not.toHaveBeenCalled();
  });

  it('can load again after dispose', async () => {
    const { engine, load, model } = engineWith();
    await engine.load();
    engine.dispose();
    expect(model.dispose).toHaveBeenCalled();
    expect(engine.ready).toBe(false);
    await engine.load();
    expect(load).toHaveBeenCalledTimes(2);
  });
});
