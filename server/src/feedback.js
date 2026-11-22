/**
 * User feedback: validation, a strict front-matter serialiser and a store that writes one
 * Markdown file per submission. Everything a client sends is untrusted; see `serializeFrontMatter`.
 */
import { randomBytes } from 'node:crypto';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { HttpError } from './http-util.js';

export const MAX_MESSAGE_CHARS = 5000;
export const MAX_CONTACT_CHARS = 200;
export const MAX_VALUE_CHARS = 200;
export const MAX_USER_AGENT_CHARS = 300;
export const CATEGORIES = new Set(['bug', 'idea', 'other']);

/**
 * Context keys the client may send, in output order, with their front-matter name and type.
 * @type {ReadonlyArray<readonly [string, string, 'string' | 'boolean']>}
 */
export const CONTEXT_KEYS = [
  ['route', 'route', 'string'],
  ['engine', 'engine', 'string'],
  ['voice', 'voice', 'string'],
  ['theme', 'theme', 'string'],
  ['viewport', 'viewport', 'string'],
  ['language', 'language', 'string'],
  ['appVersion', 'app_version', 'string'],
  ['standalone', 'standalone', 'boolean'],
  ['sourceKind', 'source_kind', 'string'],
];

/** Count code points, not UTF-16 units, so an emoji is one character. */
export const charCount = (/** @type {string} */ s) => {
  let n = 0;
  for (const _ of s) n++;
  return n;
};

// Lone surrogates (invalid UTF-16; YAML rejects their escapes), BOM and the noncharacters
// U+FFFE/U+FFFF.
const UNPAIRED = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]|[\uFEFF\uFFFE\uFFFF]/g;
// C0 controls except tab and newline, DEL and C1 controls.
const CONTROL_EXCEPT_TAB_LF = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g;

/**
 * Make an untrusted value safe for a single-line front-matter string: line breaks and tabs
 * become spaces, other control characters, line/paragraph separators, BOM and lone surrogates
 * are removed, runs of spaces collapse, and the result is trimmed and cut to `max` code points.
 * @param {string} value
 * @param {number} [max]
 */
export function sanitizeLine(value, max = MAX_VALUE_CHARS) {
  const clean = value
    .replace(UNPAIRED, '')
    .replace(/[\t\n\r\u2028\u2029\u0085]+/g, ' ')
    .replace(CONTROL_EXCEPT_TAB_LF, '')
    .replace(/ {2,}/g, ' ')
    .trim();
  return truncate(clean, max).trim();
}

/**
 * @param {string} s
 * @param {number} max code points
 */
function truncate(s, max) {
  if (s.length <= max) return s; // UTF-16 length bounds the code point count
  let out = '';
  let n = 0;
  for (const ch of s) {
    if (n++ >= max) break;
    out += ch;
  }
  return out;
}

/**
 * The message as the user wrote it, minus what does not belong in a text file: line endings
 * become `\n` (also U+2028/U+2029), control characters other than tab/newline, BOM and lone
 * surrogates are removed, and leading/trailing blank lines are trimmed.
 * @param {string} text
 */
export function sanitizeMessage(text) {
  return text
    .replace(/\r\n?|[\u2028\u2029\u0085]/g, '\n')
    .replace(UNPAIRED, '')
    .replace(CONTROL_EXCEPT_TAB_LF, '')
    .replace(/^(?:[ \t]*\n)+/, '')
    .replace(/[ \t\n]+$/, '');
}

/**
 * Serialise ordered `[key, value]` pairs as a YAML front-matter block (with `---` lines).
 * Strings are sanitised with `sanitizeLine` and emitted double-quoted via `JSON.stringify`.
 * After sanitising, the only characters it escapes are `"` and `\`, so each value is at once a
 * valid YAML double-quoted scalar and a valid JSON string, and cannot span lines. Booleans and
 * finite numbers are emitted bare; anything else (and empty strings) is omitted.
 * @param {Iterable<readonly [string, unknown, number?]>} entries  [key, value, max length]
 */
export function serializeFrontMatter(entries) {
  const lines = ['---'];
  for (const [key, value, max] of entries) {
    if (!/^[a-z][a-z0-9_]*$/.test(key)) throw new Error(`invalid front-matter key: ${key}`);
    if (typeof value === 'string') {
      const s = sanitizeLine(value, max ?? MAX_VALUE_CHARS);
      if (s) lines.push(`${key}: ${JSON.stringify(s)}`);
    } else if (typeof value === 'boolean') {
      lines.push(`${key}: ${value ? 'true' : 'false'}`);
    } else if (typeof value === 'number' && Number.isFinite(value)) {
      lines.push(`${key}: ${JSON.stringify(value)}`);
    }
  }
  lines.push('---');
  return lines.join('\n') + '\n';
}

/**
 * Pick the allowed context keys (own properties only) with the expected types. String keys
 * also take a finite number, written as a string.
 * @param {unknown} context
 * @returns {Array<[string, string | boolean]>}
 */
export function pickContext(context) {
  if (!context || typeof context !== 'object' || Array.isArray(context)) return [];
  /** @type {Array<[string, string | boolean]>} */
  const out = [];
  for (const [inKey, outKey, type] of CONTEXT_KEYS) {
    if (!Object.hasOwn(context, inKey)) continue;
    const v = /** @type {Record<string, unknown>} */ (context)[inKey];
    if (type === 'boolean') {
      if (typeof v === 'boolean') out.push([outKey, v]);
    } else if (typeof v === 'string') {
      out.push([outKey, v]);
    } else if (typeof v === 'number' && Number.isFinite(v)) {
      out.push([outKey, String(v)]);
    }
  }
  return out;
}

