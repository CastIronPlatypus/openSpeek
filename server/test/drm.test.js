import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gecTicks, secMsGec, generateMuid, adjustClockSkew, now, resetClockSkew } from '../src/edge/drm.js';

// Vectors produced by the reference implementation, rany2/edge-tts 7.3.1:
//   from edge_tts.drm import generate_sec_ms_gec_v2; generate_sec_ms_gec_v2(t)
const VECTORS = [
  [0, '52BC7A17B50DFEC9-28C4394775C8751CD2F6859C030C06DB1489ACAB3B3A7651831FC26895177ED6'],
  [1700000000, '2CD23A2CA0B2595A-F3C846C370E05F9CC83ACC5F995C5F5D87A4D0F14CE8936A0F902E64099E38A2'],
  [1700000299.9, '0919602B5750900A-EC9DD394F23CB5635CF62A0E8E24136DCD32B26D10C543B10082E482D7516397'],
  [1767225600, '723A6EBC411B23BB-214991EA6B1E401F3D777A699DDDEE75E29740EA7A5DCD1007366FA1090DD267'],
  [1795000000.5, '6521DCC55F99AAD7-6D04852628E3DF4D0EF33213239BDC3C48750FE37FE5E4591F28C209CE0A3FA2'],
];

test('Sec-MS-GEC matches the reference implementation', () => {
  for (const [t, expected] of VECTORS) assert.equal(secMsGec(/** @type {number} */ (t)), expected, `t=${t}`);
});

test('ticks are Windows file time rounded down to 5 minutes', () => {
  assert.equal(gecTicks(0), '116444736000000000');
  assert.equal(gecTicks(1700000000), gecTicks(1700000099)); // same window: 1700000000 % 300 = 200
  assert.notEqual(gecTicks(1700000099), gecTicks(1700000100));
  assert.equal(BigInt(gecTicks(1767225600)) % 3_000_000_000n, 0n);
});

test('token is stable within a window and changes across windows', () => {
  assert.equal(secMsGec(1700000100), secMsGec(1700000399));
  assert.notEqual(secMsGec(1700000399), secMsGec(1700000400));
  assert.match(secMsGec(1700000000), /^[0-9A-F]{16}-[0-9A-F]{64}$/);
});

test('clock skew adjusts from a server Date header', () => {
  resetClockSkew();
  const future = new Date(Date.now() + 3600_000).toUTCString();
  assert.equal(adjustClockSkew(future), true);
  assert.ok(Math.abs(now() - (Date.now() / 1000 + 3600)) < 2);
  assert.equal(adjustClockSkew('not a date'), false);
  assert.equal(adjustClockSkew(undefined), false);
  resetClockSkew();
});

test('MUID is 32 uppercase hex chars', () => {
  assert.match(generateMuid(), /^[0-9A-F]{32}$/);
});
