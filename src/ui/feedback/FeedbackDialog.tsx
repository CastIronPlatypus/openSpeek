import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import {
  buildFeedbackContext,
  charCount,
  isSendableMessage,
  MAX_CONTACT_CHARS,
  MAX_MESSAGE_CHARS,
  type FeedbackAppState,
  type FeedbackCategory,
  type FeedbackContext,
} from '../../feedback';
import type { ServerStatus } from '../../types';
import { useApp } from '../appModel';
import { Dialog } from '../common/Dialog';
import { engineLabel } from '../engines';
import { useStore } from '../store';
import { EMPTY_DRAFT, feedbackDraft } from './draft';
import '../styles/feedback.css';

const CATEGORIES: { value: FeedbackCategory; label: string }[] = [
  { value: 'bug', label: 'Bug' },
  { value: 'idea', label: 'Idea' },
  { value: 'other', label: 'Other' },
];

/** The counter becomes prominent from here on. */
const COUNTER_WARN_AT = MAX_MESSAGE_CHARS - 500;

export const FEEDBACK_SENT = 'Thanks — feedback sent.';
const UNAVAILABLE = 'Sending feedback needs the openSpeek server, and it isn’t available in this setup.';

function resolvedTheme(): 'light' | 'dark' {
  const forced = document.documentElement.dataset.theme;
  if (forced === 'light' || forced === 'dark') return forced;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** Typing on a touch screen brings up a keyboard; only focus the message where that cannot happen. */
const canAutofocus = () => matchMedia('(hover: hover) and (pointer: fine)').matches;

const feedbackAvailable = (s: ServerStatus | null) => !!s?.reachable && s.feedback;

interface FeedbackDialogProps {
  open: boolean;
  onClose: () => void;
  route: 'library' | 'reader';
}

export function FeedbackDialog({ open, onClose, route }: FeedbackDialogProps) {
  const model = useApp();
  const status = useStore(model.serverStatus);
  const [checking, setChecking] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formId = useId();

  // Re-check the server each time the dialog opens, skipping the status cache.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setChecking(true);
    let live = true;
    void model.refreshServerStatus(0).finally(() => live && setChecking(false));
    return () => {
      live = false;
    };
  }, [open, model]);

  const draftStore = feedbackDraft();
  const draft = useStore(draftStore);
  const available = feedbackAvailable(status);
  const known = status !== null && !(checking && !available);
  const canSend = available && !sending && isSendableMessage(draft.message);

  const appState = (): FeedbackAppState => {
    const engine = model.activeEngine.get();
    const settings = model.settings.get();
    return {
      route,
      engine,
      voice: settings.voices[engine],
      theme: settings.theme,
      resolvedTheme: resolvedTheme(),
      sourceKind: model.readerSourceKind.get(),
    };
  };

  const send = async () => {
    if (!canSend) return;
    setSending(true);
    setError(null);
    const sent = draftStore.get();
    try {
      await model.services.sendFeedback({ message: sent.message, category: sent.category, contact: sent.contact, app: appState() });
      // Keep anything typed while the request was on its way.
      if (draftStore.get() === sent) draftStore.set(EMPTY_DRAFT);
      model.notice.set(FEEDBACK_SENT);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Send feedback"
      size="sheet"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form={formId} className="btn btn--primary" disabled={!canSend} aria-busy={sending || undefined}>
            {sending && <span className="spinner spinner--on-accent" aria-hidden="true" />}
            {sending ? 'Sending…' : 'Send'}
          </button>
        </>
      }
    >
      <FeedbackForm
        id={formId}
        sending={sending}
        error={error}
        availability={!known ? 'checking' : available ? 'available' : 'unavailable'}
        context={open ? buildFeedbackContext(appState()) : null}
        onSubmit={() => void send()}
      />
    </Dialog>
  );
}

interface FeedbackFormProps {
  id: string;
  sending: boolean;
  error: string | null;
  availability: 'checking' | 'available' | 'unavailable';
  context: FeedbackContext | null;
  onSubmit: () => void;
}

