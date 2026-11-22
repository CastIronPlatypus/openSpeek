/**
 * Shared contracts for openSpeek. Every module codes against these types;
 * change them only with the integrator's agreement.
 */

// ───────────────────────── Documents ─────────────────────────

export type BlockKind = 'heading' | 'paragraph';

/** One structural unit of a document, in reading order. */
export interface Block {
  kind: BlockKind;
  /** Heading level 1-6; absent for paragraphs. */
  level?: number;
  /** Plain text, whitespace collapsed, never empty. */
  text: string;
}

export type SourceKind = 'text' | 'pdf' | 'epub' | 'docx' | 'html' | 'web' | 'markdown';

export interface DocSource {
  kind: SourceKind;
  /** Original file name, when imported from a file. */
  fileName?: string;
  /** Original URL, when imported from the web. */
  url?: string;
}

/** What an importer returns: a document not yet saved to the library. */
export interface DocumentDraft {
  title: string;
  source: DocSource;
  blocks: Block[];
}

/** Library listing entry (no body). */
export interface DocMeta {
  id: string;
  title: string;
  source: DocSource;
  createdAt: number;
  /** Last opened or modified, ms since epoch. Library sorts by this, newest first. */
  updatedAt: number;
  wordCount: number;
  sentenceCount: number;
  /** Index of the sentence to resume from. */
  progress: number;
}

export interface StoredDocument extends DocMeta {
  blocks: Block[];
}

/** A speakable unit. Sentences are derived from blocks, never stored. */
export interface Sentence {
  /** Position in the document's flat sentence list. */
  index: number;
  /** Index into `blocks`. */
  block: number;
  /** Offsets into `blocks[block].text`; `text === blockText.slice(start, end)`. */
  start: number;
  end: number;
  text: string;
}

// ───────────────────────── Settings ─────────────────────────

export type Theme = 'system' | 'light' | 'dark';

export interface Settings {
  /** Which speech engine reads aloud. */
  engine: EngineId;
  /** Chosen voice per engine; `null` means that engine's default voice. */
  voices: Record<EngineId, string | null>;
  /**
   * Base URL of the openSpeek server (see docs/server-api.md) used by the server-side
   * engines and for fetching web pages. Empty string means the page's own origin.
   */
  serverUrl: string;
  /** Playback rate, 0.5 – 3. Pitch is preserved. */
  rate: number;
  theme: Theme;
  /** Reader font size in px. */
  fontSize: number;
  /** Scroll the reader to keep the spoken sentence in view. */
  autoScroll: boolean;
  /** Optional CORS proxy prefix for URL import, e.g. `https://example.com/?url=`. */
  corsProxy: string;
}

export const DEFAULT_SETTINGS: Settings = {
  engine: 'phonon',
  voices: { phonon: null, 'phonon-server': null, edge: null },
  serverUrl: '',
  rate: 1,
  theme: 'system',
  fontSize: 19,
  autoScroll: true,
  corsProxy: '',
};

// ───────────────────────── Speech engine ─────────────────────────

/**
 * - `phonon`: Phonon running in this browser (WebAssembly). Private, works offline.
 * - `phonon-server`: Phonon running on the openSpeek server; for devices too slow to run it.
 * - `edge`: Microsoft Edge's online neural voices, reached through the openSpeek server
 *   (browsers cannot call that service directly). Text is sent to Microsoft.
 */
export type EngineId = 'phonon' | 'phonon-server' | 'edge';

export const ENGINE_IDS: readonly EngineId[] = ['phonon', 'phonon-server', 'edge'];

/** Whether an engine needs the openSpeek server. */
export const ENGINE_NEEDS_SERVER: Record<EngineId, boolean> = {
  phonon: false,
  'phonon-server': true,
  edge: true,
};

/** What the server at `Settings.serverUrl` offers right now. */
export interface ServerStatus {
  reachable: boolean;
  engines: { phonon: boolean; edge: boolean };
  /** The server can fetch web pages for URL import (`GET /api/fetch?url=`). */
  fetch: boolean;
}

/** Real word timing from an engine that reports it (Edge does, Phonon does not). */
export interface WordTiming {
  /** Seconds from the start of the audio. */
  start: number;
  end: number;
  /** Offsets into the synthesised text. */
  charStart: number;
  charEnd: number;
}

export interface SynthResult {
  /** Mono PCM at the engine's `sampleRate`. */
  pcm: Float32Array;
  /** Present only when the engine reports word timings. */
  words?: WordTiming[];
}

export interface VoiceInfo {
  /** Unique name, passed back as `voice`. */
  name: string;
  gender?: string;
  age?: string;
  locale?: string;
  description?: string;
}

/** Model download progress, 0–1 across all files. */
export interface ModelProgress {
  loaded: number;
  total: number;
  fraction: number;
}

