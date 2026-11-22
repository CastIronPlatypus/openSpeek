/**
 * Address classification for the page fetcher: only globally routable unicast addresses pass.
 */
import net from 'node:net';

/**
 * @param {string} ip dotted IPv4
 * @returns {number[] | null}
 */
function v4Bytes(ip) {
  if (!net.isIPv4(ip)) return null;
  return ip.split('.').map(Number);
}

/**
 * Expand an IPv6 address (no zone id) to 16 bytes.
 * @param {string} ip
 * @returns {number[] | null}
 */
export function v6Bytes(ip) {
  if (!net.isIPv6(ip) || ip.includes('%')) return null;
  let s = ip.toLowerCase();
  /** @type {number[]} */
  let tail = [];
  const lastColon = s.lastIndexOf(':');
  if (s.slice(lastColon + 1).includes('.')) {
    const v4 = v4Bytes(s.slice(lastColon + 1));
    if (!v4) return null;
    tail = v4;
    s = s.slice(0, lastColon + 1) + '0:0';
  }
  const [head, rest] = s.split('::');
  const hs = head ? head.split(':') : [];
  const rs = rest !== undefined ? (rest ? rest.split(':') : []) : null;
  const groups = rs === null ? hs : [...hs, ...Array(8 - hs.length - rs.length).fill('0'), ...rs];
  if (groups.length !== 8) return null;
  /** @type {number[]} */
  const bytes = [];
  for (const g of groups) {
    const n = parseInt(g, 16);
    bytes.push(n >> 8, n & 0xff);
  }
  if (tail.length) bytes.splice(12, 4, ...tail);
  return bytes;
}

/**
 * @param {number[]} bytes
 * @param {number[]} prefix
 * @param {number} bits
 */
function inPrefix(bytes, prefix, bits) {
  for (let i = 0; i < bits; i++) {
    const byte = i >> 3;
    const mask = 0x80 >> (i & 7);
    if ((bytes[byte] & mask) !== ((prefix[byte] ?? 0) & mask)) return false;
  }
  return true;
}

/** [prefix bytes, bits, reason] */
const V4_BLOCKED = /** @type {Array<[number[], number, string]>} */ ([
  [[0, 0, 0, 0], 8, 'unspecified/"this network"'],
  [[10, 0, 0, 0], 8, 'private'],
  [[100, 64, 0, 0], 10, 'carrier-grade NAT'],
  [[127, 0, 0, 0], 8, 'loopback'],
  [[169, 254, 0, 0], 16, 'link-local'],
  [[172, 16, 0, 0], 12, 'private'],
  [[192, 0, 0, 0], 24, 'IETF protocol assignments'],
  [[192, 0, 2, 0], 24, 'documentation'],
  [[192, 88, 99, 0], 24, '6to4 relay anycast'],
  [[192, 168, 0, 0], 16, 'private'],
  [[198, 18, 0, 0], 15, 'benchmarking'],
  [[198, 51, 100, 0], 24, 'documentation'],
  [[203, 0, 113, 0], 24, 'documentation'],
  [[224, 0, 0, 0], 4, 'multicast'],
  [[240, 0, 0, 0], 4, 'reserved/broadcast'],
]);

/**
 * Why an IPv4 address is not allowed, or null when it is public.
 * @param {number[]} b
 * @returns {string | null}
 */
function classifyV4(b) {
  for (const [prefix, bits, reason] of V4_BLOCKED) if (inPrefix(b, prefix, bits)) return reason;
  return null;
}

/**
 * Why an address may not be fetched, or `null` when it is a public unicast address.
 * IPv6 forms that embed an IPv4 address (mapped, compatible, NAT64, 6to4) are judged by it.
 * @param {string} ip
 * @returns {string | null}
 */
export function blockedReason(ip) {
  const a = ip.replace(/^\[|\]$/g, '');
  const b4 = v4Bytes(a);
  if (b4) return classifyV4(b4);
  const b = v6Bytes(a);
  if (!b) return 'not an IP address';
  const z = (/** @type {number} */ n) => b.slice(0, n).every((x) => x === 0);
  if (z(16)) return 'unspecified';
  if (z(15) && b[15] === 1) return 'loopback';
  // ::ffff:a.b.c.d (mapped) and ::ffff:0:a.b.c.d (translated)
  if (z(10) && b[10] === 0xff && b[11] === 0xff) return classifyV4(b.slice(12)) ?? null;
  if (z(8) && b[8] === 0xff && b[9] === 0xff && b[10] === 0 && b[11] === 0) return classifyV4(b.slice(12)) ?? null;
  if (z(12)) return 'IPv4-compatible (deprecated)';
  if (inPrefix(b, [0x00, 0x64, 0xff, 0x9b], 96)) return classifyV4(b.slice(12)); // NAT64 well-known
  if (inPrefix(b, [0x00, 0x64, 0xff, 0x9b, 0x00, 0x01], 48)) return 'local-use NAT64';
  if (inPrefix(b, [0x01, 0x00], 64)) return 'discard-only';
  if (inPrefix(b, [0x20, 0x01, 0x0d, 0xb8], 32)) return 'documentation';
  if (inPrefix(b, [0x20, 0x01, 0x00, 0x00], 23)) return 'IETF protocol assignments (incl. Teredo)';
  if (inPrefix(b, [0x20, 0x02], 16)) return classifyV4(b.slice(2, 6)) ? '6to4 of a non-public IPv4' : null;
  if (inPrefix(b, [0x3f, 0xff], 20)) return 'documentation';
  if (inPrefix(b, [0x5f, 0x00], 8)) return 'segment routing';
  if (inPrefix(b, [0xfc, 0x00], 7)) return 'unique local (private)';
  if (inPrefix(b, [0xfe, 0x80], 10)) return 'link-local';
  if (inPrefix(b, [0xfe, 0xc0], 10)) return 'site-local';
  if (inPrefix(b, [0xff, 0x00], 8)) return 'multicast';
  // Only the global unicast block 2000::/3 is routable on the internet.
  if (!inPrefix(b, [0x20, 0x00], 3)) return 'reserved';
  return null;
}

/** @param {string} ip */
export function isPublicAddress(ip) {
  return blockedReason(ip) === null;
}
