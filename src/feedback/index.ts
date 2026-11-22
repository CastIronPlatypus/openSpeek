/**
 * User feedback sent to the openSpeek server (`POST /api/feedback`, docs/server-api.md).
 * The request carries the message and a few app details; never document text, titles,
 * file names or URLs.
 */
import { version } from '../../package.json';
import type { EngineId, SourceKind, Theme } from '../types';

export const APP_VERSION: string = version;
export const MAX_MESSAGE_CHARS = 5000;
export const MAX_CONTACT_CHARS = 200;
const SEND_TIMEOUT_MS = 20_000;

export type FeedbackCategory = 'bug' | 'idea' | 'other';
export const FEEDBACK_CATEGORIES: readonly FeedbackCategory[] = ['bug', 'idea', 'other'];

/** What the app knows about itself when feedback is sent; supplied by the UI. */
export interface FeedbackAppState {
  route: 'library' | 'reader';
  engine: EngineId;
  /** `null`: the engine's default voice. */
  voice: string | null;
  /** The theme setting and what it resolves to right now. */
  theme: Theme;
  resolvedTheme: 'light' | 'dark';
  /** Kind of the open document, in the reader. */
  sourceKind?: SourceKind | null;
}

/** What the browser tells us. */
export interface FeedbackEnvironment {
  width: number;
  height: number;
  language: string;
  standalone: boolean;
}

/** The `context` object of the request, as the server stores it. */
export interface FeedbackContext {
  route: 'library' | 'reader';
  engine: EngineId;
  voice: string;
  theme: string;
  viewport: string;
  language: string;
  appVersion: string;
  standalone: boolean;
  sourceKind?: SourceKind;
}

export interface FeedbackInput {
  message: string;
  category: FeedbackCategory;
  /** Optional; blank means none. */
  contact?: string;
  app: FeedbackAppState;
}

export interface FeedbackRequestBody {
  message: string;
  category: FeedbackCategory;
  contact?: string;
  context: FeedbackContext;
}

export function readEnvironment(): FeedbackEnvironment {
  const nav = globalThis.navigator as (Navigator & { standalone?: boolean }) | undefined;
  return {
    width: globalThis.innerWidth ?? 0,
    height: globalThis.innerHeight ?? 0,
    language: nav?.language ?? '',
    standalone: globalThis.matchMedia?.('(display-mode: standalone)').matches === true || nav?.standalone === true,
  };
}

export function buildFeedbackContext(app: FeedbackAppState, env: FeedbackEnvironment = readEnvironment()): FeedbackContext {
  const context: FeedbackContext = {
    route: app.route,
    engine: app.engine,
    voice: app.voice ?? 'default',
    theme: app.theme === 'system' ? `${app.resolvedTheme} (system)` : app.resolvedTheme,
    viewport: `${Math.round(env.width)}x${Math.round(env.height)}`,
    language: env.language,
    appVersion: APP_VERSION,
    standalone: env.standalone,
  };
  if (app.route === 'reader' && app.sourceKind) context.sourceKind = app.sourceKind;
  return context;
}

/** Code points, as the server counts them: an emoji is one character. */
export function charCount(s: string): number {
  let n = 0;
  for (const _ of s) n++;
  return n;
}

/** Whether the message can be sent: not blank, not too long. */
export function isSendableMessage(message: string): boolean {
  const trimmed = message.trim();
  return trimmed.length > 0 && charCount(trimmed) <= MAX_MESSAGE_CHARS;
}

export function buildFeedbackBody(input: FeedbackInput, env: FeedbackEnvironment = readEnvironment()): FeedbackRequestBody {
  const body: FeedbackRequestBody = {
    message: input.message,
    category: input.category,
    context: buildFeedbackContext(input.app, env),
  };
  const contact = input.contact?.trim();
  if (contact) body.contact = contact;
  return body;
}

/** A readable message for a failed response. */
export function feedbackErrorMessage(status: number, body: unknown): string {
  if (status === 429) return 'You’ve sent a lot of feedback recently — try again later.';
  if (status === 404 || status === 405) return 'This openSpeek server doesn’t accept feedback.';
  if (isRecord(body) && typeof body.error === 'string' && body.error) return body.error;
  return `Couldn’t send feedback (server error ${status}).`;
}

export interface SendOptions {
  /** Server base URL; `''` means the page's own origin. */
  baseUrl: string;
  fetcher?: (input: string, init?: RequestInit) => Promise<Response>;
  env?: FeedbackEnvironment;
}

/** Posts the feedback; rejects with a user-readable Error. */
export async function sendFeedback(input: FeedbackInput, opts: SendOptions): Promise<{ id: string }> {
  const { fetcher = (url, init) => fetch(url, init) } = opts;
  const base = opts.baseUrl.trim().replace(/\/+$/, '');
  const where = base || globalThis.location?.origin || 'this site';
  let res: Response;
  try {
    res = await fetcher(`${base}/api/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildFeedbackBody(input, opts.env)),
      signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(SEND_TIMEOUT_MS) : undefined,
    });
  } catch (error) {
    if (error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      throw new Error('The openSpeek server took too long to answer. Try again in a moment.');
    }
    throw new Error(`Can’t reach the openSpeek server at ${where}. Check your connection and try again.`);
  }
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) throw new Error(feedbackErrorMessage(res.status, body));
  return { id: isRecord(body) && typeof body.id === 'string' ? body.id : '' };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
