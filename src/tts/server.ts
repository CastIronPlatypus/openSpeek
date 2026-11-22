import type { ServerStatus, SpeechEngine, SynthResult, VoiceInfo, WordTiming } from '../types';
import {
  SAMPLE_RATE,
  abortError,
  isAbortError,
  isUnspeakable,
  shortSilence,
  throwIfAborted,
} from './common';

const STATUS_TTL_MS = 10_000;
const HEALTH_TIMEOUT_MS = 5_000;

const UNREACHABLE: ServerStatus = {
  reachable: false,
  engines: { phonon: false, edge: false },
  fetch: false,
};

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

/** The openSpeek server (docs/server-api.md) at a configurable base URL. */
export class ServerConnection {
  private base = '';
  private status: { at: number; value: Promise<ServerStatus> } | null = null;

  constructor(
    private readonly fetcher: Fetcher = (input, init) => fetch(input, init),
    private readonly now: () => number = Date.now,
  ) {}

  /** The base URL in use; `''` means the page's own origin. */
  get baseUrl(): string {
    return this.base;
  }

  setUrl(url: string): void {
    const base = url.trim().replace(/\/+$/, '');
    if (base === this.base) return;
    this.base = base;
    this.status = null;
  }

  /** For messages: where the server is expected. */
  describe(): string {
    return this.base || globalThis.location?.origin || 'this site';
  }

  request(path: string, init?: RequestInit): Promise<Response> {
    return this.fetcher(`${this.base}${path}`, init);
  }

  /** Never rejects. Answers from a cache younger than `maxAgeMs`. */
  getStatus(maxAgeMs = STATUS_TTL_MS): Promise<ServerStatus> {
    const cached = this.status;
    if (cached && this.now() - cached.at < maxAgeMs) return cached.value;
    const entry = { at: this.now(), value: this.fetchStatus() };
    this.status = entry;
    return entry.value;
  }

  private async fetchStatus(): Promise<ServerStatus> {
    try {
      const res = await this.request('/api/health', { signal: timeoutSignal(HEALTH_TIMEOUT_MS) });
      if (!res.ok) return UNREACHABLE;
      const body: unknown = await res.json();
      if (!isRecord(body)) return UNREACHABLE;
      const engines = isRecord(body.engines) ? body.engines : {};
      return {
        reachable: true,
        engines: { phonon: engines.phonon === true, edge: engines.edge === true },
        fetch: body.fetch === true,
      };
    } catch {
      return UNREACHABLE;
    }
  }
}

/** Turns encoded audio (mp3 / wav bytes) into mono PCM at `sampleRate`. */
export type AudioDecoder = (bytes: ArrayBuffer, sampleRate: number) => Promise<Float32Array>;

let decodeContext: OfflineAudioContext | null = null;

/** Web Audio decoding: an OfflineAudioContext resamples to its own rate while decoding. */
export const webAudioDecoder: AudioDecoder = async (bytes, sampleRate) => {
  if (decodeContext?.sampleRate !== sampleRate) decodeContext = new OfflineAudioContext(1, 1, sampleRate);
  const buffer = await decodeContext.decodeAudioData(bytes);
  if (buffer.numberOfChannels === 1) return buffer.getChannelData(0).slice();
  const mono = new Float32Array(buffer.length);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const channel = buffer.getChannelData(c);
    for (let i = 0; i < mono.length; i++) mono[i] += channel[i];
  }
  for (let i = 0; i < mono.length; i++) mono[i] /= buffer.numberOfChannels;
  return mono;
};

export type RemoteEngineId = 'phonon-server' | 'edge';

const SERVER_ENGINE: Record<RemoteEngineId, 'phonon' | 'edge'> = {
  'phonon-server': 'phonon',
  edge: 'edge',
};

const ENGINE_LABEL: Record<RemoteEngineId, string> = {
  'phonon-server': 'server-side Phonon',
  edge: 'Edge voices',
};

/** An engine that synthesises on the openSpeek server. */
export class RemoteEngine implements SpeechEngine {
  readonly sampleRate = SAMPLE_RATE;
  /** Base URL the last successful `load` checked; `ready` only holds for that server. */
  private loadedFor: string | null = null;
  private loading: { base: string; promise: Promise<void> } | null = null;
  private readonly voices = new Map<string, VoiceInfo[]>();

