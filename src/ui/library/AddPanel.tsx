import { useId, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { AlertIcon, CloseIcon, LinkIcon, TextIcon, UploadIcon } from '../common/icons';
import type { ImportJob } from './useImports';

type Tab = 'text' | 'file' | 'url';
const TABS: { id: Tab; label: string; icon: ReactNode }[] = [
  { id: 'text', label: 'Paste text', icon: <TextIcon size={18} /> },
  { id: 'file', label: 'Upload file', icon: <UploadIcon size={18} /> },
  { id: 'url', label: 'Web page', icon: <LinkIcon size={18} /> },
];

interface AddPanelProps {
  acceptedFileTypes: string;
  jobs: ImportJob[];
  onDismissJob: (id: number) => void;
  /** Each resolves to whether the import succeeded, so the form can clear itself. */
  onText: (text: string, title: string) => Promise<boolean>;
  onFiles: (files: File[]) => void;
  onUrl: (url: string) => Promise<boolean>;
}

export function AddPanel({ acceptedFileTypes, jobs, onDismissJob, onText, onFiles, onUrl }: AddPanelProps) {
  const [tab, setTab] = useState<Tab>('text');
  const baseId = useId();
  const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({ text: null, file: null, url: null });

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
      <div className="tabs" role="tablist" aria-label="Import from" onKeyDown={onTabKey}>
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
        {tab === 'url' && <UrlForm onSubmit={onUrl} />}
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
        placeholder="Paste or type the text you want to hear…"
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

function UrlForm({ onSubmit }: { onSubmit: AddPanelProps['onUrl'] }) {
  const [url, setUrl] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (url.trim() && (await onSubmit(url.trim()))) setUrl('');
  };
  return (
    <form className="add-form" onSubmit={submit}>
      <div className="url-row">
        <input
          className="input"
          type="url"
          inputMode="url"
          required
          placeholder="https://example.com/article"
          aria-label="Web page address"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <button type="submit" className="btn btn--primary" disabled={!url.trim()}>
          Import
        </button>
      </div>
      <p className="muted small">Some sites refuse to be read from another site. A server or proxy in Settings can help.</p>
    </form>
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