function FeedbackForm({ id, sending, error, availability, context, onSubmit }: FeedbackFormProps) {
  const draftStore = feedbackDraft();
  const draft = useStore(draftStore);
  const update = (patch: Partial<typeof draft>) => draftStore.set({ ...draftStore.get(), ...patch });
  const messageRef = useRef<HTMLTextAreaElement>(null);
  const ids = { category: useId(), message: useId(), counter: useId(), contact: useId(), note: useId() };
  const count = charCount(draft.message);
  const counterState = count > MAX_MESSAGE_CHARS ? 'over' : count >= COUNTER_WARN_AT ? 'near' : undefined;

  // The dialog opens after this mounts, so focus on the next frame, once it is showing.
  useEffect(() => {
    if (!canAutofocus()) return;
    const frame = requestAnimationFrame(() => {
      const el = messageRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLFormElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      onSubmit();
    }
  };

  return (
    <form
      id={id}
      className="feedback-form"
      noValidate
      onKeyDown={onKeyDown}
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      {availability === 'unavailable' && (
        <p className="feedback-unavailable small" id={ids.note}>
          {UNAVAILABLE}
        </p>
      )}
      {availability === 'checking' && (
        <p className="muted small feedback-checking" id={ids.note}>
          <span className="spinner spinner--small" aria-hidden="true" /> Checking the openSpeek server…
        </p>
      )}

      <div className="field">
        <span className="field-label" id={ids.category}>
          Type
        </span>
        <div className="segmented segmented--tall" role="radiogroup" aria-labelledby={ids.category}>
          {CATEGORIES.map((c) => (
            <label key={c.value} className="segmented-option">
              <input
                type="radio"
                name={ids.category}
                value={c.value}
                checked={draft.category === c.value}
                onChange={() => update({ category: c.value })}
              />
              <span>{c.label}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="field">
        <div className="feedback-label-row">
          <label className="field-label" htmlFor={ids.message}>
            Message
          </label>
          <span className="feedback-counter small" id={ids.counter} data-state={counterState} aria-live={counterState ? 'polite' : 'off'}>
            {count.toLocaleString()} / {MAX_MESSAGE_CHARS.toLocaleString()}
            {counterState === 'over' && <span> — too long</span>}
          </span>
        </div>
        <textarea
          ref={messageRef}
          id={ids.message}
          className="input textarea feedback-message"
          rows={5}
          required
          aria-required="true"
          aria-describedby={ids.counter}
          aria-invalid={counterState === 'over' || undefined}
          readOnly={sending}
          placeholder="What happened, or what would make openSpeek better?"
          value={draft.message}
          onChange={(e) => update({ message: e.target.value })}
        />
      </div>

      <div className="field">
        <label className="field-label" htmlFor={ids.contact}>
          Email or name if you’d like a reply — optional
        </label>
        <input
          id={ids.contact}
          className="input"
          type="text"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="off"
          spellCheck={false}
          maxLength={MAX_CONTACT_CHARS}
          readOnly={sending}
          value={draft.contact}
          onChange={(e) => update({ contact: e.target.value })}
        />
      </div>

      {error && (
        <p className="banner banner--error small" role="alert">
          {error}
        </p>
      )}

      <div className="feedback-disclosure small muted">
        <p>
          Sent to this openSpeek server along with app details (engine, voice, theme, screen size, browser). Your documents
          are not included.
        </p>
        {context && <IncludedDetails context={context} />}
      </div>
    </form>
  );
}

function IncludedDetails({ context }: { context: FeedbackContext }) {
  const rows: [string, string][] = [
    ['Screen', context.route === 'reader' ? 'Reader' : 'Library'],
    ['Engine', `${engineLabel(context.engine)} (${context.engine})`],
    ['Voice', context.voice],
    ['Theme', context.theme],
    ['Window size', context.viewport],
    ['Language', context.language || '—'],
    ['App version', context.appVersion],
    ['Installed app', context.standalone ? 'Yes' : 'No'],
  ];
  if (context.sourceKind) rows.push(['Document type', context.sourceKind]);
  rows.push(['Browser', navigator.userAgent]);
  return (
    <details className="feedback-details">
      <summary>What’s included</summary>
      <dl>
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <p>Plus the type, your message and the contact you entered. Your IP address is not stored.</p>
    </details>
  );
}
