import { FEEDBACK_CATEGORIES, type FeedbackCategory } from '../../feedback';
import { createStore, type Store } from '../store';

/** Unsent feedback, kept for the session so closing the dialog or reloading loses nothing. */
export interface FeedbackDraft {
  message: string;
  category: FeedbackCategory;
  contact: string;
}

export const EMPTY_DRAFT: FeedbackDraft = { message: '', category: 'other', contact: '' };
const KEY = 'openspeek:feedback-draft';

export function parseDraft(raw: string | null): FeedbackDraft {
  if (!raw) return EMPTY_DRAFT;
  try {
    const v: unknown = JSON.parse(raw);
    if (typeof v !== 'object' || v === null) return EMPTY_DRAFT;
    const { message, category, contact } = v as Record<string, unknown>;
    return {
      message: typeof message === 'string' ? message : '',
      category: FEEDBACK_CATEGORIES.includes(category as FeedbackCategory) ? (category as FeedbackCategory) : 'other',
      contact: typeof contact === 'string' ? contact : '',
    };
  } catch {
    return EMPTY_DRAFT;
  }
}

export const isEmptyDraft = (d: FeedbackDraft) => !d.message && !d.contact && d.category === EMPTY_DRAFT.category;

/** A draft store backed by `storage` (sessionStorage); storage failures are ignored. */
export function createDraftStore(storage: () => Storage | undefined = () => globalThis.sessionStorage): Store<FeedbackDraft> {
  let initial = EMPTY_DRAFT;
  try {
    initial = parseDraft(storage()?.getItem(KEY) ?? null);
  } catch {
    // Storage blocked: the draft lives in memory only.
  }
  const store = createStore(initial);
  store.subscribe(() => {
    const draft = store.get();
    try {
      if (isEmptyDraft(draft)) storage()?.removeItem(KEY);
      else storage()?.setItem(KEY, JSON.stringify(draft));
    } catch {
      // Full or blocked storage: keep the in-memory draft.
    }
  });
  return store;
}

let shared: Store<FeedbackDraft> | null = null;

/** The app's feedback draft, created on first use. */
export function feedbackDraft(): Store<FeedbackDraft> {
  shared ??= createDraftStore();
  return shared;
}
