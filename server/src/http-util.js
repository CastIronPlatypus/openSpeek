/** An error whose message is safe to show to API clients. */
export class HttpError extends Error {
  /**
   * @param {number} status
   * @param {string} message
   * @param {Record<string, string>} [headers]
   */
  constructor(status, message, headers) {
    super(message);
    this.status = status;
    this.headers = headers;
  }
}

/**
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {unknown} body
 * @param {Record<string, string>} [headers]
 */
export function sendJson(res, status, body, headers = {}) {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  const data = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    ...headers,
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': String(data.length),
    'Cache-Control': 'no-store',
  });
  res.end(data);
}

/**
 * @param {import('node:http').ServerResponse} res
 * @param {unknown} err
 */
export function sendError(res, err) {
  if (err instanceof HttpError) {
    sendJson(res, err.status, { error: err.message }, err.headers);
  } else {
    console.error('[openspeek] internal error:', err);
    sendJson(res, 500, { error: 'Internal server error' });
  }
}

/**
 * Read and parse a JSON request body with a size cap.
 * @param {import('node:http').IncomingMessage} req
 * @param {number} limit
 * @returns {Promise<unknown>}
 */
export function readJsonBody(req, limit) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > limit) {
      reject(new HttpError(413, 'Request body too large'));
      req.resume();
      return;
    }
    /** @type {Buffer[]} */
    const chunks = [];
    let size = 0;
    let done = false;
    req.on('data', (chunk) => {
      if (done) return;
      size += chunk.length;
      if (size > limit) {
        done = true;
        reject(new HttpError(413, 'Request body too large'));
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (done) return;
      done = true;
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text.trim()) {
        reject(new HttpError(400, 'Request body must be JSON'));
        return;
      }
      try {
        resolve(JSON.parse(text));
      } catch {
        reject(new HttpError(400, 'Request body is not valid JSON'));
      }
    });
    req.on('error', () => {
      if (done) return;
      done = true;
      reject(new HttpError(400, 'Could not read request body'));
    });
  });
}

/**
 * Run `fn` with a timeout; rejects with `message` when it expires.
 * @template T
 * @param {(signal: AbortSignal) => Promise<T>} fn
 * @param {number} ms
 * @param {string} message
 * @returns {Promise<T>}
 */
export async function withTimeout(fn, ms, message) {
  const ac = new AbortController();
  /** @type {NodeJS.Timeout | undefined} */
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      ac.abort(new Error(message));
      reject(new Error(message));
    }, ms);
  });
  try {
    return /** @type {T} */ (await Promise.race([fn(ac.signal), timeout]));
  } finally {
    clearTimeout(timer);
  }
}
