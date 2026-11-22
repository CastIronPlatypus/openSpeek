import { describe, expect, it, vi } from 'vitest';
import { abortError } from '../tts/common';
import type { EngineId, ModelProgress, Sentence, SpeechEngine, SynthResult, WordTiming } from '../types';
import { ReadAloudPlayer, type AudioLike, type FrameScheduler, type ObjectUrls } from './player';

const RATE = 1000;

interface Request {
  text: string;
  voice: string | null | undefined;
  signal: AbortSignal | undefined;
  resolve: (r: SynthResult) => void;
  reject: (e: unknown) => void;
}

class FakeEngine implements SpeechEngine {
  readonly sampleRate = RATE;
  ready = false;
  requests: Request[] = [];
  loadError: Error | null = null;
  private loadResolve: (() => void) | null = null;

  constructor(
    readonly id: EngineId = 'phonon',
    private readonly autoLoad = true,
  ) {}

  load(onProgress?: (p: ModelProgress) => void): Promise<void> {
    if (this.loadError) return Promise.reject(this.loadError);
    onProgress?.({ loaded: 1, total: 2, fraction: 0.5 });
    if (this.autoLoad) {
      this.ready = true;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.loadResolve = () => {
        this.ready = true;
        resolve();
      };
    });
  }

  finishLoad(): void {
    this.loadResolve?.();
  }

  listVoices() {
    return Promise.resolve([]);
  }

  synth(text: string, opts: { voice?: string | null; signal?: AbortSignal } = {}): Promise<SynthResult> {
    return new Promise((resolve, reject) => {
      const req: Request = { text, voice: opts.voice, signal: opts.signal, resolve, reject };
      this.requests.push(req);
      opts.signal?.addEventListener('abort', () => reject(abortError()));
    });
  }

  /** Answers the oldest live request for `text` with `seconds` of audio (even if aborted, when `force`). */
  respond(text: string, seconds = 1, words?: WordTiming[], force = false): Request {
    const req = this.requests.find((r) => r.text === text && (force || !r.signal?.aborted));
    if (!req) throw new Error(`no pending request for "${text}"`);
    this.requests.splice(this.requests.indexOf(req), 1);
    req.resolve({ pcm: new Float32Array(Math.round(seconds * RATE)).fill(0.1), words });
    return req;
  }

  respondAll(text: string, seconds = 1): void {
    while (this.live().includes(text)) this.respond(text, seconds);
  }

  fail(text: string, error: Error): void {
    const req = this.requests.find((r) => r.text === text && !r.signal?.aborted);
    if (!req) throw new Error(`no pending request for "${text}"`);
    this.requests.splice(this.requests.indexOf(req), 1);
    req.reject(error);
  }

  live(): string[] {
    return this.requests.filter((r) => !r.signal?.aborted).map((r) => r.text);
  }

  dispose(): void {}
}

class FakeAudio implements AudioLike {
  playbackRate = 1;
  defaultPlaybackRate = 1;
  preservesPitch = false;
  currentTime = 0;
  ended = false;
  paused = true;
  playCalls = 0;
  private source = '';
  private readonly handlers = new Map<string, (() => void)[]>();

  get src(): string {
    return this.source;
  }

  set src(value: string) {
    this.source = value;
    this.currentTime = 0;
    this.ended = false;
    this.playbackRate = this.defaultPlaybackRate;
  }

  play(): Promise<void> {
    this.playCalls++;
    this.paused = false;
    return Promise.resolve();
  }

  pause(): void {
    this.paused = true;
  }

  addEventListener(type: 'ended' | 'error', listener: () => void): void {
    this.handlers.set(type, [...(this.handlers.get(type) ?? []), listener]);
  }

  finish(duration: number): void {
    this.currentTime = duration;
    this.ended = true;
    this.paused = true;
    for (const h of this.handlers.get('ended') ?? []) h();
  }
}

class FakeUrls implements ObjectUrls {
  blobs = new Map<string, Blob>();
  revoked: string[] = [];
  private n = 0;
  create(blob: Blob): string {
    const url = `blob:${++this.n}`;
    this.blobs.set(url, blob);
    return url;
  }
  revoke(url: string): void {
    this.revoked.push(url);
  }
  /** Seconds of audio in the 16-bit mono WAV behind `url`. */
  seconds(url: string): number {
    return ((this.blobs.get(url)?.size ?? 44) - 44) / 2 / RATE;
  }
}

