import type { SynthResult } from '../types';

/** Synthesised sentences by index, least recently used first, bounded by total samples. */
export class AudioCache {
  private readonly entries = new Map<number, SynthResult>();
  private samples = 0;

  constructor(private readonly maxSamples: number) {}

  has(index: number): boolean {
    return this.entries.has(index);
  }

  /** Reads without counting as a use. */
  peek(index: number): SynthResult | undefined {
    return this.entries.get(index);
  }

  get(index: number): SynthResult | undefined {
    const entry = this.entries.get(index);
    if (entry) {
      this.entries.delete(index);
      this.entries.set(index, entry);
    }
    return entry;
  }

  /** Stores `entry`, then evicts old entries over budget, except those `keep` protects. */
  set(index: number, entry: SynthResult, keep: (index: number) => boolean): void {
    this.delete(index);
    this.entries.set(index, entry);
    this.samples += entry.pcm.length;
    for (const [k, v] of this.entries) {
      if (this.samples <= this.maxSamples) break;
      if (k === index || keep(k)) continue;
      this.entries.delete(k);
      this.samples -= v.pcm.length;
    }
  }

  clear(): void {
    this.entries.clear();
    this.samples = 0;
  }

  private delete(index: number): void {
    const old = this.entries.get(index);
    if (!old) return;
    this.entries.delete(index);
    this.samples -= old.pcm.length;
  }
}
