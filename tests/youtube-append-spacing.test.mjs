import test from 'node:test';
import assert from 'node:assert/strict';
import { parseJson3, cueIndexAt } from '../src/shared/cues.js';

const englishAsr = { language: 'en', kind: 'asr', preTranslation: true };
const spoken = (text, start, duration = 1500) => ({ tStartMs: start, dDurationMs: duration, segs: [{ utf8: text, tOffsetMs: 0 }] });
const append = (segs) => ({ tStartMs: 1490, dDurationMs: 1510, aAppend: 1, segs });
const between = (left, right, segs) => [spoken(left, 1000, 500), append(segs), spoken(right, 1500)];
const parse = events => parseJson3({ events }, englishAsr);

test('a real JSON3 append newline survives ASR regrouping', () => {
  // Two-word excerpt of original wire events 1–3 from this public capture:
  // https://github.com/thisis-romar/mcp-youtube-transcript-pro/blob/main/test-output.en.json3
  // Source UTF-8 SHA256: 424275155f47c8c82e7aa4c29a236f6b8dd3f44e42b8dabec0a454d800401637
  // Only the last/first word is retained; this is not the user's video.
  const events = [
    { tStartMs: 80, dDurationMs: 3440, wWinId: 1, segs: [{ utf8: ' vs', tOffsetMs: 1440, acAsrConf: 0 }] },
    { tStartMs: 1870, dDurationMs: 1650, wWinId: 1, aAppend: 1, segs: [{ utf8: '\n' }] },
    { tStartMs: 1880, dDurationMs: 3520, wWinId: 1, segs: [{ utf8: 'code', acAsrConf: 0 }] },
  ];
  assert.deepEqual(parse(events), [{ start: 1.52, end: 5.4, text: ' vs code' }]);
});

test('all supported append separators retain the word boundary', () => {
  for (const utf8 of ['\n', '\r\n', ' ', '\t', '\u200b', ' \t\n\u200b']) {
    const cues = parse(between('is', 'that', [{ utf8 }]));
    assert.deepEqual(cues, [{ start: 1, end: 3, text: 'is that' }], JSON.stringify(utf8));
    assert.equal(cueIndexAt(cues, 2.999), 0);
    assert.equal(cueIndexAt(cues, 3), -1);
  }
});

test('the reported word pairs stay separated across append newlines', () => {
  // Controlled cases using the pairs visible in the supplied screenshot.
  for (const [left, right] of [['is', 'that'], ['is', 'figuring'], ['even', 'improve'], ['while', 'massively']]) {
    assert.equal(parse(between(left, right, [{ utf8: '\n' }]))[0].text, left + ' ' + right);
  }
});

test('append separators are honored before uppercase fragments are merged', () => {
  const first = spoken('HEL', 1000, 500);
  first.segs.push({ utf8: 'LO', tOffsetMs: 100 });
  assert.equal(parse([first, append([{ utf8: '\n' }]), spoken('WORLD', 1500)])[0].text, 'hello world');
});

test('empty or spoken append events do not invent a separator or duplicate speech', () => {
  for (const segs of [[], [{}], [{ utf8: '' }], [{ utf8: '\n' }, { utf8: 'ignored speech' }], [{ utf8: '\u200d' }], [{ utf8: '\u200c' }]]) {
    assert.equal(parse(between('inter', 'national', segs))[0].text, 'international');
  }
  assert.equal(parse(between('is', 'that', [{ utf8: '' }, { utf8: '\n' }, {}]))[0].text, 'is that');
});

test('cross-event fragments remain adjacent without an explicit separator', () => {
  assert.equal(parse([spoken('inter', 1000, 500), spoken('national', 1500)])[0].text, 'international');
  assert.equal(parse([spoken('I', 1000, 500), spoken("'m", 1500)])[0].text, "i'm");
  assert.equal(parse([spoken('3', 1000, 500), spoken('.', 1500, 500), spoken('14', 2000)])[0].text, '3.14');
});

test('append-only separators add no cues and do not duplicate existing spaces', () => {
  assert.deepEqual(parse([append([{ utf8: '\n' }])]), []);
  assert.equal(parse(between('is ', ' that', [{ utf8: '\n' }]))[0].text, 'is that');
  assert.deepEqual(parseJson3({ events: between('is', 'that', [{ utf8: '\n' }]) }, { ...englishAsr, preTranslation: false }), [
    { start: 1, end: 1.5, text: 'is' }, { start: 1.5, end: 3, text: 'that' },
  ]);
});
