/**
 * Replace characters Edge's service rejects (C0 controls other than tab, LF and CR; vertical
 * tab is common in OCR-ed PDFs) with spaces. Length is preserved so offsets into the original
 * text stay valid. Lone UTF-16 surrogates are replaced too, as they cannot be encoded.
 * @param {string} text
 */
export function removeIncompatibleCharacters(text) {
  return text
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ')
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, ' ');
}

/**
 * Escape text for an SSML text node (same set as Python's xml.sax.saxutils.escape).
 * @param {string} text
 */
export function escapeXml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Escape for a single-quoted XML attribute. @param {string} text */
export function escapeAttr(text) {
  return escapeXml(text).replace(/'/g, '&apos;').replace(/"/g, '&quot;');
}

/**
 * Undo XML escaping in a word the service reports back.
 * @param {string} text
 */
export function unescapeXml(text) {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * Build the SSML document for one request.
 * @param {string} voice
 * @param {string} text  Raw text (escaped here).
 * @param {{ rate?: string, pitch?: string, volume?: string }} [prosody]
 */
export function makeSsml(voice, text, prosody = {}) {
  const rate = prosody.rate ?? '+0%';
  const pitch = prosody.pitch ?? '+0Hz';
  const volume = prosody.volume ?? '+0%';
  return (
    "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>" +
    `<voice name='${escapeAttr(voice)}'>` +
    `<prosody pitch='${escapeAttr(pitch)}' rate='${escapeAttr(rate)}' volume='${escapeAttr(volume)}'>` +
    escapeXml(removeIncompatibleCharacters(text)) +
    '</prosody></voice></speak>'
  );
}

/**
 * Split text into pieces whose escaped UTF-8 size stays under `maxBytes` (the service accepts
 * about 4 KiB of SSML text per request), preferring newlines, then spaces. Pieces keep their
 * offset into the original text. Characters are never split.
 * @param {string} text
 * @param {number} [maxBytes]
 * @returns {Array<{ text: string, offset: number }>}
 */
export function splitForService(text, maxBytes = 4000) {
  /** @type {Array<{ text: string, offset: number }>} */
  const out = [];
  const size = (/** @type {string} */ s) => Buffer.byteLength(escapeXml(s), 'utf8');
  let start = 0;
  while (start < text.length) {
    if (size(text.slice(start)) <= maxBytes) {
      out.push({ text: text.slice(start), offset: start });
      break;
    }
    // Largest end such that text[start:end] fits.
    let lo = start + 1;
    let hi = text.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (size(text.slice(start, mid)) <= maxBytes) lo = mid;
      else hi = mid - 1;
    }
    let end = lo;
    // Do not split a surrogate pair.
    if (/[\uD800-\uDBFF]/.test(text[end - 1] ?? '') && end < text.length) end--;
    const window = text.slice(start, end);
    const nl = window.lastIndexOf('\n');
    const sp = window.lastIndexOf(' ');
    const cut = nl > 0 ? nl : sp > 0 ? sp : -1;
    if (cut > 0) end = start + cut;
    if (end <= start) end = start + 1;
    out.push({ text: text.slice(start, end), offset: start });
    start = end;
  }
  return out.filter((p) => p.text.trim() !== '');
}
