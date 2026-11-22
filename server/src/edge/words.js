/**
 * Map Edge WordBoundary events onto character offsets in the request text.
 *
 * The service reports each word's text (not its position), so we scan forward from the end of
 * the previous match. Words that cannot be located nearby (the service may expand or normalise
 * numbers, abbreviations or symbols) are skipped rather than given wrong offsets.
 */

/**
 * @typedef {object} Boundary
 * @property {number} offset    100 ns ticks from the start of the audio.
 * @property {number} duration  100 ns ticks.
 * @property {string} text      Word text as reported (already XML-unescaped).
 */

/**
 * @typedef {object} WordTiming
 * @property {number} start
 * @property {number} end
 * @property {number} charStart
 * @property {number} charEnd
 */

/** How many intervening word tokens a match may skip before we distrust it. */
const MAX_SKIPPED_TOKENS = 3;
/** And how many characters. */
const MAX_SKIPPED_CHARS = 64;

/**
 * Fold a string for lenient comparison, one output char per input UTF-16 unit so indices line
 * up: lower case, curly quotes and dashes to ASCII, NBSP to space.
 * @param {string} s
 */
export function foldForMatch(s) {
  let out = '';
  for (const ch of s) {
    let c = ch;
    if (/[‘’‚‛′`´]/.test(c)) c = "'";
    else if (/[“”„‟″«»]/.test(c)) c = '"';
    else if (/[‐-―−]/.test(c)) c = '-';
    else if (/[   ]/.test(c)) c = ' ';
    else {
      const lower = c.toLowerCase();
      // Keep the length identical; some characters change length when lower-cased.
      c = lower.length === c.length ? lower : c;
    }
    out += c;
  }
  return out;
}

const isWordChar = (/** @type {string | undefined} */ c) => !!c && /[\p{L}\p{N}\p{M}]/u.test(c);

/**
 * @param {string} gap
 */
function tokenCount(gap) {
  const m = gap.match(/[\p{L}\p{N}]+/gu);
  return m ? m.length : 0;
}

/**
 * Find `word` in `hay` (both folded) at or after `from`, at a word boundary.
 * @param {string} hay
 * @param {string} word
 * @param {number} from
 * @returns {number} index or -1
 */
function findAtBoundary(hay, word, from) {
  let idx = hay.indexOf(word, from);
  while (idx >= 0) {
    const before = hay[idx - 1];
    const after = hay[idx + word.length];
    const startsOk = !isWordChar(word[0]) || !isWordChar(before);
    const endsOk = !isWordChar(word[word.length - 1]) || !isWordChar(after);
    if (startsOk && endsOk) return idx;
    idx = hay.indexOf(word, idx + 1);
  }
  return -1;
}

/**
 * @param {string} text            The request text (offsets refer to it).
 * @param {Boundary[]} boundaries  In audio order.
 * @returns {WordTiming[]}
 */
export function mapWordBoundaries(text, boundaries) {
  const hay = foldForMatch(text);
  /** @type {WordTiming[]} */
  const out = [];
  let cursor = 0;
  for (const b of boundaries) {
    const raw = (b.text ?? '').trim();
    if (!raw) continue;
    const word = foldForMatch(raw);
    let idx = findAtBoundary(hay, word, cursor);
    // Some reported words carry punctuation the text lacks, or vice versa: retry on the core.
    let len = word.length;
    if (idx < 0) {
      const core = word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
      if (core && core !== word) {
        idx = findAtBoundary(hay, core, cursor);
        len = core.length;
      }
    }
    if (idx < 0) continue;
    const gap = hay.slice(cursor, idx);
    if (gap.length > MAX_SKIPPED_CHARS || tokenCount(gap) > MAX_SKIPPED_TOKENS) continue;
    const start = b.offset / 1e7;
    const end = (b.offset + Math.max(0, b.duration)) / 1e7;
    out.push({
      start: Math.round(start * 1000) / 1000,
      end: Math.round(end * 1000) / 1000,
      charStart: idx,
      charEnd: idx + len,
    });
    cursor = idx + len;
  }
  return out;
}
