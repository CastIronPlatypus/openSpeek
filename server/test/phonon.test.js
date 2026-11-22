import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixWavHeader } from '../src/phonon.js';

/** @param {number} dataLen @param {number} declared */
function wav(dataLen, declared) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0, 'ascii');
  h.writeUInt32LE(0xffffffff, 4);
  h.write('WAVE', 8, 'ascii');
  h.write('fmt ', 12, 'ascii');
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(24000, 24);
  h.writeUInt32LE(48000, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36, 'ascii');
  h.writeUInt32LE(declared, 40);
  return Buffer.concat([h, Buffer.alloc(dataLen)]);
}

test('patches streamed WAV sizes', () => {
  const out = fixWavHeader(wav(100, 0xffffffff));
  assert.equal(out.readUInt32LE(4), out.length - 8);
  assert.equal(out.readUInt32LE(40), 100);
});

test('keeps correct WAV sizes', () => {
  const w = wav(10, 10);
  w.writeUInt32LE(w.length - 8, 4);
  assert.deepEqual(fixWavHeader(w), w);
});

test('rejects non-WAV', () => {
  assert.throws(() => fixWavHeader(Buffer.from('ID3 not a wav file at all')));
});
