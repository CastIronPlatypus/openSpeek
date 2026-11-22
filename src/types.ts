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
  /** Voice name as listed by the engine; `null` means the model's default voice. */
  voice: string | null;
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
  voice: null,
  rate: 1,
  theme: 'system',
  fontSize: 19,
  autoScroll: true,
  corsProxy: '',
};

// ───────────────────────── Speech engine ─────────────────────────

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
  /** Idempotent: downloads (first time) and initialises the Phonon model. */
  load(onProgress?: (p: ModelProgress) => void): Promise<void>;
  readonly ready: boolean;
  readonly sampleRate: number;
  /** Voices available for the loaded language. Works before `load` (fetches the catalog). */
  listVoices(): Promise<VoiceInfo[]>;
  /** Synthesise one sentence to mono PCM. Rejects with an AbortError when `signal` aborts. */
  synth(text: string, opts?: { voice?: string | null; signal?: AbortSignal }): Promise<Float32Array>;
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
   * Estimated word being spoken, as offsets into the current sentence's text,
   * or `null`. Phonon gives no word timings, so this is interpolated from audio
   * position weighted by word length.
   */
  word: { start: number; end: number } | null;
  /** Seconds elapsed / estimated total for the whole document at rate 1. */
  elapsed: number;
  duration: number;
  rate: number;
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
  /** Jump to a sentence, keeping the play/pause state. */
  seek(sentenceIndex: number): void;
  next(): void;
  prev(): void;
  setRate(rate: number): void;
  /** Changing voice discards audio synthesised with the old one. */
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
// src/tts/index.ts      export function getEngine(): SpeechEngine            (singleton)
// src/player/index.ts   export function getPlayer(): Player                  (singleton, uses getEngine)
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
