import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dateToString, silentMp3, sortVoices, toVoiceInfo } from '../src/edge/tts.js';

test('voice list entries map to the API shape', () => {
  const v = toVoiceInfo({
    ShortName: 'en-US-AriaNeural',
    Gender: 'Female',
    Locale: 'en-US',
    FriendlyName: 'Microsoft Aria Online (Natural) - English (United States)',
  });
  assert.deepEqual(v, { name: 'en-US-AriaNeural', gender: 'Female', locale: 'en-US', description: 'Aria (United States)' });
  assert.equal(toVoiceInfo({}), null);
});

test('English voices first, then locale and name', () => {
  const sorted = sortVoices([
    { name: 'fr-FR-DeniseNeural', locale: 'fr-FR' },
    { name: 'en-US-GuyNeural', locale: 'en-US' },
    { name: 'de-DE-KatjaNeural', locale: 'de-DE' },
    { name: 'en-GB-SoniaNeural', locale: 'en-GB' },
    { name: 'en-US-AriaNeural', locale: 'en-US' },
  ]).map((v) => v.name);
  assert.deepEqual(sorted, ['en-GB-SoniaNeural', 'en-US-AriaNeural', 'en-US-GuyNeural', 'de-DE-KatjaNeural', 'fr-FR-DeniseNeural']);
});

test('X-Timestamp date format', () => {
  assert.equal(dateToString(new Date(Date.UTC(2026, 10, 2, 3, 4, 5))), 'Mon Nov 02 2026 03:04:05 GMT+0000 (Coordinated Universal Time)');
});

test('silent MP3 is whole MPEG-2 Layer III 24 kHz 48 kbit/s mono frames', () => {
  const mp3 = silentMp3(3);
  assert.equal(mp3.length, 3 * 144);
  for (let i = 0; i < mp3.length; i += 144) assert.deepEqual([...mp3.subarray(i, i + 4)], [0xff, 0xf3, 0x64, 0xc4]);
});
