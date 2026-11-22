import { isAbortError, raceAbort, throwIfAborted } from '../tts/common';
import {
  ENGINE_NEEDS_SERVER,
  type EngineId,
  type Player,
  type PlayerState,
  type PlayerStatus,
  type Sentence,
  type SpeechEngine,
  type SynthResult,
} from '../types';
import { AudioCache } from './cache';
import { encodeWav, toInt16, wavFromInt16 } from './wav';
import { estimatedWords, timedWords, type WordTracker } from './words';

/** The parts of an `HTMLAudioElement` the player uses. */
export interface AudioLike {
  src: string;
  playbackRate: number;
  defaultPlaybackRate: number;
  preservesPitch: boolean;
  currentTime: number;
  readonly ended: boolean;
  play(): Promise<void>;
  pause(): void;
  addEventListener(type: 'ended' | 'error', listener: () => void): void;
}

export interface ObjectUrls {
  create(blob: Blob): string;
  revoke(url: string): void;
}

export interface FrameScheduler {
  request(callback: () => void): number;
  cancel(id: number): void;
}

export interface PlayerDeps {
  engines: (id: EngineId) => SpeechEngine;
  createAudio: () => AudioLike;
  urls?: ObjectUrls;
  frames?: FrameScheduler;
  mediaSession?: MediaSession;
}

export const MIN_RATE = 0.5;
export const MAX_RATE = 3;
const LOOKAHEAD_SENTENCES = 6;
const LOOKAHEAD_SECONDS = 60;
/** Cached audio budget; ~17 MB of floats at 24 kHz. */
const CACHE_SECONDS = 180;
/** Parallel requests for server engines; the in-browser engine runs one at a time anyway. */
const REMOTE_CONCURRENCY = 3;
const SENTENCE_GAP_SECONDS = 0.25;
const BLOCK_GAP_SECONDS = 0.5;
const INITIAL_CHARS_PER_SECOND = 15;
/** How many seconds of the initial rate estimate weigh against measured audio. */
const RATE_PRIOR_SECONDS = 5;
const UNLOCK_SECONDS = 0.05;

const ACTIVE: ReadonlySet<PlayerStatus> = new Set(['loading', 'buffering', 'playing']);

const defaultUrls: ObjectUrls = {
  create: (blob) => URL.createObjectURL(blob),
  revoke: (url) => URL.revokeObjectURL(url),
};

const defaultFrames: FrameScheduler = {
  request: (cb) => requestAnimationFrame(cb),
  cancel: (id) => cancelAnimationFrame(id),
};

/**
 * Reads a document sentence by sentence: each sentence is synthesised to PCM,
 * wrapped as WAV and played through one reused audio element, which gives
 * pitch-preserving rate changes and cheap pause/seek. Upcoming sentences are
 * synthesised ahead of time into a bounded cache.
 *
 * `generation` changes whenever cached audio becomes invalid (new document,
 * voice or engine); results from an older generation are dropped.
 */
export class ReadAloudPlayer implements Player {
  private state: PlayerState = {
    status: 'idle',
    sentenceIndex: -1,
    word: null,
    elapsed: 0,
    duration: 0,
    rate: 1,
    engine: 'phonon',
    voice: null,
    modelProgress: null,
    error: null,
  };
  private readonly listeners = new Set<() => void>();
  private readonly audio: AudioLike;
  private readonly urls: ObjectUrls;
  private readonly frames: FrameScheduler;
  private readonly mediaSession: MediaSession | undefined;

  private engine: SpeechEngine;
  /** The current engine finished `load` (as seen by this player). */
  private engineReady = false;
  private sentences: Sentence[] = [];
  private generation = 0;
  private readonly cache: AudioCache;
  /** Real audio length (s) of sentences synthesised in this generation. */
  private readonly durations = new Map<number, number>();
  private readonly failed = new Set<number>();
  private readonly inflight = new Map<number, AbortController>();
  private measuredChars = 0;
  private measuredSeconds = 0;
  private prefix: Float64Array | null = null;

  /** Sentence whose audio the element holds, or null. */
  private loaded: number | null = null;
  private words: WordTracker | null = null;
  /**
   * Where `playFrom` asked the next start of a sentence to begin, as a character offset.
   * Used once, when that sentence's audio starts; dropped by any other move.
   */
  private startOffset: { index: number; charOffset: number } | null = null;
  private url: string | null = null;
  private unlocked = false;
  /** Bumped on every play/pause/load of the element, so a late `play()` rejection is ignored. */
  private playSeq = 0;
  private frameId: number | null = null;

