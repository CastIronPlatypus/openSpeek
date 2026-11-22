import type {
  Block,
  DocMeta,
  DocumentDraft,
  EngineId,
  Player,
  Sentence,
  ServerStatus,
  Settings,
  StoredDocument,
  VoiceInfo,
} from '../types';

export interface Library {
  listDocuments(): Promise<DocMeta[]>;
  getDocument(id: string): Promise<StoredDocument | undefined>;
  addDocument(draft: DocumentDraft): Promise<StoredDocument>;
  renameDocument(id: string, title: string): Promise<void>;
  deleteDocument(id: string): Promise<void>;
  saveProgress(id: string, sentenceIndex: number): Promise<void>;
  loadSettings(): Promise<Settings>;
  saveSettings(patch: Partial<Settings>): Promise<Settings>;
}

export interface Ingest {
  segment(blocks: Block[]): Sentence[];
  importText(text: string, title?: string): DocumentDraft;
  importFile(file: File): Promise<DocumentDraft>;
  importUrl(url: string, corsProxy?: string): Promise<DocumentDraft>;
  acceptedFileTypes: string;
}

/** Everything the UI needs from the other modules, so a dev mock can stand in for them. */
export interface Services {
  player: Player;
  library: Library;
  ingest: Ingest;
  listVoices(engine: EngineId): Promise<VoiceInfo[]>;
  setServerUrl(url: string): void;
  getServerStatus(): Promise<ServerStatus>;
}

/** Caches per-engine voice lists for the session; a failed or empty fetch is retried next time. */
export function cacheVoices(list: (engine: EngineId) => Promise<VoiceInfo[]>) {
  const cache = new Map<EngineId, Promise<VoiceInfo[]>>();
  return (engine: EngineId) => {
    let p = cache.get(engine);
    if (!p) {
      p = list(engine).then(
        (voices) => {
          if (voices.length === 0) cache.delete(engine);
          return voices;
        },
        (err: unknown) => {
          cache.delete(engine);
          throw err;
        },
      );
      cache.set(engine, p);
    }
    return p;
  };
}

export async function loadServices(): Promise<Services> {
  const params = new URLSearchParams(location.search);
  if (import.meta.env.DEV && params.has('mock')) {
    const { createMockServices } = await import('./__dev__/mockServices');
    return createMockServices(params.get('mock') ?? '');
  }
  const [tts, player, ingest, library] = await Promise.all([
    import('../tts'),
    import('../player'),
    import('../ingest'),
    import('../library'),
  ]);
  return {
    player: player.getPlayer(),
    library,
    ingest: {
      segment: ingest.segment,
      importText: ingest.importText,
      importFile: ingest.importFile,
      importUrl: ingest.importUrl,
      acceptedFileTypes: ingest.ACCEPTED_FILE_TYPES,
    },
    listVoices: cacheVoices((id) => tts.getEngine(id).listVoices()),
    setServerUrl: tts.setServerUrl,
    getServerStatus: tts.getServerStatus,
  };
}
