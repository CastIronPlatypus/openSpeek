/**
 * Static hosting of the Vite build with SPA fallback.
 */
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';

export const MIME = /** @type {Record<string, string>} */ ({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.onnx': 'application/octet-stream',
  '.bin': 'application/octet-stream',
  '.gguf': 'application/octet-stream',
  '.safetensors': 'application/octet-stream',
  '.pdf': 'application/pdf',
});

/**
 * Map a request path to a file path inside `root`, or null if it is malformed or escapes.
 * Pure: does not touch the file system.
 * @param {string} root      Absolute directory.
 * @param {string} urlPath   The URL pathname (still percent-encoded).
 * @returns {string | null}
 */
export function resolveStaticPath(root, urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return null;
  if (!decoded.startsWith('/')) return null;
  // Refuse any dot-dot segment outright rather than normalising it away.
  if (decoded.split('/').some((seg) => seg === '..')) return null;
  const rel = path.posix.normalize(decoded).replace(/^\/+/, '');
  const full = path.resolve(root, rel);
  const rootResolved = path.resolve(root);
  if (full !== rootResolved && !full.startsWith(rootResolved + path.sep)) return null;
  return full;
}

/** Hashed build output can be cached forever. @param {string} urlPath */
export function isImmutableAsset(urlPath) {
  return urlPath.startsWith('/assets/') || /[.-][A-Za-z0-9_-]{8,}\.(?:js|mjs|css|wasm|woff2?|png|svg|jpg|webp)$/.test(urlPath);
}

export class StaticFiles {
  /** @param {string} root */
  constructor(root) {
    this.root = path.resolve(root);
    /** @type {string | null} */
    this.realRoot = null;
  }

  async available() {
    try {
      this.realRoot = await realpath(this.root);
      await stat(path.join(this.realRoot, 'index.html'));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * @param {string} file
   * @returns {Promise<{ file: string, size: number, mtime: Date } | null>}
   */
  async #lookup(file) {
    try {
      const real = await realpath(file);
      const root = this.realRoot ?? (await realpath(this.root));
      if (real !== root && !real.startsWith(root + path.sep)) return null; // symlink escape
      const st = await stat(real);
      if (!st.isFile()) return null;
      return { file: real, size: st.size, mtime: st.mtime };
    } catch {
      return null;
    }
  }

  /**
   * Serve a GET/HEAD request. Returns false if nothing was served (caller sends 404).
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res
   * @param {string} urlPath
   */
  async serve(req, res, urlPath) {
    const target = resolveStaticPath(this.root, urlPath);
    if (target === null) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Bad request');
      return true;
    }
    let found = await this.#lookup(target);
    if (found === null && urlPath.endsWith('/')) found = await this.#lookup(path.join(target, 'index.html'));
    let isFallback = false;
    if (found === null) {
      // SPA fallback for client-side routes (no file extension in the last segment).
      const last = urlPath.split('/').pop() || '';
      if (last.includes('.')) return false;
      found = await this.#lookup(path.join(this.root, 'index.html'));
      isFallback = true;
      if (found === null) return false;
    }
    const ext = path.extname(found.file).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    const cache =
      ext === '.html' || isFallback
        ? 'no-cache'
        : isImmutableAsset(urlPath)
          ? 'public, max-age=31536000, immutable'
          : 'public, max-age=3600';
    const etag = `W/"${found.size.toString(16)}-${found.mtime.getTime().toString(16)}"`;
    /** @type {Record<string, string>} */
    const headers = {
      'Content-Type': type,
      'Cache-Control': cache,
      'Last-Modified': found.mtime.toUTCString(),
      ETag: etag,
      'X-Content-Type-Options': 'nosniff',
    };
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, headers);
      res.end();
      return true;
    }
    headers['Content-Length'] = String(found.size);
    res.writeHead(200, headers);
    if (req.method === 'HEAD') {
      res.end();
      return true;
    }
    const stream = createReadStream(found.file);
    stream.on('error', () => res.destroy());
    stream.pipe(res);
    return true;
  }
}
