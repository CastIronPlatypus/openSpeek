import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RateLimiter, Semaphore } from '../src/limits.js';

test('rate limiter refills over time', () => {
  const rl = new RateLimiter(60); // 1 per second, burst 60
  const t = 1_000_000;
  for (let i = 0; i < 60; i++) rl.take('a', t);
  assert.throws(() => rl.take('a', t), /Too many/);
  rl.take('b', t); // other keys unaffected
  rl.take('a', t + 1000);
  rl.close();
});

test('semaphore limits concurrency', async () => {
  const s = new Semaphore(2);
  let active = 0;
  let peak = 0;
  await Promise.all(
    Array.from({ length: 6 }, () =>
      s.run(async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
      }),
    ),
  );
  assert.equal(peak, 2);
});
