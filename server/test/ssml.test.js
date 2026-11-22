import assert from 'node:assert/strict';
import { test } from 'node:test';
import { escapeXml, makeSsml, removeIncompatibleCharacters, splitForService, unescapeXml } from '../src/edge/ssml.js';

test('escapes XML special characters', () => {
  assert.equal(escapeXml('a < b && c > d'), 'a &lt; b &amp;&amp; c &gt; d');
  assert.equal(unescapeXml('a &lt; b &amp;amp; &quot;q&quot; &apos;'), 'a < b &amp; "q" \'');
});

test('SSML contains escaped text and voice, and no raw markup from input', () => {
  const ssml = makeSsml('en-US-AriaNeural', '<break time="5s"/> Tom & Jerry');
  assert.ok(ssml.includes("<voice name='en-US-AriaNeural'>"));
  assert.ok(ssml.includes('&lt;break time="5s"/&gt; Tom &amp; Jerry'));
  assert.ok(!ssml.includes('<break'));
  assert.ok(ssml.startsWith("<speak version='1.0'"));
  assert.ok(ssml.endsWith('</prosody></voice></speak>'));
});

test('voice attribute is escaped', () => {
  const ssml = makeSsml("x' onload='y", 'hi');
  assert.ok(ssml.includes("<voice name='x&apos; onload=&apos;y'>"));
});

test('removes characters the service rejects, preserving length', () => {
  const input = 'a\u000bb\u0000c\u001fd\te\nf\rg';
  const out = removeIncompatibleCharacters(input);
  assert.equal(out, 'a b c d\te\nf\rg');
  assert.equal(out.length, input.length);
  assert.equal(removeIncompatibleCharacters('x\uD800y'), 'x y'); // lone surrogate
  assert.equal(removeIncompatibleCharacters('😀'), '😀');
});

test('splits long text under the byte budget with correct offsets', () => {
  const text = Array.from({ length: 400 }, (_, i) => `word${i} &`).join(' ');
  const pieces = splitForService(text, 500);
  assert.ok(pieces.length > 1);
  for (const p of pieces) {
    assert.ok(Buffer.byteLength(escapeXml(p.text)) <= 500);
    assert.equal(text.slice(p.offset, p.offset + p.text.length), p.text);
  }
  assert.deepEqual(splitForService('short'), [{ text: 'short', offset: 0 }]);
});