  private readonly resolveEngine: (id: EngineId) => SpeechEngine;

  constructor(deps: PlayerDeps) {
    this.resolveEngine = deps.engines;
    this.engine = deps.engines(this.state.engine);
    this.audio = deps.createAudio();
    this.urls = deps.urls ?? defaultUrls;
    this.frames = deps.frames ?? defaultFrames;
    this.mediaSession = deps.mediaSession;
    this.cache = new AudioCache(CACHE_SECONDS * this.engine.sampleRate);
    this.audio.preservesPitch = true;
    this.audio.addEventListener('ended', this.onEnded);
    this.audio.addEventListener('error', this.onAudioError);
    this.setUpMediaSession();
  }

  // ───────────── store ─────────────

  getState = (): PlayerState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Applies `patch`; elapsed/duration are recomputed in the same update when position or status moves. */
  private set(patch: Partial<PlayerState>, retime = false): void {
    const prev = this.state;
    let next = { ...prev, ...patch };
    if (retime || next.status !== prev.status || next.sentenceIndex !== prev.sentenceIndex) {
      next = { ...next, ...this.timing(next) };
    }
    const keys = Object.keys(next) as (keyof PlayerState)[];
    if (keys.every((k) => sameValue(prev[k], next[k]))) return;
    this.state = next;
    if (prev.status !== next.status) this.onStatusChange(next.status);
    for (const listener of [...this.listeners]) listener();
  }

  private onStatusChange(status: PlayerStatus): void {
    if (status === 'playing') {
      if (this.frameId === null) this.frameId = this.frames.request(this.tick);
    } else if (this.frameId !== null) {
      this.frames.cancel(this.frameId);
      this.frameId = null;
    }
    if (this.mediaSession) {
      this.mediaSession.playbackState = ACTIVE.has(status) ? 'playing' : status === 'paused' ? 'paused' : 'none';
    }
  }

  // ───────────── commands ─────────────

  setDocument(sentences: Sentence[], startIndex = 0): void {
    this.invalidate();
    this.sentences = sentences;
    this.startOffset = null;
    this.unload();
    const empty = sentences.length === 0;
    const sentenceIndex = empty ? -1 : clampIndex(startIndex, sentences.length);
    this.set({ status: empty ? 'idle' : 'paused', sentenceIndex, word: null, error: null }, true);
    this.fill();
  }

  async play(): Promise<void> {
    if (!this.sentences.length) return;
    // Before any await: the element must start inside the user gesture to be allowed to play later.
    this.unlock();
    const { status } = this.state;
    if (ACTIVE.has(status)) return;
    if (status === 'ended') this.moveTo(0);
    if (status === 'error') this.failed.clear();
    this.set({ error: null });

    while (!this.engineReady) {
      const engine = this.engine;
      if (!engine.ready) {
        this.set({ status: 'loading', modelProgress: null });
        let failure: unknown = null;
        try {
          await engine.load((p) => {
            if (this.engine === engine) this.set({ modelProgress: p });
          });
        } catch (error) {
          failure = error ?? new Error('The speech engine failed to load.');
        }
        const current = this.engine === engine;
        // Paused, stopped or replaced while loading: keep the engine, do not start.
        if (this.state.status !== 'loading') {
          if (current && failure === null) {
            this.engineReady = true;
            this.fill();
          }
          return;
        }
        if (!current) continue;
        if (failure !== null) {
          this.fail(failure);
          return;
        }
      }
      this.engineReady = true;
    }
    this.resume();
  }

  async playFrom(sentenceIndex: number, charOffset = 0): Promise<void> {
    if (!this.sentences.length) return;
    // Before any await, like `play`.
    this.unlock();
    const index = clampIndex(sentenceIndex, this.sentences.length);
    this.moveTo(index);
    this.reprioritise();
    const length = this.sentences[index].text.length;
    const offset = Number.isFinite(charOffset) ? Math.min(length, Math.max(0, Math.floor(charOffset))) : 0;
    this.startOffset = offset > 0 ? { index, charOffset: offset } : null;
    const { status } = this.state;
    if (status === 'playing' || status === 'buffering') {
      this.startCurrent();
      return;
    }
    // Still loading the model: `play` picks up the new position once it is ready.
    if (status === 'loading') return;
    // `play` would restart an ended document from the top.
    if (status === 'ended') this.set({ status: 'paused' });
    return this.play();
  }

