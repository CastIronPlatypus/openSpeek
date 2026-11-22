import { useState, type FormEvent } from 'react';
import type { DocMeta } from '../../types';
import { Dialog } from '../common/Dialog';
import { PencilIcon, TrashIcon } from '../common/icons';
import { formatCount, formatListeningTime, formatRelative, SOURCE_LABELS } from '../format';
import { readerHref } from '../useHashRoute';

interface DocumentListProps {
  docs: DocMeta[];
  rate: number;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
}

export function DocumentList({ docs, rate, onRename, onDelete }: DocumentListProps) {
  const [deleting, setDeleting] = useState<DocMeta | null>(null);
  return (
    <>
      <ul className="doc-list">
        {docs.map((doc) => (
          <DocumentRow key={doc.id} doc={doc} rate={rate} onRename={onRename} onAskDelete={setDeleting} />
        ))}
      </ul>
      <Dialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title="Delete document?"
        size="small"
        footer={
          <>
            <button type="button" className="btn" onClick={() => setDeleting(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn--danger"
              onClick={() => {
                if (deleting) onDelete(deleting.id);
                setDeleting(null);
              }}
            >
              Delete
            </button>
          </>
        }
      >
        <p>
          “{deleting?.title}” and its reading progress will be removed from this browser. This can’t be undone.
        </p>
      </Dialog>
    </>
  );
}

interface RowProps {
  doc: DocMeta;
  rate: number;
  onRename: (id: string, title: string) => void;
  onAskDelete: (doc: DocMeta) => void;
}

function DocumentRow({ doc, rate, onRename, onAskDelete }: RowProps) {
  const [editing, setEditing] = useState(false);
  const fraction = doc.sentenceCount > 0 ? Math.min(1, doc.progress / doc.sentenceCount) : 0;
  const percent = Math.round(fraction * 100);
  const meta = [
    SOURCE_LABELS[doc.source.kind],
    formatCount(doc.wordCount, 'word'),
    formatListeningTime(doc.wordCount, rate),
    formatRelative(doc.updatedAt),
  ].join(' · ');

  return (
    <li className="doc">
      {editing ? (
        <RenameForm
          title={doc.title}
          onDone={(title) => {
            setEditing(false);
            if (title && title !== doc.title) onRename(doc.id, title);
          }}
        />
      ) : (
        <a className="doc-main" href={readerHref(doc.id)}>
          <span className="doc-title">{doc.title}</span>
          <span className="doc-meta">{meta}</span>
          <span className="doc-progress-row">
            <span className="doc-progress" aria-hidden="true">
              <span style={{ width: `${percent}%` }} />
            </span>
            <span className="doc-percent">{percent > 0 ? `${percent}% listened` : 'Not started'}</span>
          </span>
        </a>
      )}
      {!editing && (
        <div className="doc-actions">
          <button type="button" className="icon-btn" aria-label={`Rename “${doc.title}”`} title="Rename" onClick={() => setEditing(true)}>
            <PencilIcon size={18} />
          </button>
          <button type="button" className="icon-btn" aria-label={`Delete “${doc.title}”`} title="Delete" onClick={() => onAskDelete(doc)}>
            <TrashIcon size={18} />
          </button>
        </div>
      )}
    </li>
  );
}

function RenameForm({ title, onDone }: { title: string; onDone: (title: string | null) => void }) {
  const [value, setValue] = useState(title);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onDone(value.trim() || null);
  };
  return (
    <form className="rename-form" onSubmit={submit}>
      <input
        className="input"
        aria-label="Document title"
        value={value}
        autoFocus
        onFocus={(e) => e.target.select()}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onDone(null);
        }}
      />
      <button type="submit" className="btn btn--primary">
        Save
      </button>
      <button type="button" className="btn" onClick={() => onDone(null)}>
        Cancel
      </button>
    </form>
  );
}
