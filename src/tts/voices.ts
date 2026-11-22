import type { VoiceInfo } from '../types';

export const VOICE_CATALOG_BASE = 'https://huggingface.co/gradium/phonon-voices/resolve/main/';
const CATALOG_URL = `${VOICE_CATALOG_BASE}voices.jsonl`;
const STORAGE_KEY = 'openspeek:voice-catalog:v1';
const LANGUAGE = 'en';

export interface CatalogVoice extends VoiceInfo {
  /** Path of the voice file relative to {@link VOICE_CATALOG_BASE}. */
  filename: string;
}

type Fetcher = (url: string) => Promise<Response>;

/**
 * The English voices of the `gradium/phonon-voices` catalog.
 *
 * A copy is kept in localStorage: when one exists it is used straight away
 * (so the app works offline) and refreshed in the background for next time.
 */
export class VoiceCatalog {
  private voices: CatalogVoice[] | null = null;
  private pending: Promise<CatalogVoice[]> | null = null;

  constructor(
    private readonly fetcher: Fetcher = (url) => fetch(url),
    private readonly storage: Storage | null = defaultStorage(),
  ) {}

  list(): Promise<CatalogVoice[]> {
    if (this.voices) return Promise.resolve(this.voices);
    this.pending ??= this.resolve().finally(() => {
      this.pending = null;
    });
    return this.pending;
  }

  async find(name: string): Promise<CatalogVoice | undefined> {
    return (await this.list()).find((v) => v.name === name);
  }

  private async resolve(): Promise<CatalogVoice[]> {
    const stored = this.readStored();
    if (stored) {
      this.voices = stored;
      this.fetchRemote().catch(() => {});
      return stored;
    }
    try {
      this.voices = await this.fetchRemote();
      return this.voices;
    } catch {
      // Not memoised: the next call tries the network again.
      return [];
    }
  }

  private async fetchRemote(): Promise<CatalogVoice[]> {
    const res = await this.fetcher(CATALOG_URL);
    if (!res.ok) throw new Error(`voice catalog: HTTP ${res.status}`);
    const voices = parseCatalog(await res.text());
    if (!voices.length) throw new Error('voice catalog: no English voices');
    try {
      this.storage?.setItem(STORAGE_KEY, JSON.stringify(voices));
    } catch {
      // Storage full or disabled: the catalog still works for this session.
    }
    return voices;
  }

  private readStored(): CatalogVoice[] | null {
    try {
      const raw = this.storage?.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return null;
      const voices = parsed.filter(isCatalogVoice);
      return voices.length ? voices : null;
    } catch {
      return null;
    }
  }
}

/** Parses `voices.jsonl`, keeping valid English entries with unique names. */
export function parseCatalog(jsonl: string): CatalogVoice[] {
  const seen = new Set<string>();
  const voices: CatalogVoice[] = [];
  for (const line of jsonl.split('\n')) {
    if (!line.trim()) continue;
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isRecord(entry) || entry.language !== LANGUAGE) continue;
    const { name, filename } = entry;
    if (typeof name !== 'string' || typeof filename !== 'string' || !name || seen.has(name)) continue;
    seen.add(name);
    voices.push({
      name,
      filename,
      gender: optionalString(entry.gender),
      age: optionalString(entry.age),
      locale: optionalString(entry.locale),
      description: optionalString(entry.description),
    });
  }
  return voices;
}

/** The public view of a catalog voice, without its file path. */
export function toVoiceInfo({ filename: _filename, ...info }: CatalogVoice): VoiceInfo {
  return info;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isCatalogVoice(value: unknown): value is CatalogVoice {
  return isRecord(value) && typeof value.name === 'string' && typeof value.filename === 'string';
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function defaultStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}
