import { useEffect, useRef, useState } from 'react';
import { AppContext, createAppModel, useApp, useSettings, type AppModel } from './appModel';
import { Toast } from './common/Toast';
import { LibraryView } from './library/LibraryView';
import { ReaderView } from './reader/ReaderView';
import { loadServices } from './services';
import { SettingsDialog } from './SettingsDialog';
import { useHashRoute } from './useHashRoute';

const SERVER_CHECK_DELAY_MS = 500;

export default function App() {
  const [model, setModel] = useState<AppModel | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadServices()
      .then(createAppModel)
      .then(setModel, (err: unknown) => {
        console.error(err);
        setError(err instanceof Error ? err.message : String(err));
      });
  }, []);

  if (error) {
    return (
      <main className="splash" role="alert">
        <h1>openSpeek could not start</h1>
        <p className="muted">{error}</p>
        <button type="button" className="btn btn--primary" onClick={() => location.reload()}>
          Reload
        </button>
      </main>
    );
  }
  if (!model) return <div className="splash" aria-busy="true" />;
  return (
    <AppContext value={model}>
      <Shell />
    </AppContext>
  );
}

function Shell() {
  const route = useHashRoute();
  const [settingsOpen, setSettingsOpen] = useState(false);
  useTheme();
  useServerMonitor();
  const openSettings = () => setSettingsOpen(true);

  return (
    <>
      {route.view === 'read' ? (
        <ReaderView key={route.id} id={route.id} onOpenSettings={openSettings} />
      ) : (
        <LibraryView onOpenSettings={openSettings} />
      )}
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <Toast />
    </>
  );
}

function useTheme() {
  const [{ theme }] = useSettings();
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') delete root.dataset.theme;
    else root.dataset.theme = theme;
  }, [theme]);
}

/** Points the TTS module at the configured server and re-checks it whenever the URL changes. */
function useServerMonitor() {
  const model = useApp();
  const [{ serverUrl }] = useSettings();
  // Set once the startup check has completed (not when it is scheduled: StrictMode re-runs effects).
  const checkedAtStartup = useRef(false);

  useEffect(() => {
    model.services.setServerUrl(serverUrl);
    const t = setTimeout(
      () => {
        void model.refreshServerStatus().then(() => {
          if (checkedAtStartup.current) return;
          checkedAtStartup.current = true;
          model.ensureUsableEngine();
        });
      },
      checkedAtStartup.current ? SERVER_CHECK_DELAY_MS : 0,
    );
    return () => clearTimeout(t);
  }, [model, serverUrl]);
}
