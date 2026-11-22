import type { ModelProgress } from '../types';

export interface FileProgress {
  file: string;
  loaded: number;
  total: number | null;
}

/**
 * Folds phonon-tts per-file progress events into one overall figure.
 *
 * Files are announced one by one and some never state their size, so the
 * overall total can grow while downloading. Files listed in `expected` count
 * with that size until they report one (so the small files finishing first
 * cannot read as "almost done"); any other file of unknown size counts its
 * bytes so far. The fraction never goes backwards and stays below 1 until
 * `complete()`.
 */
export class ProgressAggregator {
  private readonly files = new Map<string, { loaded: number; total: number | null }>();
  private fraction = 0;

  constructor(private readonly expected: Record<string, number> = {}) {}

  update(event: FileProgress): ModelProgress {
    this.files.set(event.file, { loaded: event.loaded, total: event.total });
    let loaded = 0;
    let total = 0;
    for (const [name, f] of this.files) {
      const fallback = Math.max(this.expected[name] ?? 0, f.loaded);
      const size = f.total !== null && f.total > 0 ? Math.max(f.total, f.loaded) : fallback;
      loaded += f.loaded;
      total += size;
    }
    for (const [name, size] of Object.entries(this.expected)) {
      if (!this.files.has(name)) total += size;
    }
    const raw = total > 0 ? loaded / total : 0;
    this.fraction = Math.max(this.fraction, Math.min(raw, 0.99));
    return { loaded, total, fraction: this.fraction };
  }

  complete(): ModelProgress {
    let total = 0;
    for (const f of this.files.values()) total += Math.max(f.total ?? 0, f.loaded);
    this.fraction = 1;
    return { loaded: total, total, fraction: 1 };
  }
}