class FakeFrames implements FrameScheduler {
  private callbacks = new Map<number, () => void>();
  private n = 0;
  request(cb: () => void): number {
    this.callbacks.set(++this.n, cb);
    return this.n;
  }
  cancel(id: number): void {
    this.callbacks.delete(id);
  }
  tick(): void {
    const cbs = [...this.callbacks.values()];
    this.callbacks.clear();
    for (const cb of cbs) cb();
  }
}

function sentences(...texts: string[]): Sentence[] {
  return texts.map((text, index) => ({ index, block: index < 2 ? 0 : 1, start: 0, end: text.length, text }));
}

const flush = () => new Promise((r) => setTimeout(r, 0));

function setup(opts: { engine?: FakeEngine; edge?: FakeEngine } = {}) {
  const engine = opts.engine ?? new FakeEngine();
  const edge = opts.edge ?? new FakeEngine('edge');
  const audio = new FakeAudio();
  const urls = new FakeUrls();
  const frames = new FakeFrames();
  const player = new ReadAloudPlayer({
    engines: (id) => (id === 'edge' ? edge : engine),
    createAudio: () => audio,
    urls,
    frames,
  });
  return { player, engine, edge, audio, urls, frames };
}

describe('ReadAloudPlayer', () => {
  it('loads, buffers, plays through every sentence and ends', async () => {
    const engine = new FakeEngine('phonon', false);
    const { player, audio, urls } = setup({ engine });
    player.setDocument(sentences('One.', 'Two.', 'Three.'));
    expect(player.getState()).toMatchObject({ status: 'paused', sentenceIndex: 0 });

    const playing = player.play();
    // The element was started synchronously, inside the gesture.
    expect(audio.playCalls).toBe(1);
    expect(player.getState().status).toBe('loading');
    expect(player.getState().modelProgress?.fraction).toBe(0.5);
    engine.finishLoad();
    await playing;
    expect(player.getState().status).toBe('buffering');
    expect(engine.live()).toEqual(['One.']); // the in-browser engine gets one request at a time

    engine.respond('One.', 1);
    await flush();
    expect(player.getState()).toMatchObject({ status: 'playing', sentenceIndex: 0 });
    expect(urls.seconds(audio.src)).toBe(1);
    expect(audio.paused).toBe(false);

    engine.respond('Two.', 2);
    await flush();
    engine.respond('Three.', 1);
    await flush();
    expect(player.getState().duration).toBeCloseTo(4);

    audio.finish(1);
    expect(player.getState().sentenceIndex).toBe(1);
    expect(urls.seconds(audio.src)).toBe(2);
    expect(player.getState().elapsed).toBeCloseTo(1);
    audio.finish(2);
    audio.finish(1);
    expect(player.getState()).toMatchObject({ status: 'ended', word: null, elapsed: 4 });

    await player.play();
    expect(player.getState()).toMatchObject({ status: 'playing', sentenceIndex: 0 });
  });

  it('discards stale audio when seeking while buffering', async () => {
    const { player, engine, audio, urls } = setup();
    player.setDocument(sentences('A a.', 'B b.', 'C c.', 'D d.'));
    await player.play();
    const first = engine.requests[0];
    player.seek(3);
    expect(first.signal?.aborted).toBe(true);
    expect(player.getState()).toMatchObject({ status: 'buffering', sentenceIndex: 3 });
    await flush();
    expect(engine.live()).toEqual(['D d.']);

    // A result that arrives anyway for the old position never plays.
    engine.respond('A a.', 5, undefined, true);
    await flush();
    expect(player.getState().status).toBe('buffering');

    engine.respond('D d.', 1.5);
    await flush();
    expect(player.getState()).toMatchObject({ status: 'playing', sentenceIndex: 3 });
    expect(urls.seconds(audio.src)).toBe(1.5);
  });

  it('pauses and resumes the same audio without resynthesising', async () => {
    const { player, engine, audio } = setup();
    player.setDocument(sentences('Hello there.'));
    await player.play();
    engine.respond('Hello there.', 2);
    await flush();
    audio.currentTime = 0.7;
    const src = audio.src;

    player.pause();
    expect(player.getState().status).toBe('paused');
    expect(audio.paused).toBe(true);
    expect(player.getState().elapsed).toBeCloseTo(0.7);

    await player.play();
    expect(player.getState().status).toBe('playing');
    expect(audio.src).toBe(src);
    expect(audio.currentTime).toBe(0.7);
    expect(engine.requests).toHaveLength(0);
  });

  it('setVoice drops cached audio and re-buffers the current sentence', async () => {
    const { player, engine } = setup();
    player.setDocument(sentences('One.', 'Two.'));
    await player.play();
    engine.respond('One.');
    await flush();
    const ahead = engine.requests[0];
    expect(ahead.text).toBe('Two.');

    player.setVoice('Zoey');
    expect(ahead.signal?.aborted).toBe(true);
    expect(player.getState()).toMatchObject({ status: 'buffering', voice: 'Zoey', sentenceIndex: 0 });
    await flush();
    expect(engine.live()).toEqual(['One.']);
    expect(engine.requests.at(-1)?.voice).toBe('Zoey');

    // Audio for the old voice that slips through is ignored.
    engine.respond('Two.', 1, undefined, true);
    engine.respond('One.');
    await flush();
    expect(player.getState().status).toBe('playing');
  });

  it('setEngine swaps engines, keeps position and uses parallel requests for server engines', async () => {
    const { player, engine, edge } = setup();
    player.setDocument(sentences('One.', 'Two.', 'Three.', 'Four.'));
    await player.play();
    engine.respond('One.');
    await flush();
    player.next();
    await flush();

    player.setEngine('edge', 'en-US-AriaNeural');
    expect(player.getState()).toMatchObject({ engine: 'edge', voice: 'en-US-AriaNeural', sentenceIndex: 1 });
    expect(engine.live()).toEqual([]);
    await flush();
    expect(player.getState().status).toBe('buffering');
    expect(edge.live()).toEqual(['Two.', 'Three.', 'Four.']);
    expect(edge.requests[0].voice).toBe('en-US-AriaNeural');

    edge.respond('Two.');
    await flush();
    expect(player.getState()).toMatchObject({ status: 'playing', sentenceIndex: 1 });
  });

  it('setEngine while paused keeps paused and loads the new engine on play', async () => {
    const edge = new FakeEngine('edge', false);
    const { player } = setup({ edge });
    player.setDocument(sentences('One.', 'Two.'), 1);
    player.setEngine('edge');
    expect(player.getState()).toMatchObject({ status: 'paused', engine: 'edge', voice: null, sentenceIndex: 1 });
    const playing = player.play();
    expect(player.getState().status).toBe('loading');
    edge.finishLoad();
    await playing;
    expect(edge.live()).toEqual(['Two.']);
  });

  it('estimates the spoken word from audio position, emitting only on change', async () => {
    const { player, engine, audio, frames } = setup();
    // Weights: "a" 1+3, "bbbbbbb" 7+3, "cc" 2+3 → total 19.
    player.setDocument(sentences('a bbbbbbb cc'));
    await player.play();
    engine.respond('a bbbbbbb cc', 1.9);
    await flush();
    expect(player.getState().word).toEqual({ start: 0, end: 1 });

    let changes = 0;
    player.subscribe(() => changes++);
    audio.currentTime = 0.5;
    frames.tick();
    expect(player.getState().word).toEqual({ start: 2, end: 9 });
    const state = player.getState();
    audio.currentTime = 0.6;
    frames.tick();
    expect(player.getState()).toBe(state);
    audio.currentTime = 1.6;
    frames.tick();
    expect(player.getState().word).toEqual({ start: 10, end: 12 });
    expect(changes).toBe(2);
  });

  it('follows real word timings when the engine reports them', async () => {
    const { player, edge, audio, frames } = setup();
    player.setDocument(sentences('Hi big world'));
    player.setEngine('edge');
    await player.play();
    await flush();
    edge.respond('Hi big world', 2, [
      { start: 0.2, end: 0.4, charStart: 0, charEnd: 2 },
      { start: 0.5, end: 0.7, charStart: 3, charEnd: 6 },
      { start: 1.2, end: 1.6, charStart: 7, charEnd: 12 },
    ]);
    await flush();
    expect(player.getState().word).toBeNull();
    audio.currentTime = 0.3;
    frames.tick();
    expect(player.getState().word).toEqual({ start: 0, end: 2 });
    audio.currentTime = 0.9; // gap: hold the previous word
    frames.tick();
    expect(player.getState().word).toEqual({ start: 3, end: 6 });
    audio.currentTime = 1.3;
    frames.tick();
    expect(player.getState().word).toEqual({ start: 7, end: 12 });
  });

  describe('playFrom', () => {
    // Weights: "a" 1+3, "bbbbbbb" 7+3, "cc" 2+3 → total 19; "cc" starts at 14/19 of the audio.
    it('starts a paused document at the tapped word once the audio is ready', async () => {
      const engine = new FakeEngine('phonon', false);
      const { player, audio } = setup({ engine });
      player.setDocument(sentences('One.', 'Two.', 'a bbbbbbb cc'));
      const playing = player.playFrom(2, 11);
      expect(audio.playCalls).toBe(1); // unlocked inside the gesture
      expect(player.getState()).toMatchObject({ status: 'loading', sentenceIndex: 2 });
      engine.finishLoad();
      await playing;
      expect(player.getState().status).toBe('buffering');
      expect(engine.live()).toEqual(['a bbbbbbb cc']);

      engine.respond('a bbbbbbb cc', 1.9);
      await flush();
      expect(player.getState()).toMatchObject({ status: 'playing', sentenceIndex: 2, word: { start: 10, end: 12 } });
      expect(audio.currentTime).toBeCloseTo(1.4);
      expect(player.getState().elapsed).toBeCloseTo(player.getState().duration - 0.5);
    });

    it('switches immediately from another sentence that is playing', async () => {
      const { player, engine, audio } = setup();
      player.setDocument(sentences('One.', 'a bbbbbbb cc'));
      await player.play();
      engine.respond('One.', 1);
      await flush();
      engine.respond('a bbbbbbb cc', 1.9);
      await flush();
      audio.currentTime = 0.5;

      await player.playFrom(1, 3);
      expect(player.getState()).toMatchObject({ status: 'playing', sentenceIndex: 1, word: { start: 2, end: 9 } });
      expect(audio.currentTime).toBeCloseTo(0.4);
      expect(player.getState().elapsed).toBeCloseTo(1.4);
      expect(audio.paused).toBe(false);
    });

    it('applies the offset only once: not when the sentence is replayed', async () => {
      const { player, engine, audio } = setup();
      player.setDocument(sentences('a bbbbbbb cc', 'Two.'));
      await player.playFrom(0, 10);
      engine.respond('a bbbbbbb cc', 1.9);
      await flush();
      expect(audio.currentTime).toBeCloseTo(1.4);
      engine.respond('Two.', 1);
      await flush();
      player.next();
      player.prev();
      expect(player.getState()).toMatchObject({ status: 'playing', sentenceIndex: 0, word: { start: 0, end: 1 } });
      expect(audio.currentTime).toBe(0);
    });

    it('drops the offset when the user seeks elsewhere while buffering', async () => {
      const { player, engine, audio } = setup();
      player.setDocument(sentences('One.', 'a bbbbbbb cc', 'Three.'));
      await player.playFrom(1, 10);
      expect(player.getState()).toMatchObject({ status: 'buffering', sentenceIndex: 1 });
      player.seek(2);
      await flush();
      // The superseded sentence's audio is ignored, and the offset does not leak into the new one.
      engine.respond('a bbbbbbb cc', 1.9, undefined, true);
      engine.respond('Three.', 2);
      await flush();
      expect(player.getState()).toMatchObject({ status: 'playing', sentenceIndex: 2 });
      expect(audio.currentTime).toBe(0);

      // Back to the tapped sentence by seeking: it starts from the top.
      player.seek(1);
      await flush();
      engine.respond('a bbbbbbb cc', 1.9);
      await flush();
      expect(player.getState()).toMatchObject({ status: 'playing', sentenceIndex: 1, word: { start: 0, end: 1 } });
      expect(audio.currentTime).toBe(0);
    });

    it('keeps the offset through a pause while buffering', async () => {
      const { player, engine, audio } = setup();
      player.setDocument(sentences('a bbbbbbb cc'));
      await player.playFrom(0, 2);
      player.pause();
      await player.play();
      engine.respond('a bbbbbbb cc', 1.9);
      await flush();
      expect(audio.currentTime).toBeCloseTo(0.4);
      expect(player.getState().word).toEqual({ start: 2, end: 9 });
    });

    it('uses real word timings when the engine reports them', async () => {
      const { player, edge, audio } = setup();
      player.setDocument(sentences('Hi big world'));
      player.setEngine('edge');
      await player.playFrom(0, 4);
      await flush();
      edge.respond('Hi big world', 2, [
        { start: 0.2, end: 0.4, charStart: 0, charEnd: 2 },
        { start: 0.5, end: 0.7, charStart: 3, charEnd: 6 },
        { start: 1.2, end: 1.6, charStart: 7, charEnd: 12 },
      ]);
      await flush();
      expect(audio.currentTime).toBe(0.5);
      expect(player.getState()).toMatchObject({ status: 'playing', word: { start: 3, end: 6 } });
      expect(player.getState().elapsed).toBeCloseTo(0.5);
    });

    it('picks the following word for an offset between words, and clamps out-of-range input', async () => {
      const { player, engine, audio } = setup();
      player.setDocument(sentences('One.', 'a bbbbbbb cc'));
      await player.playFrom(1, 9); // the space before "cc"
      engine.respond('a bbbbbbb cc', 1.9);
      await flush();
      expect(player.getState().word).toEqual({ start: 10, end: 12 });

      await player.playFrom(7, 500); // past the last sentence and its end
      expect(player.getState()).toMatchObject({ status: 'playing', sentenceIndex: 1, word: { start: 10, end: 12 } });
      expect(audio.currentTime).toBeCloseTo(1.4);

      await player.playFrom(-3, -1);
      expect(player.getState()).toMatchObject({ sentenceIndex: 0, word: null });
    });

    it('restarts an ended document from the tapped sentence, not the top', async () => {
      const { player, engine, audio } = setup();
      player.setDocument(sentences('One.', 'Two.'));
      await player.play();
      engine.respond('One.', 1);
      await flush();
      engine.respond('Two.', 1);
      await flush();
      audio.finish(1);
      audio.finish(1);
      expect(player.getState().status).toBe('ended');
      await player.playFrom(1);
      expect(player.getState()).toMatchObject({ status: 'playing', sentenceIndex: 1 });
      expect(audio.currentTime).toBe(0);
    });
  });

  it('keeps getState stable, clamps the rate and applies it to the element', () => {
    const { player, audio } = setup();
    const a = player.getState();
    expect(player.getState()).toBe(a);
    player.setRate(10);
    expect(player.getState().rate).toBe(3);
    expect(audio.playbackRate).toBe(3);
    expect(audio.preservesPitch).toBe(true);
    player.setRate(0.1);
    expect(player.getState().rate).toBe(0.5);
    const b = player.getState();
    player.setRate(0.5);
    expect(player.getState()).toBe(b);
  });

  it('reports synthesis errors and retries on play', async () => {
    const { player, engine } = setup();
    player.setDocument(sentences('One.'));
    await player.play();
    engine.fail('One.', new Error('boom'));
    await flush();
    expect(player.getState()).toMatchObject({ status: 'error', error: 'boom' });
    await player.play();
    expect(player.getState()).toMatchObject({ status: 'buffering', error: null });
    engine.respond('One.');
    await flush();
    expect(player.getState().status).toBe('playing');
  });

  it('reports load errors and retries on play', async () => {
    const { player, engine } = setup();
    engine.loadError = new Error('no network');
    player.setDocument(sentences('One.'));
    await player.play();
    expect(player.getState()).toMatchObject({ status: 'error', error: 'no network' });
    engine.loadError = null;
    await player.play();
    expect(player.getState().status).toBe('buffering');
  });

  it('stop clears the queue', async () => {
    const { player, engine } = setup();
    player.setDocument(sentences('One.', 'Two.'));
    await player.play();
    player.stop();
    expect(player.getState()).toMatchObject({ status: 'idle', sentenceIndex: -1, duration: 0 });
    expect(engine.live()).toEqual([]);
  });

  it('exports one WAV with gaps between sentences and blocks, reusing cached audio', async () => {
    const { player, engine } = setup();
    const doc = sentences('One.', 'Two.', 'Three.'); // blocks 0, 0, 1
    player.setDocument(doc);
    await player.play();
    engine.respond('One.', 1);
    await flush();

    const progress = vi.fn();
    const exporting = player.exportWav(doc, { onProgress: progress });
    await flush();
    // 'One.' comes from the cache; the rest is synthesised (the player's own prefetch may also ask).
    engine.respondAll('Two.', 2);
    await flush();
    engine.respondAll('Three.', 1);
    await flush();
    engine.respondAll('Three.', 1);
    const blob = await exporting;
    const samples = (1 + 0.25 + 2 + 0.5 + 1) * RATE;
    expect(blob.size).toBe(44 + samples * 2);
    expect(blob.type).toBe('audio/wav');
    expect(progress).toHaveBeenLastCalledWith(3, 3);
  });

  it('export honours abort', async () => {
    const { player, engine } = setup();
    const controller = new AbortController();
    const exporting = player.exportWav(sentences('One.'), { signal: controller.signal });
    await flush();
    controller.abort();
    await expect(exporting).rejects.toMatchObject({ name: 'AbortError' });
    expect(engine.live()).toEqual([]);
  });
});