  pause(): void {
    if (!ACTIVE.has(this.state.status)) return;
    this.playSeq++;
    this.audio.pause();
    this.set({ status: 'paused' });
  }

  toggle(): void {
    if (ACTIVE.has(this.state.status)) this.pause();
    else void this.play();
  }

  seek(sentenceIndex: number): void {
    if (!this.sentences.length) return;
    this.moveTo(clampIndex(sentenceIndex, this.sentences.length));
    this.reprioritise();
    const { status } = this.state;
    if (status === 'playing' || status === 'buffering') this.startCurrent();
    else if (status === 'ended' || status === 'error') this.set({ status: 'paused', error: null });
    this.fill();
  }

  next(): void {
    if (this.state.sentenceIndex < this.sentences.length - 1) this.seek(this.state.sentenceIndex + 1);
  }

  prev(): void {
    if (this.state.sentenceIndex > 0) this.seek(this.state.sentenceIndex - 1);
  }

  setRate(rate: number): void {
    if (!Number.isFinite(rate)) return;
    const clamped = Math.min(MAX_RATE, Math.max(MIN_RATE, rate));
    this.audio.playbackRate = clamped;
    this.audio.defaultPlaybackRate = clamped;
    this.set({ rate: clamped });
  }

  setVoice(voice: string | null): void {
    if (voice === this.state.voice) return;
    this.switchAudioSource(() => this.set({ voice }));
  }

  setEngine(engine: EngineId, voice: string | null = null): void {
    if (engine === this.state.engine && voice === this.state.voice) return;
    this.switchAudioSource(() => {
      if (engine !== this.state.engine) {
        this.engine = this.resolveEngine(engine);
        this.engineReady = false;
      }
      this.set({ engine, voice, modelProgress: null });
    });
  }

  stop(): void {
    this.invalidate();
    this.sentences = [];
    this.startOffset = null;
    this.unload();
    this.releaseUrl();
    this.set({ status: 'idle', sentenceIndex: -1, word: null, error: null }, true);
  }

  async exportWav(
    sentences: Sentence[],
    opts: { onProgress?: (done: number, total: number) => void; signal?: AbortSignal } = {},
  ): Promise<Blob> {
    const { onProgress, signal } = opts;
    throwIfAborted(signal);
    const engine = this.engine;
    const voice = this.state.voice;
    await raceAbort(engine.load(), signal);
    const rate = engine.sampleRate;
    const parts: Int16Array[] = [];
    onProgress?.(0, sentences.length);
    for (const [k, sentence] of sentences.entries()) {
      if (k > 0) {
        const gap = sentence.block === sentences[k - 1].block ? SENTENCE_GAP_SECONDS : BLOCK_GAP_SECONDS;
        parts.push(new Int16Array(Math.round(rate * gap)));
      }
      const cached = this.engine === engine && this.state.voice === voice ? this.cachedFor(sentence) : undefined;
      const result = cached ?? (await engine.synth(sentence.text, { voice, signal }));
      throwIfAborted(signal);
      parts.push(toInt16(result.pcm));
      onProgress?.(k + 1, sentences.length);
    }
    return wavFromInt16(parts, rate);
  }

  // ───────────── playback ─────────────

  /** Plays the loaded sentence from where it was paused, or starts the current one. */
  private resume(): void {
    if (this.loaded === this.state.sentenceIndex && !this.audio.ended) this.playAudio();
    else this.startCurrent();
  }

  private startCurrent(): void {
    const index = this.state.sentenceIndex;
    const result = this.cache.get(index);
    if (!result) {
      this.failed.delete(index);
      this.unload();
      this.set({ status: 'buffering', word: null });
      this.fill();
      return;
    }
    const sentence = this.sentences[index];
    this.releaseUrl();
    this.url = this.urls.create(encodeWav(result.pcm, this.engine.sampleRate));
    this.audio.src = this.url;
    // Chrome still reports the old source's position until the new one loads.
    this.audio.currentTime = 0;
    // Loading a new source resets playbackRate to defaultPlaybackRate.
    this.audio.defaultPlaybackRate = this.state.rate;
    this.audio.playbackRate = this.state.rate;
    this.audio.preservesPitch = true;
    this.loaded = index;
    this.words = result.words ? timedWords(result.words) : estimatedWords(sentence.text);
    const from = this.startOffset;
    this.startOffset = null;
    if (from?.index === index) {
      const duration = this.durations.get(index) ?? result.pcm.length / this.engine.sampleRate;
      this.audio.currentTime = this.words.startOf(from.charOffset, duration);
    }
    this.playAudio();
  }