export interface SpeechEngine {
  readonly id: EngineId;
  /**
   * Idempotent. `phonon` downloads (first time) and initialises the model, reporting progress;
   * server engines check the server is reachable and offers the engine, rejecting with a
   * user-readable Error otherwise.
   */
  load(onProgress?: (p: ModelProgress) => void): Promise<void>;
  readonly ready: boolean;
  readonly sampleRate: number;
  /** Voices this engine offers. Works before `load`. Resolves to `[]` when they cannot be listed. */
  listVoices(): Promise<VoiceInfo[]>;
  /** Synthesise one sentence. Rejects with an AbortError when `signal` aborts. */
  synth(text: string, opts?: { voice?: string | null; signal?: AbortSignal }): Promise<SynthResult>;
  dispose(): void;
}

// ───────────────────────── Player ─────────────────────────

export type PlayerStatus =
  | 'idle' //       nothing loaded
  | 'loading' //    model is downloading / initialising (see `modelProgress`)
  | 'buffering' //  waiting for the current sentence's audio
  | 'playing'
  | 'paused'
  | 'ended' //      reached the end of the document
  | 'error';

export interface PlayerState {
  status: PlayerStatus;
  /** Sentence being (or about to be) spoken; -1 when idle. */
  sentenceIndex: number;
  /**
   * Word being spoken, as offsets into the current sentence's text, or `null`.
   * Uses the engine's real word timings when it reports them (Edge); otherwise
   * (Phonon) it is interpolated from audio position weighted by word length.
   */
  word: { start: number; end: number } | null;
  /** Seconds elapsed / estimated total for the whole document at rate 1. */
  elapsed: number;
  duration: number;
  rate: number;
  engine: EngineId;
  /** Voice in use for the current engine. */
  voice: string | null;
  modelProgress: ModelProgress | null;
  error: string | null;
}

export interface Player {
  getState(): PlayerState;
  /** `useSyncExternalStore`-compatible. `getState()` returns a new object only on change. */
  subscribe(listener: () => void): () => void;

  /** Replace the queue. Does not start playback; status becomes `paused` at `startIndex`. */
  setDocument(sentences: Sentence[], startIndex?: number): void;
  /** Must be callable from a user gesture; loads the model on first use. */
  play(): Promise<void>;
  pause(): void;
  toggle(): void;
  /**
   * Start playing from a spot the user picked, whatever the current state (must be callable
   * from a user gesture, like `play`). `charOffset` is an offset into that sentence's text;
   * playback begins at the start of the word containing it (using real word timings when the
   * engine has them, the length-weighted estimate otherwise). Omitted or 0 starts the sentence.
   */
  playFrom(sentenceIndex: number, charOffset?: number): Promise<void>;
  /** Jump to a sentence, keeping the play/pause state. */
  seek(sentenceIndex: number): void;
  next(): void;
  prev(): void;
  setRate(rate: number): void;
  /**
   * Switch speech engine, keeping position and play/pause state. Discards cached audio;
   * the voice resets to `voice` (default: that engine's default voice).
   */
  setEngine(engine: EngineId, voice?: string | null): void;
  /** Voice for the current engine. Changing it discards audio synthesised with the old one. */
  setVoice(voice: string | null): void;
  /** Stop and clear the queue; status becomes `idle`. */
  stop(): void;

  /** Render sentences to one WAV file (independent of playback). */
  exportWav(
    sentences: Sentence[],
    opts?: { onProgress?: (done: number, total: number) => void; signal?: AbortSignal },
  ): Promise<Blob>;
}

// ───────────────────────── Module entry points ─────────────────────────
//
// src/tts/index.ts      export function getEngine(id: EngineId): SpeechEngine  (one singleton per id)
//                       export function setServerUrl(url: string): void       ('' = same origin)
//                       export function getServerStatus(): Promise<ServerStatus>  (never rejects; briefly cached)
// src/player/index.ts   export function getPlayer(): Player                   (singleton, uses getEngine)
//
// src/ingest/index.ts   export function segment(blocks: Block[]): Sentence[]
//                       export function importText(text: string, title?: string): DocumentDraft
//                       export function importFile(file: File): Promise<DocumentDraft>
//                       export function importUrl(url: string, corsProxy?: string): Promise<DocumentDraft>
//                       export const ACCEPTED_FILE_TYPES: string   (for <input accept>)
//
// src/library/index.ts  export function listDocuments(): Promise<DocMeta[]>
//                       export function getDocument(id: string): Promise<StoredDocument | undefined>
//                       export function addDocument(draft: DocumentDraft): Promise<StoredDocument>
//                       export function renameDocument(id: string, title: string): Promise<void>
//                       export function deleteDocument(id: string): Promise<void>
//                       export function saveProgress(id: string, sentenceIndex: number): Promise<void>
//                       export function loadSettings(): Promise<Settings>
//                       export function saveSettings(patch: Partial<Settings>): Promise<Settings>
//
// src/ui/App.tsx        export default function App()
// src/main.tsx          mounts <App/> (owned by the UI module)
