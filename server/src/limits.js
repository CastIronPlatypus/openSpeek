import { HttpError } from './http-util.js';

/** A counting semaphore with a bounded wait queue. */
export class Semaphore {
  /**
   * @param {number} max       Concurrent holders.
   * @param {number} [maxQueue] Waiters beyond this are rejected with 503.
   */
  constructor(max, maxQueue = 100) {
    this.max = max;
    this.maxQueue = maxQueue;
    this.active = 0;
    /** @type {Array<() => void>} */
    this.queue = [];
  }

  /** @returns {Promise<() => void>} release function */
  async acquire() {
    if (this.active < this.max) {
      this.active++;
      return this.#releaser();
    }
    if (this.queue.length >= this.maxQueue) {
      throw new HttpError(503, 'Server is busy, try again shortly', { 'Retry-After': '5' });
    }
    await new Promise((resolve) => this.queue.push(() => resolve(undefined)));
    return this.#releaser();
  }

  /**
   * @template T
   * @param {() => Promise<T>} fn
   * @returns {Promise<T>}
   */
  async run(fn) {
    const release = await this.acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }

  #releaser() {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.queue.shift();
      if (next) next(); // hand the slot over directly
      else this.active--;
    };
  }
}

/** Fixed-window-ish token bucket per key (client IP). */
export class RateLimiter {
  /**
   * @param {number} perMinute  0 disables limiting.
   * @param {number} [burst]    Bucket size; defaults to `perMinute`.
   */
  constructor(perMinute, burst) {
    this.perMinute = perMinute;
    this.capacity = burst ?? perMinute;
    /** @type {Map<string, { tokens: number, at: number }>} */
    this.buckets = new Map();
    this.sweeper = setInterval(() => this.sweep(), 60_000);
    this.sweeper.unref();
  }

  /**
   * Take one token for `key`; throws a 429 HttpError when empty.
   * @param {string} key
   * @param {number} [now]
   */
  take(key, now = Date.now()) {
    if (this.perMinute <= 0) return;
    const rate = this.perMinute / 60_000;
    let b = this.buckets.get(key);
    if (!b) {
      b = { tokens: this.capacity, at: now };
      this.buckets.set(key, b);
    }
    b.tokens = Math.min(this.capacity, b.tokens + (now - b.at) * rate);
    b.at = now;
    if (b.tokens < 1) {
      const wait = Math.ceil((1 - b.tokens) / rate / 1000);
      throw new HttpError(429, 'Too many requests, slow down', { 'Retry-After': String(wait) });
    }
    b.tokens -= 1;
  }

  sweep(now = Date.now()) {
    for (const [key, b] of this.buckets) {
      if (now - b.at > 10 * 60_000) this.buckets.delete(key);
    }
  }

  close() {
    clearInterval(this.sweeper);
  }
}
