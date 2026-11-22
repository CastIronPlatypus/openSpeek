/**
 * Dev-only stand-ins for the player, importers, library and engines, selected with `?mock`.
 * Options (comma separated): `server` (server reachable, offers everything), `seed` (start with
 * documents), `loading` (model download stalls at 42%). Example: `?mock=seed,server`.
 */
import {
  DEFAULT_SETTINGS,
  type Block,
  type DocumentDraft,
  type EngineId,
  type Player,
  type PlayerState,
  type Sentence,
  type ServerStatus,
  type Settings,
  type SourceKind,
  type StoredDocument,
  type VoiceInfo,
} from '../../types';
import { SAMPLE_TEXT } from '../library/sample';
import type { Services } from '../services';

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
const wordCount = (s: string) => s.split(/\s+/).filter(Boolean).length;

function segment(blocks: Block[]): Sentence[] {
  const out: Sentence[] = [];
  blocks.forEach((b, block) => {
    for (const m of b.text.matchAll(/[^.!?]+(?:[.!?]+["')\]]*|$)/g)) {
      const lead = m[0].length - m[0].trimStart().length;
      const text = m[0].trim();
      if (!text) continue;
      const start = m.index + lead;
      out.push({ index: out.length, block, start, end: start + text.length, text });
    }
  });
  return out;
}

function importText(text: string, title?: string, kind: SourceKind = 'text'): DocumentDraft {
  const blocks: Block[] = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const h = /^(#{1,6})\s+(.*)$/.exec(p);
      return h ? { kind: 'heading', level: h[1].length, text: h[2] } : { kind: 'paragraph', text: p.replace(/\s+/g, ' ') };
    });
  if (!blocks.length) throw new Error('There is no text to read.');
  return { title: title || blocks[0].text.slice(0, 60), source: { kind }, blocks };
}

class MockPlayer implements Player {
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
  private listeners = new Set<() => void>();
  private sentences: Sentence[] = [];
  private lengths: number[] = [];
  private position = 0;
  private timer: ReturnType<typeof setInterval> | undefined;
  private modelLoaded = false;
  private stallLoading: boolean;

  constructor(stallLoading: boolean) {
    this.stallLoading = stallLoading;
  }

  getState = () => this.state;
  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => void this.listeners.delete(l);
  };
  private set(patch: Partial<PlayerState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }
  private elapsedAt(index: number) {
    return this.lengths.slice(0, index).reduce((a, b) => a + b, 0) + this.position;
  }

  setDocument(sentences: Sentence[], startIndex = 0) {
    this.halt();
    this.sentences = sentences;
    this.lengths = sentences.map((s) => wordCount(s.text) * 0.36 + 0.3);
    this.position = 0;
    this.set({
      status: 'paused',
      sentenceIndex: startIndex,
      word: null,
      elapsed: this.elapsedAt(startIndex),
      duration: this.lengths.reduce((a, b) => a + b, 0),
    });
  }
  async play() {
    if (!this.sentences.length || this.timer) return;
    if (this.state.status === 'ended') this.seek(0);
    if (this.state.engine === 'phonon' && !this.modelLoaded) {
      for (let f = 0; f <= 1; f += 0.05) {
        this.set({ status: 'loading', modelProgress: { loaded: f * 65e6, total: 65e6, fraction: f } });
        await delay(this.stallLoading && f > 0.4 ? 1e9 : 90);
      }
      this.modelLoaded = true;
    }
    this.set({ status: 'buffering', modelProgress: null });
    await delay(250);
    this.set({ status: 'playing' });
    this.timer = setInterval(() => this.tick(0.05), 50);
  }
  private tick(dt: number) {
    const i = this.state.sentenceIndex;
    const s = this.sentences[i];
    this.position += dt * this.state.rate;
    if (this.position >= this.lengths[i]) {
      if (i + 1 >= this.sentences.length) {
        this.halt();
        this.set({ status: 'ended', word: null });
        return;
      }
      this.position = 0;
      this.set({ sentenceIndex: i + 1, word: null, elapsed: this.elapsedAt(i + 1) });
      return;
    }
    const at = (this.position / this.lengths[i]) * s.text.length;
    const word = [...s.text.matchAll(/\S+/g)].find((m) => m.index + m[0].length >= at);
    const range = word ? { start: word.index, end: word.index + word[0].length } : null;
    const same = range && this.state.word?.start === range.start;
    this.set({ elapsed: this.elapsedAt(i), ...(same ? {} : { word: range }) });
  }
  private halt() {
    clearInterval(this.timer);
    this.timer = undefined;
  }
  pause() {
    this.halt();
    this.set({ status: 'paused' });
  }
  toggle() {
    if (this.timer) this.pause();
    else void this.play();
  }
  seek(index: number) {
    const i = Math.max(0, Math.min(this.sentences.length - 1, index));
    this.position = 0;
    this.set({ sentenceIndex: i, word: null, elapsed: this.elapsedAt(i), ...(this.state.status === 'ended' ? { status: 'paused' } : {}) });
  }
  next() {
    this.seek(this.state.sentenceIndex + 1);
  }
  prev() {
    this.seek(this.state.sentenceIndex - 1);
  }
  setRate(rate: number) {
    this.set({ rate });
  }
  setEngine(engine: EngineId, voice: string | null = null) {
    this.set({ engine, voice });
  }
  setVoice(voice: string | null) {
    this.set({ voice });
  }
  stop() {
    this.halt();
    this.sentences = [];
    this.set({ status: 'idle', sentenceIndex: -1, word: null, elapsed: 0, duration: 0 });
  }
  async exportWav(sentences: Sentence[], opts: { onProgress?: (d: number, t: number) => void; signal?: AbortSignal } = {}) {
    for (let i = 0; i <= sentences.length; i++) {
      if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      opts.onProgress?.(i, sentences.length);
      await delay(60);
    }
    return new Blob([new Uint8Array(44)], { type: 'audio/wav' });
  }
}

const PHONON_VOICES: VoiceInfo[] = [
  { name: 'Iris', gender: 'female', description: 'Warm, unhurried narration' },
  { name: 'Theo', gender: 'male', description: 'Clear and even' },
  { name: 'Mara', gender: 'female', description: 'Bright, conversational' },
  { name: 'Jonah', gender: 'male', description: 'Low and calm' },
];
const EDGE_LOCALES = ['en-US', 'en-GB', 'en-AU', 'en-IN', 'fr-FR', 'de-DE', 'es-ES', 'es-MX', 'it-IT', 'ja-JP', 'pt-BR', 'nl-NL', 'sv-SE', 'pl-PL', 'ko-KR', 'hi-IN', 'ar-SA', 'zh-CN'];
const EDGE_NAMES = ['Aria', 'Guy', 'Jenny', 'Davis', 'Sonia', 'Ryan', 'Libby', 'Elena', 'Noah', 'Ines', 'Kenji', 'Lea'];
const EDGE_VOICES: VoiceInfo[] = EDGE_LOCALES.flatMap((locale) =>
  EDGE_NAMES.map((n, i) => ({
    name: `${locale}-${n}Neural`,
    locale,
    gender: i % 2 ? 'Male' : 'Female',
    description: `${n} (${locale.split('-')[1]})`,
  })),
);

export function createMockServices(mode: string): Services {
  const opts = new Set(mode.split(','));
  const docs = new Map<string, StoredDocument>();
  let settings: Settings = DEFAULT_SETTINGS;
  let nextId = 1;

  const addDocument = async (draft: DocumentDraft) => {
    await delay(150);
    const now = Date.now();
    const doc: StoredDocument = {
      ...draft,
      id: String(nextId++),
      createdAt: now,
      updatedAt: now,
      wordCount: draft.blocks.reduce((n, b) => n + wordCount(b.text), 0),
      sentenceCount: segment(draft.blocks).length,
      progress: 0,
    };
    docs.set(doc.id, doc);
    return doc;
  };

  if (opts.has('seed')) {
    const seed = (title: string, kind: SourceKind, progress: number, ageMs: number, repeat: number) => {
      void addDocument({ ...importText(Array(repeat).fill(SAMPLE_TEXT).join('\n\n'), title), source: { kind } }).then((d) => {
        d.updatedAt -= ageMs;
        d.progress = Math.round(d.sentenceCount * progress);
      });
    };
    seed('A short welcome to listening', 'text', 0.4, 60_000, 1);
    seed('Quarterly field notes — coastal survey', 'pdf', 0.75, 3 * 86400_000, 12);
    seed('On the craft of the essay', 'web', 0, 9 * 86400_000, 4);
  }

  const status: ServerStatus = opts.has('server')
    ? { reachable: true, engines: { phonon: true, edge: true }, fetch: true }
    : { reachable: false, engines: { phonon: false, edge: false }, fetch: false };

  return {
    player: new MockPlayer(opts.has('loading')),
    ingest: {
      segment,
      importText: (text, title) => importText(text, title),
      async importFile(file) {
        const kind: SourceKind = /\.md$/i.test(file.name) ? 'markdown' : 'text';
        return importText(await file.text(), file.name.replace(/\.[^.]+$/, ''), kind);
      },
      async importUrl() {
        await delay(400);
        throw new Error('The site did not allow the page to be fetched (blocked by CORS).');
      },
      acceptedFileTypes: '.pdf,.epub,.docx,.txt,.md,.markdown,.html,.htm',
    },
    library: {
      listDocuments: async () => [...docs.values()].map(({ blocks: _blocks, ...meta }) => meta),
      getDocument: async (id) => docs.get(id),
      addDocument,
      async renameDocument(id, title) {
        const d = docs.get(id);
        if (d) d.title = title;
      },
      deleteDocument: async (id) => void docs.delete(id),
      async saveProgress(id, index) {
        const d = docs.get(id);
        if (d) Object.assign(d, { progress: index, updatedAt: Date.now() });
      },
      loadSettings: async () => settings,
      saveSettings: async (patch) => (settings = { ...settings, ...patch }),
    },
    async listVoices(engine) {
      await delay(200);
      return engine === 'edge' ? (status.engines.edge ? EDGE_VOICES : []) : PHONON_VOICES;
    },
    setServerUrl() {},
    getServerStatus: async () => {
      await delay(150);
      return status;
    },
  };
}
