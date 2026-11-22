import { useCallback } from 'react';
import type { StoredDocument } from '../../types';
import { useApp, useSettings } from '../appModel';
import { AppHeader, SettingsButton, ThemeToggle } from '../common/AppHeader';
import { LogoMark, UploadIcon } from '../common/icons';
import { serverFetchPrefix } from '../engines';
import { openReader } from '../useHashRoute';
import { AddPanel } from './AddPanel';
import { DocumentList } from './DocumentList';
import { SAMPLE_TEXT, SAMPLE_TITLE } from './sample';
import { useDocuments } from './useDocuments';
import { useImports } from './useImports';
import { useWindowFileDrop } from './useWindowFileDrop';
import '../styles/library.css';

export function LibraryView({ onOpenSettings }: { onOpenSettings: () => void }) {
  const model = useApp();
  const { ingest } = model.services;
  const [settings] = useSettings();
  const { docs, error, refresh, rename, remove } = useDocuments();

  const onImported = useCallback(
    (doc: StoredDocument, open: boolean) => {
      if (open) openReader(doc.id);
      else void refresh();
    },
    [refresh],
  );
  const { jobs, run, dismiss } = useImports(onImported);

  const importFiles = useCallback(
    (files: File[]) => {
      for (const file of files) void run(file.name, () => ingest.importFile(file), files.length === 1);
    },
    [run, ingest],
  );
  const dragging = useWindowFileDrop(importFiles);

  const importText = (text: string, title: string) =>
    run(title || 'pasted text', () => ingest.importText(text, title || undefined), true);

  const importUrl = (url: string) =>
    run(url, async () => {
      const { corsProxy, serverUrl } = model.settings.get();
      let proxy: string | undefined = corsProxy || undefined;
      if (!proxy && (await model.refreshServerStatus()).fetch) proxy = serverFetchPrefix(serverUrl);
      return ingest.importUrl(url, proxy);
    }, true);

  const trySample = () => run(SAMPLE_TITLE, () => ingest.importText(SAMPLE_TEXT, SAMPLE_TITLE), true);

  return (
    <div className="page library">
      <AppHeader
        start={
          <span className="brand">
            <LogoMark />
            <span className="brand-name">openSpeek</span>
          </span>
        }
        end={
          <>
            <ThemeToggle />
            <SettingsButton onClick={onOpenSettings} />
          </>
        }
      />
      <main className="library-main">
        <AddPanel
          acceptedFileTypes={ingest.acceptedFileTypes}
          jobs={jobs}
          onDismissJob={dismiss}
          onText={importText}
          onFiles={importFiles}
          onUrl={importUrl}
        />
        <section className="library-docs" aria-labelledby="library-heading">
          <h2 id="library-heading" className="section-heading">
            Your library
          </h2>
          {error && (
            <p className="banner banner--error" role="alert">
              Couldn’t read your library: {error}
            </p>
          )}
          {docs === null ? null : docs.length === 0 ? (
            <EmptyLibrary onTrySample={trySample} />
          ) : (
            <DocumentList
              docs={docs}
              rate={settings.rate}
              onRename={(id, title) => void rename(id, title)}
              onDelete={(id) => void remove(id)}
            />
          )}
        </section>
      </main>
      {dragging && (
        <div className="drop-overlay" aria-hidden="true">
          <div className="drop-overlay-card">
            <UploadIcon size={36} />
            <p>Drop to add to your library</p>
          </div>
        </div>
      )}
    </div>
  );
}

function EmptyLibrary({ onTrySample }: { onTrySample: () => void }) {
  return (
    <div className="empty">
      <svg className="empty-art" width="120" height="84" viewBox="0 0 120 84" aria-hidden="true">
        <path d="M10 70c16-7 33-7 50 2 17-9 34-9 50-2V16c-16-7-33-7-50 2-17-9-34-9-50-2z" className="empty-art-page" />
        <path d="M60 18v54" className="empty-art-line" />
        <path d="M22 30h26M22 39h22M22 48h26M72 30h26M72 39h20M72 48h24" className="empty-art-line" />
      </svg>
      <h3>Nothing here yet</h3>
      <p className="muted">Add text, a file or a web page above, or start with a short sample.</p>
      <button type="button" className="btn btn--primary" onClick={onTrySample}>
        Try a sample
      </button>
    </div>
  );
}