/**
 * @typedef {object} Feedback
 * @property {string} message   Sanitised message body.
 * @property {string} category
 * @property {string} [contact]
 * @property {Array<[string, string | boolean]>} context
 */

/**
 * Validate a parsed request body; throws 400 HttpErrors with readable messages.
 * @param {unknown} body
 * @returns {Feedback}
 */
export function validateFeedback(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Request body must be a JSON object');
  const { message, category, contact, context } = /** @type {Record<string, unknown>} */ (body);
  if (typeof message !== 'string') throw new HttpError(400, 'message must be a non-empty string');
  if (charCount(message.trim()) > MAX_MESSAGE_CHARS) {
    throw new HttpError(400, `message must be at most ${MAX_MESSAGE_CHARS} characters`);
  }
  const text = sanitizeMessage(message);
  if (!text.trim()) throw new HttpError(400, 'message must be a non-empty string');
  let cat = 'other';
  if (category !== undefined && category !== null) {
    if (typeof category !== 'string' || !CATEGORIES.has(category)) {
      throw new HttpError(400, 'category must be "bug", "idea" or "other"');
    }
    cat = category;
  }
  /** @type {string | undefined} */
  let contactOut;
  if (contact !== undefined && contact !== null) {
    if (typeof contact !== 'string') throw new HttpError(400, 'contact must be a string');
    if (charCount(contact) > MAX_CONTACT_CHARS) {
      throw new HttpError(400, `contact must be at most ${MAX_CONTACT_CHARS} characters`);
    }
    contactOut = contact;
  }
  return { message: text, category: cat, contact: contactOut, context: pickContext(context) };
}

/**
 * The complete Markdown file for one submission.
 * @param {{ id: string, date: Date, userAgent?: string } & Feedback} f
 */
export function renderFeedbackFile(f) {
  const fm = serializeFrontMatter([
    ['id', f.id],
    ['date', f.date.toISOString()],
    ['category', f.category],
    ['contact', f.contact, MAX_CONTACT_CHARS],
    ...f.context,
    ['user_agent', f.userAgent, MAX_USER_AGENT_CHARS],
  ]);
  return `${fm}\n${f.message}\n`;
}

/** @param {Date} d */
function stamp(d) {
  const iso = d.toISOString(); // 2026-11-22T15:30:12.000Z
  return { day: iso.slice(0, 10), time: iso.slice(11, 19).replaceAll(':', '') };
}

/**
 * Writes feedback files into one directory. The directory is created on demand; if that
 * fails the store reports itself unavailable and retries after `retryMs`.
 */
export class FeedbackStore {
  /**
   * @param {{ dir: string, maxFiles: number, retryMs?: number }} opts
   */
  constructor({ dir, maxFiles, retryMs = 10_000 }) {
    this.dir = dir;
    this.maxFiles = maxFiles;
    this.retryMs = retryMs;
    /** Number of `.md` files in `dir`, known once ready. */
    this.count = 0;
    /** Writes in flight, reserved against `maxFiles`. */
    this.pending = 0;
    this.ready = false;
    this.failedAt = 0;
    /** @type {Promise<boolean> | null} */
    this.initializing = null;
  }

  /** Create the directory and count its files. Never throws. */
  init() {
    if (this.ready) return Promise.resolve(true);
    if (this.initializing) return this.initializing;
    if (this.failedAt && Date.now() - this.failedAt < this.retryMs) return Promise.resolve(false);
    this.initializing = (async () => {
      try {
        await mkdir(this.dir, { recursive: true, mode: 0o750 });
        const names = await readdir(this.dir);
        this.count = names.filter((n) => n.endsWith('.md')).length;
        this.ready = true;
        this.failedAt = 0;
        return true;
      } catch (err) {
        this.#fail(err);
        return false;
      } finally {
        this.initializing = null;
      }
    })();
    return this.initializing;
  }

  /** @returns {Promise<boolean>} */
  available() {
    return this.init();
  }

  /** @param {unknown} err */
  #fail(err) {
    if (this.ready || !this.failedAt) {
      console.error(`[openspeek] feedback directory ${this.dir} is not usable:`, /** @type {Error} */ (err).message);
    }
    this.ready = false;
    this.failedAt = Date.now();
  }

  /**
   * Save one submission. Returns its id.
   * @param {Feedback & { userAgent?: string }} feedback
   * @param {Date} [now]
   */
  async save(feedback, now = new Date()) {
    if (!(await this.init())) throw new HttpError(503, 'Feedback storage is not available on this server right now');
    if (this.count + this.pending >= this.maxFiles) {
      throw new HttpError(507, 'The server has stored as much feedback as it can; please try again later');
    }
    this.pending++;
    try {
      const { day, time } = stamp(now);
      for (let attempt = 0; attempt < 8; attempt++) {
        const hex = randomBytes(3).toString('hex');
        const id = `${day.replaceAll('-', '')}-${time}-${hex}`;
        const file = path.join(this.dir, `${day}-${time}-${hex}.md`);
        const data = renderFeedbackFile({ ...feedback, id, date: now });
        try {
          await writeFile(file, data, { flag: 'wx', mode: 0o640 });
        } catch (err) {
          if (/** @type {NodeJS.ErrnoException} */ (err).code === 'EEXIST') continue;
          this.#fail(err);
          throw new HttpError(503, 'Could not save feedback on this server right now');
        }
        this.count++;
        return id;
      }
      throw new HttpError(503, 'Could not save feedback on this server right now');
    } finally {
      this.pending--;
    }
  }
}
