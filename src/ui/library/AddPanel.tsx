import { useId, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { AlertIcon, CloseIcon, PasteIcon, TextIcon, UploadIcon } from '../common/icons';
import type { ImportJob } from './useImports';

type Tab = 'text' | 'file';
const TABS: { id: Tab; label: string; icon: ReactNode }[] = [
  { id: 'text', label: 'Type or paste', icon: <TextIcon size={18} /> },
  { id: 'file', label: 'Upload file', icon: <UploadIcon size={18} /> },
];

const PASTE_KEY = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';

interface AddPanelProps {
  acceptedFileTypes: string;
  jobs: ImportJob[];
  onDismissJob: (id: number) => void;
  /** Each resolves to whether the import succeeded, so the form can clear itself. */
  onText: (text: string, title: string) => Promise<boolean>;
  onFiles: (files: File[]) => void;
  /** The Paste button: reads the clipboard (inside this click) and adds what is on it. */
  onPaste: () => void;
  /** A short note about the last paste (empty clipboard, no clipboard access), or `null`. */
  pasteNotice: string | null;
  onDismissPasteNotice: () => void;
}

export function AddPanel({
  acceptedFileTypes,
  jobs,
  onDismissJob,
  onText,
  onFiles,
  onPaste,
  pasteNotice,
  onDismissPasteNotice,
}: AddPanelProps) {
  const [tab, setTab] = useState<Tab>('text');
  const baseId = useId();
  const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({ text: null, file: null });

  const onTabKey = (e: KeyboardEvent) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const i = (TABS.findIndex((t) => t.id === tab) + step + TABS.length) % TABS.length;
    setTab(TABS[i].id);
    tabRefs.current[TABS[i].id]?.focus();
  };

  return (
    <section className="add-panel" aria-labelledby={`${baseId}-heading`}>
      <h2 id={`${baseId}-heading`} className="add-heading">
        Add something to listen to
      </h2>
      <div className="paste-row">
        <button type="button" className="btn btn--primary paste-btn" onClick={onPaste}>
          <PasteIcon size={20} />
          Paste
        </button>
        <p className="paste-hint muted small">
          <span className="hide-touch">
            Copied something? Press <kbd>{PASTE_KEY}</kbd> <kbd>V</kbd> anywhere on this page. Text, a link to a web page or a
            file opens straight away.
          </span>
          <span className="only-touch">Copied some text or a link to a web page? Paste it to start listening straight away.</span>
        </p>
      </div>
      {pasteNotice && (
        <p className="paste-notice" role="status">
          <span>{pasteNotice}</span>
          <button type="button" className="icon-btn icon-btn--small" aria-label="Dismiss" onClick={onDismissPasteNotice}>
            <CloseIcon size={18} />
          </button>
        </p>
      )}
      <div className="tabs" role="tablist" aria-label="Or add it yourself" onKeyDown={onTabKey}>
        {TABS.map((t) => (
          <button
            key={t.id}
            ref={(el) => {
              tabRefs.current[t.id] = el;
            }}
            type="button"
            role="tab"
            id={`${baseId}-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`${baseId}-panel`}
            tabIndex={tab === t.id ? 0 : -1}
            className="tab"
            onClick={() => setTab(t.id)}
          >
            {t.icon}
            <span>{t.label}</span>
          </button>
        ))}
      </div>
      <div className="tab-panel" role="tabpanel" id={`${baseId}-panel`} aria-labelledby={`${baseId}-tab-${tab}`}>
        {tab === 'text' && <TextForm onSubmit={onText} />}
        {tab === 'file' && <FileDrop accept={acceptedFileTypes} onFiles={onFiles} />}
      </div>
      <ImportJobs jobs={jobs} onDismiss={onDismissJob} />
    </section>
  );
}

function TextForm({ onSubmit }: { onSubmit: AddPanelProps['onText'] }) {
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    if (await onSubmit(text, title.trim())) {
      setText('');
      setTitle('');
    }
  };
  return (
    <form className="add-form" onSubmit={submit}>
      <input
        className="input"
        placeholder="Title (optional)"
        aria-label="Title (optional)"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <textarea
        className="input textarea"
        placeholder="Paste or type text, or a link to a web page…"
        aria-label="Text to listen to"
        rows={5}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="add-actions">
        <button type="submit" className="btn btn--primary" disabled={!text.trim()}>
          Listen
        </button>
      </div>
    </form>
  );
}

function FileDrop({ accept, onFiles }: { accept: string; onFiles: (files: File[]) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="dropzone">
      <UploadIcon size={28} />
      <p>
        <strong>Drop files anywhere</strong> or choose them from your device
      </p>
      <p className="muted small">PDF, EPUB, Word (.docx), plain text, Markdown or HTML</p>
      <button type="button" className="btn btn--primary" onClick={() => inputRef.current?.click()}>
        Choose files
      </button>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={accept}
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          if (files.length) onFiles(files);
        }}
      />
    </div>
  );
}

function ImportJobs({ jobs, onDismiss }: { jobs: ImportJob[]; onDismiss: (id: number) => void }) {
  return (
    <ul className="jobs" aria-live="polite">
      {jobs.map((job) =>
        job.error ? (
          <li key={job.id} className="job job--error" role="alert">
            <AlertIcon size={18} />
            <span className="job-text">
              Couldn’t import <strong>{job.label}</strong>: {job.error}
            </span>
            <button type="button" className="icon-btn icon-btn--small" aria-label="Dismiss" onClick={() => onDismiss(job.id)}>
              <CloseIcon size={18} />
            </button>
          </li>
        ) : (
          <li key={job.id} className="job">
            <span className="spinner" aria-hidden="true" />
            <span className="job-text">
              Importing <strong>{job.label}</strong>…
            </span>
          </li>
        ),
      )}
    </ul>
  );
}
