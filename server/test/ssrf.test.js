import assert from 'node:assert/strict';
import { test } from 'node:test';
import { blockedReason, isPublicAddress, v6Bytes } from '../src/fetch/ssrf.js';
import { detectCharset, decodeBody, resolvePublicAddress, validateUrl } from '../src/fetch/fetcher.js';
import { HttpError } from '../src/http-util.js';

const BLOCKED = [
  '127.0.0.1', '127.255.255.254', '0.0.0.0', '0.1.2.3', '10.0.0.1', '10.255.255.255', '172.16.0.1', '172.31.255.255',
  '192.168.1.1', '169.254.169.254', '100.64.0.1', '100.127.255.255', '224.0.0.1', '239.255.255.250', '255.255.255.255',
  '240.0.0.1', '192.0.0.8', '192.0.2.1', '198.18.0.1', '198.51.100.7', '203.0.113.9',
  '::', '::1', 'fe80::1', 'febf::1', 'fc00::1', 'fd12:3456::1', 'ff02::1', 'fec0::1',
  '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:10.1.2.3', '::ffff:169.254.169.254', '0:0:0:0:0:ffff:192.168.0.1',
  '::ffff:0:10.0.0.1', '::127.0.0.1', '64:ff9b::a9fe:a9fe', '64:ff9b::10.0.0.1', '2002:7f00:1::1', '2002:c0a8:101::',
  '2001:db8::1', '2001::1', '100::1', '64:ff9b:1::1',
];
const ALLOWED = [
  '8.8.8.8', '1.1.1.1', '93.184.216.34', '172.15.255.255', '172.32.0.1', '100.63.255.255', '100.128.0.1', '192.169.0.1',
  '2606:4700:4700::1111', '2001:4860:4860::8888', '::ffff:8.8.8.8', '64:ff9b::808:808', '2002:808:808::1',
];

test('blocks loopback, private, link-local, CGNAT, multicast, reserved (v4 and v6)', () => {
  for (const ip of BLOCKED) assert.notEqual(blockedReason(ip), null, `${ip} should be blocked`);
});

test('allows public unicast addresses', () => {
  for (const ip of ALLOWED) assert.equal(blockedReason(ip), null, `${ip} should be allowed`);
});

test('non-addresses and zone ids are rejected', () => {
  assert.equal(isPublicAddress('example.com'), false);
  assert.equal(isPublicAddress('fe80::1%eth0'), false);
  assert.equal(isPublicAddress(''), false);
});

test('IPv6 expansion', () => {
  assert.deepEqual(v6Bytes('::1'), [...Array(15).fill(0), 1]);
  assert.deepEqual(v6Bytes('::ffff:1.2.3.4')?.slice(10), [0xff, 0xff, 1, 2, 3, 4]);
  assert.deepEqual(v6Bytes('2001:db8::')?.slice(0, 4), [0x20, 0x01, 0x0d, 0xb8]);
});

test('URL validation', () => {
  assert.equal(validateUrl('https://example.com/a?b=1').hostname, 'example.com');
  assert.equal(validateUrl('http://example.com:80/').port, '');
  /** @param {string} u @param {RegExp} re */
  const bad = (u, re) => assert.throws(() => validateUrl(u), (e) => e instanceof HttpError && e.status === 400 && re.test(e.message));
  bad('ftp://example.com/', /http/);
  bad('file:///etc/passwd', /http/);
  bad('javascript:alert(1)', /http/);
  bad('http://user:pass@example.com/', /credentials/);
  bad('http://example.com:22/', /port/);
  bad('https://example.com:8443/', /port/);
  bad('not a url', /Invalid/);
  // Relative redirect targets resolve against the current URL.
  assert.equal(validateUrl('/next', new URL('https://example.com/a')).href, 'https://example.com/next');
});

test('host resolution refuses any private answer and numeric tricks', async () => {
  /** @param {string[]} addrs */
  const lookup = (addrs) => async () => addrs.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
  const refuse = async (/** @type {string} */ u, /** @type {string[]} */ addrs = []) =>
    assert.rejects(resolvePublicAddress(validateUrl(u), lookup(addrs)), (e) => e instanceof HttpError && e.status === 403);
  await refuse('http://127.0.0.1/');
  await refuse('http://localhost/');
  await refuse('http://foo.localhost/');
  await refuse('http://[::1]/');
  await refuse('http://[::ffff:127.0.0.1]/');
  await refuse('http://2130706433/'); // WHATWG URL normalises to 127.0.0.1
  await refuse('http://0x7f.1/');
  await refuse('http://169.254.169.254/latest/meta-data/');
  await refuse('http://rebind.example/', ['93.184.216.34', '10.0.0.1']); // mixed answers
  await refuse('http://internal.example/', ['192.168.0.10']);
  assert.equal(await resolvePublicAddress(validateUrl('http://ok.example/'), lookup(['93.184.216.34'])), '93.184.216.34');
  assert.equal(await resolvePublicAddress(validateUrl('http://8.8.8.8/'), lookup([])), '8.8.8.8');
});

test('charset detection and decoding', () => {
  assert.equal(detectCharset('text/html; charset=ISO-8859-1', Buffer.from('')), 'ISO-8859-1');
  assert.equal(detectCharset('text/html', Buffer.from('<html><head><meta charset="windows-1252">')), 'windows-1252');
  assert.equal(
    detectCharset('text/html', Buffer.from('<meta http-equiv="Content-Type" content="text/html; charset=shift_jis">')),
    'shift_jis',
  );
  assert.equal(detectCharset(undefined, Buffer.from('<p>hi</p>')), 'utf-8');
  assert.equal(decodeBody(Buffer.from([0x63, 0x61, 0x66, 0xe9]), 'windows-1252'), 'café');
  assert.equal(decodeBody(Buffer.from('ok'), 'no-such-charset'), 'ok');
});
