import { DEFAULT_SETTINGS, ENGINE_IDS, type EngineId, type Settings, type Theme } from '../types';

const THEMES: readonly Theme[] = ['system', 'light', 'dark'];

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
const isEngine = (v: unknown): v is EngineId => ENGINE_IDS.includes(v as EngineId);

/** '' or an http(s) URL without trailing slashes; `undefined` when invalid. */
function normalizeServerUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const url = value.trim().replace(/\/+$/, '');
  if (!url) return '';
  try {
    return /^https?:$/.test(new URL(url).protocol) ? url : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Apply an untrusted patch (from the UI or an old stored record) to valid settings.
 * Invalid values keep the previous value; numbers out of range are clamped.
 */
export function mergeSettings(base: Settings, patch: Record<string, unknown>): Settings {
  const next: Settings = { ...base, voices: { ...base.voices } };

  // Records from before per-engine voices stored a single Phonon voice.
  if ('voice' in patch && (typeof patch.voice === 'string' || patch.voice === null)) next.voices.phonon = patch.voice;

  if (isEngine(patch.engine)) next.engine = patch.engine;
  if (patch.voices && typeof patch.voices === 'object') {
    for (const [id, voice] of Object.entries(patch.voices)) {
      if (isEngine(id) && (typeof voice === 'string' || voice === null)) next.voices[id] = voice;
    }
  }
  const serverUrl = normalizeServerUrl(patch.serverUrl);
  if (serverUrl !== undefined) next.serverUrl = serverUrl;
  if (typeof patch.rate === 'number' && Number.isFinite(patch.rate)) next.rate = clamp(patch.rate, 0.5, 3);
  if (typeof patch.fontSize === 'number' && Number.isFinite(patch.fontSize)) next.fontSize = Math.round(clamp(patch.fontSize, 14, 32));
  if (THEMES.includes(patch.theme as Theme)) next.theme = patch.theme as Theme;
  if (typeof patch.autoScroll === 'boolean') next.autoScroll = patch.autoScroll;
  if (typeof patch.corsProxy === 'string') next.corsProxy = patch.corsProxy.trim();
  return next;
}

/** Defaults overlaid with a stored record, so fields added later get their defaults. */
export function settingsFromStored(stored: unknown): Settings {
  const defaults: Settings = { ...DEFAULT_SETTINGS, voices: { ...DEFAULT_SETTINGS.voices } };
  return stored && typeof stored === 'object' ? mergeSettings(defaults, stored as Record<string, unknown>) : defaults;
}
