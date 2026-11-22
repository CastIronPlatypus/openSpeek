import { useEffect, useId } from 'react';
import type { ServerStatus, Theme } from '../types';
import { useApp, useSettings } from './appModel';
import { Dialog } from './common/Dialog';
import { Switch } from './common/Switch';
import { useStore } from './store';
import { EnginePicker } from './voice/EnginePicker';
import { MAX_FONT_SIZE, MIN_FONT_SIZE } from './reader/fontSize';

const THEMES: { value: Theme; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

function describeStatus(status: ServerStatus | null): string {
  if (!status) return 'Checking…';
  if (!status.reachable) return 'Not reachable. Server engines and page fetching are off.';
  const offers = [status.engines.phonon && 'Phonon', status.engines.edge && 'Edge', status.fetch && 'page fetching'].filter(Boolean);
  return offers.length ? `Connected · offers ${offers.join(', ')}` : 'Connected, but it offers no engines.';
}

export function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const model = useApp();
  const [settings, update] = useSettings();
  const status = useStore(model.serverStatus);
  const ids = { theme: useId(), font: useId(), server: useId(), proxy: useId() };

  useEffect(() => {
    if (open) void model.refreshServerStatus();
  }, [open, model]);

  return (
    <Dialog open={open} onClose={onClose} title="Settings">
      <section className="settings-section">
        <h3>Appearance</h3>
        <div className="field">
          <span className="field-label" id={ids.theme}>
            Theme
          </span>
          <div className="segmented" role="radiogroup" aria-labelledby={ids.theme}>
            {THEMES.map((t) => (
              <label key={t.value} className="segmented-option">
                <input
                  type="radio"
                  name={ids.theme}
                  checked={settings.theme === t.value}
                  onChange={() => update({ theme: t.value })}
                />
                <span>{t.label}</span>
              </label>
            ))}
          </div>
        </div>
        <div className="field">
          <label className="field-label" htmlFor={ids.font}>
            Reading text size <span className="muted">{settings.fontSize}px</span>
          </label>
          <input
            id={ids.font}
            type="range"
            min={MIN_FONT_SIZE}
            max={MAX_FONT_SIZE}
            step={1}
            value={settings.fontSize}
            onChange={(e) => update({ fontSize: Number(e.target.value) })}
          />
        </div>
        <Switch
          label="Follow along"
          description="Scroll to keep the spoken sentence in view."
          checked={settings.autoScroll}
          onChange={(autoScroll) => update({ autoScroll })}
        />
      </section>

      <section className="settings-section">
        <h3>Speech</h3>
        <EnginePicker />
      </section>

      <section className="settings-section">
        <h3>Server</h3>
        <p className="muted small">
          Optional. An openSpeek server adds the server-side engines and can fetch web pages for pasted links when a site blocks direct reading.
        </p>
        <div className="field">
          <label className="field-label" htmlFor={ids.server}>
            Server URL
          </label>
          <input
            id={ids.server}
            type="url"
            inputMode="url"
            className="input"
            placeholder="Same origin"
            autoComplete="off"
            spellCheck={false}
            value={settings.serverUrl}
            onChange={(e) => update({ serverUrl: e.target.value.trim() })}
          />
          <p className="small server-status" data-ok={status?.reachable ? '' : undefined} aria-live="polite">
            <span className="status-dot" aria-hidden="true" />
            {describeStatus(status)}
          </p>
        </div>
        <div className="field">
          <label className="field-label" htmlFor={ids.proxy}>
            CORS proxy for pasted links
          </label>
          <input
            id={ids.proxy}
            type="url"
            inputMode="url"
            className="input"
            placeholder="https://proxy.example/?url="
            autoComplete="off"
            spellCheck={false}
            value={settings.corsProxy}
            onChange={(e) => update({ corsProxy: e.target.value.trim() })}
          />
          <p className="muted small">
            When you paste a link, many sites block their page from being read by other sites. The page URL is appended
            to this prefix. Leave empty to use the server above when it can fetch pages.
          </p>
        </div>
      </section>

      <section className="settings-section about">
        <h3>About openSpeek</h3>
        <p>
          openSpeek reads documents aloud. By default, speech is generated on this device by <strong>Phonon</strong> from
          Gradium (model Phonon 31m, Apache-2.0), so nothing you read leaves your browser.
        </p>
        <p>
          The two optional engines send each sentence to a server: <strong>Phonon on server</strong> to your openSpeek
          server, and <strong>Edge online voices</strong> through that server to Microsoft.
        </p>
        <p>Your documents and reading progress are stored only in this browser.</p>
      </section>
    </Dialog>
  );
}
