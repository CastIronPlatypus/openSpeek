import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  pickContext,
  renderFeedbackFile,
  sanitizeLine,
  sanitizeMessage,
  serializeFrontMatter,
  validateFeedback,
} from '../src/feedback.js';
import { parseFrontMatter } from './helpers.js';

const HOSTILE = [
  'say "hi"',
  'back\\slash \\" \\n \\u0000',
  'line one\nline two\r\nline three\rfour',
  '---',
  'x\n---\ninjected: "yes"',
  'key: value',
  '# not a comment',
  '- list item',
  '!!js/function "function(){ return 1 }"',
  '&anchor *alias | > { } [ ] % @ `',
  'emoji 😀👩‍👩‍👧 and 𝔘𝔫𝔦𝔠𝔬𝔡𝔢',
  'sep\u2028arator\u2029para',
  'nul\u0000and\u0007bell\u001b[31m',
  'c1\u0085\u009b',
  '\uFEFFbom',
  'lone \uD83D surrogate \uDE00',
  'tab\there',
  "'single' quotes",
  '   padded   ',
  'x'.repeat(1000),
];

/** @param {string} s */
const roundTrip = (s) => parseFrontMatter(serializeFrontMatter([['v', s]]) + '\nbody\n').data.v;

test('sanitizeLine: no control, separator or line-break characters survive', () => {
  for (const s of HOSTILE) {
    const out = sanitizeLine(s);
    assert.ok(!/[\u0000-\u001F\u007F-\u009F\u2028\u2029\uFEFF]/.test(out), JSON.stringify(out));
    assert.ok(out === out.trim());
    assert.ok([...out].length <= 200);
  }
  assert.equal(sanitizeLine('line one\nline two\r\n\tthree'), 'line one line two three');
  assert.equal(sanitizeLine('nul\u0000and\u0007bell'), 'nulandbell');
  assert.equal(sanitizeLine('\uFEFFbom'), 'bom');
  assert.equal(sanitizeLine('sep\u2028x'), 'sep x');
  assert.equal(sanitizeLine('lone \uD83D surrogate \uDE00 end'), 'lone surrogate end');
  // Truncation counts code points and never splits a surrogate pair.
  assert.equal(sanitizeLine('😀'.repeat(300)), '😀'.repeat(200));
  assert.equal(sanitizeLine('abc', 2), 'ab');
});

test('serializer: hostile strings round-trip to exactly the sanitised value', () => {
  for (const s of HOSTILE) {
    const fm = serializeFrontMatter([['v', s]]);
    const lines = fm.split('\n');
    assert.equal(lines.length, 4, `one line per key: ${JSON.stringify(fm)}`);
    assert.equal(lines[0], '---');
    assert.equal(lines[2], '---');
    assert.match(lines[1], /^v: ".*"$/);
    assert.equal(roundTrip(s), sanitizeLine(s));
  }
  assert.equal(roundTrip('say "hi" \\ there'), 'say "hi" \\ there');
  assert.equal(roundTrip('!!js/function "f"'), '!!js/function "f"');
  assert.equal(roundTrip('emoji 😀👩‍👩‍👧 and 𝔘𝔫𝔦𝔠𝔬𝔡𝔢'), 'emoji 😀👩‍👩‍👧 and 𝔘𝔫𝔦𝔠𝔬𝔡𝔢');
});

test('serializer: types, empty values and key order', () => {
  const fm = serializeFrontMatter([
    ['a', 'x'],
    ['b', true],
    ['c', false],
    ['d', 42],
    ['e', -1.5],
    ['nan', NaN],
    ['inf', Infinity],
    ['ninf', -Infinity],
    ['nul', null],
    ['undef', undefined],
    ['obj', { toString: () => 'evil' }],
    ['arr', ['x']],
    ['big', 10n],
    ['fn', () => 1],
    ['empty', ''],
    ['blank', ' \n\t\u0000 '],
    ['z', 'last'],
  ]);
  const { data } = parseFrontMatter(fm + '\n');
  assert.deepEqual(Object.keys(data), ['a', 'b', 'c', 'd', 'e', 'z']);
  assert.deepEqual({ ...data }, { a: 'x', b: true, c: false, d: 42, e: -1.5, z: 'last' });
  assert.match(fm, /^b: true$/m);
  assert.throws(() => serializeFrontMatter([['bad key', 'x']]), /invalid/);
  assert.throws(() => serializeFrontMatter([['x\ny', 'x']]), /invalid/);
});

