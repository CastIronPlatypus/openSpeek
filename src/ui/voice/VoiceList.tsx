import { useDeferredValue, useEffect, useId, useMemo, useState } from 'react';
import type { EngineId, VoiceInfo } from '../../types';
import { useApp, useSettings } from '../appModel';
import { SearchIcon } from '../common/icons';

/** Rendering hundreds of radios at once makes the sheet sluggish on phones; search narrows the rest. */
const MAX_RENDERED = 80;
const SEARCH_THRESHOLD = 12;

interface Group {
  label: string;
  voices: VoiceInfo[];
}

let languageNames: Intl.DisplayNames | null = null;
function localeLabel(locale: string | undefined): string {
  if (!locale) return 'Voices';
  try {
    languageNames ??= new Intl.DisplayNames(['en'], { type: 'language' });
    return languageNames.of(locale) ?? locale;
  } catch {
    return locale;
  }
}

/** "en-US-AriaNeural" reads better as "Aria". */
function displayName(v: VoiceInfo): string {
  let name = v.name;
  if (v.locale && name.startsWith(`${v.locale}-`)) name = name.slice(v.locale.length + 1);
  return name.replace(/Neural$/, '') || v.name;
}

function groupVoices(voices: VoiceInfo[]): Group[] {
  const groups = new Map<string, Group & { english: boolean }>();
  for (const v of voices) {
    const label = localeLabel(v.locale);
    let g = groups.get(label);
    if (!g) {
      g = { label, voices: [], english: !v.locale || v.locale.toLowerCase().startsWith('en') };
      groups.set(label, g);
    }
    g.voices.push(v);
  }
  return [...groups.values()].sort((a, b) => Number(b.english) - Number(a.english) || a.label.localeCompare(b.label));
}

function matches(v: VoiceInfo, q: string): boolean {
  return [v.name, v.description, v.gender, v.locale, localeLabel(v.locale)].some((f) => f?.toLowerCase().includes(q));
}

export function VoiceList({ engine }: { engine: EngineId }) {
  const { services, selectVoice } = useApp();
  const [settings] = useSettings();
  const current = settings.voices[engine];
  const [voices, setVoices] = useState<VoiceInfo[] | null>(null);
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());
  const name = useId();

  useEffect(() => {
    let cancelled = false;
    setVoices(null);
    services.listVoices(engine).then(
      (list) => !cancelled && setVoices(list),
      () => !cancelled && setVoices([]),
    );
    return () => {
      cancelled = true;
    };
  }, [services, engine]);

  const { groups, shown, matched } = useMemo(() => {
    const filtered = (voices ?? []).filter((v) => !deferredQuery || matches(v, deferredQuery));
    const limited = filtered.slice(0, MAX_RENDERED);
    // Keep the selected voice visible even when it falls outside the rendered slice.
    const selected = filtered.find((v) => v.name === current);
    if (selected && !limited.includes(selected)) limited.unshift(selected);
    return { groups: groupVoices(limited), shown: limited.length, matched: filtered.length };
  }, [voices, deferredQuery, current]);

  if (voices === null) return <p className="muted small voice-note">Loading voices…</p>;

  const radio = (value: string | null, label: string, detail?: string) => (
    <label key={value ?? ''} className="voice-option">
      <input type="radio" name={name} checked={current === value} onChange={() => selectVoice(value)} />
      <span className="voice-option-text">
        <span>{label}</span>
        {detail && <span className="muted small">{detail}</span>}
      </span>
    </label>
  );

  return (
    <div className="voice-list">
      {voices.length > SEARCH_THRESHOLD && (
        <label className="search-field">
          <SearchIcon size={18} />
          <input
            type="search"
            placeholder={`Search ${voices.length} voices`}
            aria-label="Search voices"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      )}
      <div className="voice-scroll" role="radiogroup" aria-label="Voice">
        {!deferredQuery && radio(null, 'Default', 'The engine’s standard voice')}
        {groups.map((g) => (
          <div key={g.label} className="voice-group">
            {(groups.length > 1 || g.label !== 'Voices') && <div className="voice-group-label">{g.label}</div>}
            {g.voices.map((v) =>
              radio(v.name, displayName(v), [v.gender, v.description].filter(Boolean).join(' · ') || undefined),
            )}
          </div>
        ))}
        {voices.length === 0 && <p className="muted small voice-note">No other voices are available for this engine.</p>}
        {voices.length > 0 && matched === 0 && <p className="muted small voice-note">No voices match “{query}”.</p>}
        {matched > shown && (
          <p className="muted small voice-note">
            Showing {shown} of {matched}. Type to narrow the list.
          </p>
        )}
      </div>
    </div>
  );
}
