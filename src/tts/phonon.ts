import type { LoadOptions, LoadProgress, SpeechOptions, SpeechStream } from 'phonon-tts';
import type { ModelProgress, SpeechEngine, SynthResult, VoiceInfo } from '../types';
import {
  SAMPLE_RATE,
  abortError,
  isUnspeakable,
  raceAbort,
  shortSilence,
  throwIfAborted,
} from './common';
import { ProgressAggregator } from './progress';
import { VOICE_CATALOG_BASE, VoiceCatalog, toVoiceInfo } from './voices';

/** Where Phonon generates. `'auto'` would try WebGPU first; the CPU is the predictable default. */
export const PHONON_DEVICE: LoadOptions['device'] = 'cpu';

/** Size of the default model's q8 weights, for progress before the download reports its own. */
const EXPECTED_WEIGHTS_BYTES = 64_000_000;

/** The slice of a loaded `PhononTTS` this engine uses. */
export interface PhononModel {
  readonly sampleRate: number;
  readonly voices: string[];
  readonly device: string;
  readonly threads: number;
  readonly threadsReason: string;
  addVoice(name: string, source: string): Promise<void>;
  stream(text: string, options?: SpeechOptions): SpeechStream;
  dispose(): void;
}

export interface PhononApi {
  load(options: LoadOptions): Promise<PhononModel>;
  concatPcm(chunks: Float32Array[]): Float32Array;
}

/** Imported on first use so the app shell loads without the package. */
async function importPhonon(): Promise<PhononApi> {
  const { PhononTTS, concatPcm } = await import('phonon-tts');
  return { load: (options) => PhononTTS.load(options), concatPcm };
}

/** Phonon 31m (English) running in this browser, on a worker. */
export class PhononEngine implements SpeechEngine {
  readonly id = 'phonon' as const;
  private model: PhononModel | null = null;
  private api: PhononApi | null = null;
  private loading: Promise<void> | null = null;
  private readonly progressListeners = new Set<(p: ModelProgress) => void>();
  private lastProgress: ModelProgress | null = null;
  /** Catalog voices registered with the current model, by name. */
  private registered = new Map<string, Promise<void>>();
  /** Bumped by `dispose`, so a load that finishes afterwards is thrown away. */
  private epoch = 0;

  constructor(
    private readonly importApi: () => Promise<PhononApi> = importPhonon,
    private readonly catalog: VoiceCatalog = new VoiceCatalog(),
  ) {}

  get ready(): boolean {
    return this.model !== null;
  }

  get sampleRate(): number {
    return this.model?.sampleRate ?? SAMPLE_RATE;
  }

  /** Where generation runs, once loaded; for diagnostics. */
  get info(): { device: string; threads: number; threadsReason: string } | null {
    const m = this.model;
    return m && { device: m.device, threads: m.threads, threadsReason: m.threadsReason };
  }

  load(onProgress?: (p: ModelProgress) => void): Promise<void> {
    if (this.model) {
      onProgress?.({ loaded: 1, total: 1, fraction: 1 });
      return Promise.resolve();
    }
    if (onProgress) {
      this.progressListeners.add(onProgress);
      if (this.lastProgress) onProgress(this.lastProgress);
    }
    this.loading ??= this.doLoad().finally(() => {
      this.loading = null;
      this.lastProgress = null;
      this.progressListeners.clear();
    });
    return this.loading;
  }

  private async doLoad(): Promise<void> {
    const epoch = this.epoch;
    const aggregator = new ProgressAggregator({ weights: EXPECTED_WEIGHTS_BYTES });
    const emit = (p: ModelProgress) => {
      this.lastProgress = p;
      for (const listener of this.progressListeners) listener(p);
    };
    const api = (this.api ??= await this.importApi());
    const model = await api.load({
      lang: 'en',
      device: PHONON_DEVICE,
      onProgress: (p: LoadProgress) => emit(aggregator.update(p)),
    });
    if (epoch !== this.epoch) {
      model.dispose();
      throw new Error('The speech engine was disposed while loading.');
    }
    this.model = model;
    this.registered = new Map();
    emit(aggregator.complete());
  }

  async listVoices(): Promise<VoiceInfo[]> {
    return (await this.catalog.list()).map(toVoiceInfo);
  }

  async synth(
    text: string,
    opts: { voice?: string | null; signal?: AbortSignal } = {},
  ): Promise<SynthResult> {
    const { signal } = opts;
    throwIfAborted(signal);
    if (isUnspeakable(text)) return { pcm: shortSilence(this.sampleRate) };
    await raceAbort(this.load(), signal);
    const model = this.model;
    const api = this.api;
    if (!model || !api) throw new Error('The speech model was unloaded.');
    const voice = await raceAbort(this.resolveVoice(model, opts.voice ?? null), signal);
    throwIfAborted(signal);

    const chunks: Float32Array[] = [];
    try {
      // An abort ends this loop early without an error; the check below turns it into one.
      for await (const pcm of model.stream(text, { voice, signal })) chunks.push(pcm);
    } catch (error) {
      if (signal?.aborted) throw abortError();
      throw error;
    }
    throwIfAborted(signal);
    return { pcm: api.concatPcm(chunks) };
  }

  /** The name to pass to the model, registering a catalog voice on first use. */
  private async resolveVoice(model: PhononModel, name: string | null): Promise<string | undefined> {
    if (!name || model.voices.includes(name)) return name ?? undefined;
    let registering = this.registered.get(name);
    if (!registering) {
      registering = this.register(model, name);
      this.registered.set(name, registering);
      registering.catch(() => this.registered.delete(name));
    }
    await registering;
    // A voice missing from the catalog (e.g. a stale setting) falls back to the default voice.
    return model.voices.includes(name) ? name : undefined;
  }

  private async register(model: PhononModel, name: string): Promise<void> {
    const entry = await this.catalog.find(name);
    if (!entry) {
      console.warn(`[openSpeek] unknown Phonon voice "${name}", using the default voice`);
      return;
    }
    await model.addVoice(name, VOICE_CATALOG_BASE + entry.filename);
  }

  dispose(): void {
    this.epoch++;
    this.model?.dispose();
    this.model = null;
    this.registered = new Map();
  }
}