test('pickContext: allow-list, own keys, types, snake_case, fixed order', () => {
  const ctx = JSON.parse(`{
    "__proto__": { "route": "polluted" },
    "constructor": { "prototype": { "x": 1 } },
    "sourceKind": "pdf",
    "standalone": "true",
    "appVersion": 2,
    "route": "reader",
    "engine": ["phonon"],
    "voice": null,
    "theme": { "a": 1 },
    "viewport": "390x844"
  }`);
  assert.deepEqual(pickContext(ctx), [
    ['route', 'reader'],
    ['viewport', '390x844'],
    ['app_version', '2'],
    ['source_kind', 'pdf'],
  ]);
  assert.deepEqual(pickContext({ standalone: true, appVersion: Infinity, engine: 1e400 }), [['standalone', true]]);
  assert.deepEqual(pickContext(Object.create({ route: 'inherited' })), []);
  assert.deepEqual(pickContext(['route']), []);
  assert.deepEqual(pickContext('route'), []);
  assert.deepEqual(pickContext(null), []);
  assert.equal(/** @type {any} */ ({}).route, undefined, 'no prototype pollution');
});

test('sanitizeMessage keeps the text and normalises the edges', () => {
  assert.equal(sanitizeMessage('\n\n  \r\n  indented\r\nnext\rline\t tab\n\n \n'), '  indented\nnext\nline\t tab');
  assert.equal(sanitizeMessage('a\u0000b\u0007c\u001bd\u007fe\u0085f'), 'abcde\nf');
  assert.equal(sanitizeMessage('\uFEFFhi\u2028there'), 'hi\nthere');
  assert.equal(sanitizeMessage('**bold** `code` <b>html</b> "quotes" \\ 😀'), '**bold** `code` <b>html</b> "quotes" \\ 😀');
});

test('rendered file: front matter is the first block only, body is exact', () => {
  const message = sanitizeMessage('---\ninjected: "yes"\n---\n\nreal text\n---\n');
  const file = renderFeedbackFile({
    id: '20261122-153012-a1b2c3',
    date: new Date('2026-11-22T15:30:12.000Z'),
    category: 'bug',
    contact: 'me@example.com\nevil: 1',
    context: pickContext({ route: 'reader\n---', standalone: false, voice: 'x'.repeat(500) }),
    userAgent: 'UA "quoted"\r\nX-Injected: 1' + 'y'.repeat(400),
    message,
  });
  const { data, body } = parseFrontMatter(file);
  assert.deepEqual(Object.keys(data), ['id', 'date', 'category', 'contact', 'route', 'voice', 'standalone', 'user_agent']);
  assert.equal(data.contact, 'me@example.com evil: 1');
  assert.equal(data.route, 'reader ---');
  assert.equal(data.voice, 'x'.repeat(200));
  assert.equal([.../** @type {string} */ (data.user_agent)].length, 300);
  assert.ok(!('injected' in data));
  assert.equal(body, '---\ninjected: "yes"\n---\n\nreal text\n---\n');
  assert.ok(file.endsWith('---\n') && !file.endsWith('\n\n'));
});

test('validateFeedback', () => {
  const ok = validateFeedback({ message: ' hi ', context: { route: 'x', bogus: 1 } });
  assert.deepEqual(ok, { message: ' hi', category: 'other', contact: undefined, context: [['route', 'x']] });
  assert.equal(validateFeedback({ message: '😀'.repeat(5000), category: 'idea' }).category, 'idea');
  assert.equal(validateFeedback({ message: 'x', contact: null, category: null }).category, 'other');
  for (const [body, re] of /** @type {Array<[unknown, RegExp]>} */ ([
    [null, /object/],
    [[], /object/],
    ['str', /object/],
    [{}, /message/],
    [{ message: '' }, /message/],
    [{ message: ' \n\t ' }, /message/],
    [{ message: '\u0000\u0007' }, /message/],
    [{ message: 5 }, /message/],
    [{ message: 'x'.repeat(5001) }, /5000/],
    [{ message: 'x', category: 'spam' }, /category/],
    [{ message: 'x', category: 1 }, /category/],
    [{ message: 'x', contact: 1 }, /contact/],
    [{ message: 'x', contact: 'c'.repeat(201) }, /200/],
  ])) {
    assert.throws(() => validateFeedback(body), (err) => /** @type {any} */ (err).status === 400 && re.test(/** @type {Error} */ (err).message));
  }
});