  private playAudio(): void {
    const seq = ++this.playSeq;
    this.set({ status: 'playing' });
    this.updateWord();
    this.audio.play().catch((error: unknown) => {
      if (seq !== this.playSeq || isAbortError(error)) return;
      this.fail(
        error instanceof DOMException && error.name === 'NotAllowedError'
          ? new Error('The browser blocked playback. Press play again.')
          : error,
      );
    });
    this.fill();
  }

  private readonly onEnded = (): void => {
    const index = this.state.sentenceIndex;
    if (this.loaded !== index || !this.audio.ended || this.state.status !== 'playing') return;
    if (index + 1 >= this.sentences.length) {
      this.loaded = null;
      this.set({ status: 'ended', word: null });
      return;
    }
    this.set({ sentenceIndex: index + 1, word: null });
    this.failed.delete(index + 1);
    this.startCurrent();
  };

  private readonly onAudioError = (): void => {
    if (this.loaded === null || this.audio.src !== this.url || !ACTIVE.has(this.state.status)) return;
    this.fail(new Error('The audio could not be played.'));
  };

  /** Plays a moment of silence so the element counts as started by the user. */
  private unlock(): void {
    if (this.unlocked) return;
    this.unlocked = true;
    const rate = this.engine.sampleRate;
    this.releaseUrl();
    this.unload();
    this.url = this.urls.create(encodeWav(new Float32Array(Math.round(rate * UNLOCK_SECONDS)), rate));
    this.audio.src = this.url;
    this.audio.play().catch(() => {});
  }

  private moveTo(index: number): void {
    this.startOffset = null;
    this.unload();
    this.failed.delete(index);
    this.set({ sentenceIndex: index, word: null }, true);
  }

  /** Stops the element and forgets which sentence it held (its URL is released on replacement). */
  private unload(): void {
    this.playSeq++;
    this.audio.pause();
    this.loaded = null;
    this.words = null;
  }

  private releaseUrl(): void {
    if (this.url) this.urls.revoke(this.url);
    this.url = null;
  }

  private fail(error: unknown): void {
    this.playSeq++;
    this.audio.pause();
    this.set({ status: 'error', error: errorMessage(error), word: null });
  }

  /** Applies a voice or engine change: old audio is dropped, position and play state kept. */
  private switchAudioSource(apply: () => void): void {
    const wasActive = ACTIVE.has(this.state.status);
    this.invalidate();
    this.unload();
    apply();
    if (wasActive && this.state.status !== 'loading') {
      if (this.engineReady) this.startCurrent();
      else {
        this.set({ status: 'paused' });
        void this.play();
      }
    }
    this.refreshTiming();
    this.fill();
  }

  // ───────────── word tracking ─────────────

  private readonly tick = (): void => {
    this.frameId = null;
    if (this.state.status !== 'playing') return;
    this.updateWord();
    this.frameId = this.frames.request(this.tick);
  };

  private updateWord(): void {
    const index = this.state.sentenceIndex;
    const duration = this.durations.get(index);
    if (this.loaded !== index || !this.words || duration === undefined) return;
    const word = this.words.at(this.audio.currentTime, duration);
    if (sameValue(word, this.state.word)) return;
    this.set({ word }, true);
  }

  // ───────────── timing ─────────────

  private refreshTiming(): void {
    this.set({}, true);
  }

  private timing({ status, sentenceIndex }: PlayerState): Pick<PlayerState, 'elapsed' | 'duration'> {
    if (sentenceIndex < 0) return { elapsed: 0, duration: 0 };
    const prefix = this.prefixSums();
    const duration = prefix[prefix.length - 1];
    if (status === 'ended') return { elapsed: duration, duration };
    const position = this.loaded === sentenceIndex ? this.audio.currentTime : 0;
    return { elapsed: this.elapsedAt(sentenceIndex, position), duration };
  }

  private elapsedAt(index: number, position: number): number {
    const prefix = this.prefixSums();
    return prefix[index] + Math.min(Math.max(0, position), this.durationOf(index));
  }

  private durationOf(index: number): number {
    const known = this.durations.get(index);
    if (known !== undefined) return known;
    const cps =
      (INITIAL_CHARS_PER_SECOND * RATE_PRIOR_SECONDS + this.measuredChars) /
      (RATE_PRIOR_SECONDS + this.measuredSeconds);
    return this.sentences[index].text.length / cps;
  }