  constructor(
    readonly id: RemoteEngineId,
    private readonly server: ServerConnection,
    private readonly decode: AudioDecoder = webAudioDecoder,
  ) {}

  private get serverEngine(): 'phonon' | 'edge' {
    return SERVER_ENGINE[this.id];
  }

  get ready(): boolean {
    return this.loadedFor === this.server.baseUrl;
  }

  load(): Promise<void> {
    if (this.ready) return Promise.resolve();
    const base = this.server.baseUrl;
    if (this.loading?.base !== base) {
      const promise = this.check(base).finally(() => {
        if (this.loading?.promise === promise) this.loading = null;
      });
      this.loading = { base, promise };
    }
    return this.loading.promise;
  }

  private async check(base: string): Promise<void> {
    const status = await this.server.getStatus(0);
    if (!status.reachable) {
      throw new Error(
        `Can't reach the openSpeek server at ${this.server.describe()} — start it with \`npm run server\` or pick the in-browser Phonon engine.`,
      );
    }
    if (!status.engines[this.serverEngine]) {
      throw new Error(
        `The openSpeek server at ${this.server.describe()} doesn't offer ${ENGINE_LABEL[this.id]} right now — pick another engine.`,
      );
    }
    if (base === this.server.baseUrl) this.loadedFor = base;
  }

  async listVoices(): Promise<VoiceInfo[]> {
    const base = this.server.baseUrl;
    const cached = this.voices.get(base);
    if (cached) return cached;
    try {
      const res = await this.server.request(`/api/voices?engine=${this.serverEngine}`);
      if (!res.ok) return [];
      const body: unknown = await res.json();
      const list = isRecord(body) && Array.isArray(body.voices) ? body.voices : [];
      const voices = list.flatMap(parseVoice);
      this.voices.set(base, voices);
      return voices;
    } catch {
      return [];
    }
  }

  async synth(
    text: string,
    opts: { voice?: string | null; signal?: AbortSignal } = {},
  ): Promise<SynthResult> {
    const { signal } = opts;
    throwIfAborted(signal);
    if (isUnspeakable(text)) return { pcm: shortSilence(this.sampleRate) };

    let body: unknown;
    try {
      const res = await this.server.request('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ engine: this.serverEngine, text, voice: opts.voice ?? undefined }),
        signal,
      });
      body = await res.json().catch(() => null);
      if (!res.ok) {
        const message = isRecord(body) && typeof body.error === 'string' ? body.error : `HTTP ${res.status}`;
        throw new Error(`Speech server error: ${message}`);
      }
    } catch (error) {
      if (signal?.aborted || isAbortError(error)) throw abortError();
      if (error instanceof TypeError) {
        throw new Error(`Can't reach the openSpeek server at ${this.server.describe()}.`);
      }
      throw error;
    }
    if (!isRecord(body) || typeof body.audio !== 'string') {
      throw new Error('Speech server error: the response has no audio.');
    }
    const pcm = await this.decode(base64ToBytes(body.audio), this.sampleRate);
    throwIfAborted(signal);
    const words = Array.isArray(body.words) ? parseWords(body.words, text.length) : [];
    return words.length ? { pcm, words } : { pcm };
  }

  dispose(): void {
    this.loadedFor = null;
    this.voices.clear();
  }
}

function parseVoice(value: unknown): VoiceInfo[] {
  if (!isRecord(value) || typeof value.name !== 'string' || !value.name) return [];
  const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
  return [
    {
      name: value.name,
      gender: str(value.gender),
      age: str(value.age),
      locale: str(value.locale),
      description: str(value.description),
    },
  ];
}

/** Keeps well-formed timings, with offsets clamped into the text. */
function parseWords(values: unknown[], textLength: number): WordTiming[] {
  const words: WordTiming[] = [];
  for (const v of values) {
    if (!isRecord(v)) continue;
    const { start, end, charStart, charEnd } = v;
    if (![start, end, charStart, charEnd].every((n) => typeof n === 'number' && Number.isFinite(n))) continue;
    const cs = Math.max(0, Math.min(charStart as number, textLength));
    const ce = Math.max(cs, Math.min(charEnd as number, textLength));
    if (ce === cs) continue;
    words.push({ start: start as number, end: Math.max(start as number, end as number), charStart: cs, charEnd: ce });
  }
  return words.sort((a, b) => a.start - b.start);
}

function base64ToBytes(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function timeoutSignal(ms: number): AbortSignal | undefined {
  return typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(ms) : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