  private prefixSums(): Float64Array {
    if (!this.prefix) {
      const prefix = new Float64Array(this.sentences.length + 1);
      for (let i = 0; i < this.sentences.length; i++) prefix[i + 1] = prefix[i] + this.durationOf(i);
      this.prefix = prefix;
    }
    return this.prefix;
  }

  // ───────────── synthesis ─────────────

  /** Drops all audio of the current generation and cancels its requests. */
  private invalidate(): void {
    this.generation++;
    for (const controller of this.inflight.values()) controller.abort();
    this.inflight.clear();
    this.cache.clear();
    this.durations.clear();
    this.failed.clear();
    this.prefix = null;
  }

  /** Sentences to keep synthesised: the current one and a bounded stretch after it. */
  private window(): number[] {
    const out: number[] = [];
    let seconds = 0;
    const start = Math.max(0, this.state.sentenceIndex);
    for (let i = start; i < this.sentences.length; i++) {
      if (out.length >= LOOKAHEAD_SENTENCES || seconds >= LOOKAHEAD_SECONDS) break;
      out.push(i);
      seconds += this.durationOf(i);
    }
    return out;
  }

  /** Cancels requests for sentences that left the window. */
  private reprioritise(): void {
    const wanted = new Set(this.window());
    for (const [index, controller] of this.inflight) {
      if (wanted.has(index)) continue;
      controller.abort();
      this.inflight.delete(index);
    }
  }

  /** Starts requests for missing sentences in the window, up to the engine's concurrency. */
  private fill(): void {
    const { status, engine } = this.state;
    if (!this.engineReady || status === 'idle' || status === 'ended' || status === 'error') return;
    const limit = ENGINE_NEEDS_SERVER[engine] ? REMOTE_CONCURRENCY : 1;
    for (const index of this.window()) {
      if (this.inflight.size >= limit) return;
      if (!this.cache.has(index) && !this.failed.has(index) && !this.inflight.has(index)) this.request(index);
    }
  }

  private request(index: number): void {
    const generation = this.generation;
    const controller = new AbortController();
    this.inflight.set(index, controller);
    this.engine
      .synth(this.sentences[index].text, { voice: this.state.voice, signal: controller.signal })
      .then(
        (result) => {
          if (generation === this.generation && !controller.signal.aborted) this.store(index, result);
        },
        (error: unknown) => {
          if (generation !== this.generation || controller.signal.aborted || isAbortError(error)) return;
          this.failed.add(index);
          if (index === this.state.sentenceIndex && this.state.status === 'buffering') this.fail(error);
        },
      )
      .finally(() => {
        if (this.inflight.get(index) !== controller) return;
        this.inflight.delete(index);
        this.fill();
      });
  }

  private store(index: number, result: SynthResult): void {
    const seconds = result.pcm.length / this.engine.sampleRate;
    const keep = new Set(this.window());
    this.cache.set(index, result, (k) => keep.has(k));
    if (!this.durations.has(index)) {
      this.measuredChars += this.sentences[index].text.length;
      this.measuredSeconds += seconds;
    }
    this.durations.set(index, seconds);
    this.prefix = null;
    if (index === this.state.sentenceIndex && this.state.status === 'buffering') this.startCurrent();
    this.refreshTiming();
  }

  private cachedFor(sentence: Sentence): SynthResult | undefined {
    return this.sentences[sentence.index]?.text === sentence.text ? this.cache.peek(sentence.index) : undefined;
  }

  // ───────────── media session ─────────────

  private setUpMediaSession(): void {
    const session = this.mediaSession;
    if (!session) return;
    const handlers: [MediaSessionAction, () => void][] = [
      ['play', () => void this.play()],
      ['pause', () => this.pause()],
      ['previoustrack', () => this.prev()],
      ['nexttrack', () => this.next()],
    ];
    for (const [action, handler] of handlers) {
      try {
        session.setActionHandler(action, handler);
      } catch {
        // Browsers throw for actions they do not support.
      }
    }
  }
}

function clampIndex(index: number, length: number): number {
  return Math.min(length - 1, Math.max(0, Math.round(Number.isFinite(index) ? index : 0)));
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  const ka = Object.keys(a);
  return (
    ka.length === Object.keys(b).length &&
    ka.every((k) => (a as Record<string, unknown>)[k] === (b as Record<string, unknown>)[k])
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error);
}
