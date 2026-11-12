import test from 'node:test';
import assert from 'node:assert/strict';
import { parseJson3, cueIndexAt } from '../src/shared/cues.js';

const englishAsr = { language: 'en', kind: 'asr', preTranslation: true };
const event = (values, start = 1000, duration = 2000) => ({
  tStartMs: start,
  dDurationMs: duration,
  segs: values.map((utf8, index) => ({ utf8, tOffsetMs: index * 100 })),
});
const parse = (values, options = englishAsr) => parseJson3({ events: [event(values)] }, options);

for (const [name, values] of [
  ['leading word spaces', ['what', ' you', ' can']],
  ['trailing word spaces', ['what ', 'you', ' can']],
  ['an independent ASCII separator', ['what', ' ', 'you', ' can']],
  ['an independent mixed whitespace separator', ['what', ' \t\n', 'you', ' can']],
  ['an embedded zero-width separator', ['what\u200byou', ' can']],
  ['a trailing zero-width separator', ['what\u200b', 'you', ' can']],
  ['an independent zero-width separator', ['what', '\u200b', 'you', ' can']],
]) {
  test(`English ASR preserves ${name} between words`, () => {
    const cues = parse(values);
    assert.deepEqual(cues, [{ start: 1, end: 3, text: 'what you can' }]);
    assert.equal(cueIndexAt(cues, 1), 0);
    assert.equal(cueIndexAt(cues, 2.999), 0);
    assert.equal(cueIndexAt(cues, 3), -1, 'Whitespace normalization must preserve half-open cue boundaries');
  });
}

test('a separator at the end of one event survives into the next spoken event', () => {
  const cues = parseJson3({ events: [
    event(['what', '\u200b'], 1000, 500),
    event(['you', ' can'], 1500, 1500),
  ] }, englishAsr);
  assert.deepEqual(cues, [{ start: 1, end: 3, text: 'what you can' }]);
});

test('zero-width separation is normalized before uppercase fragments are merged', () => {
  assert.deepEqual(parse(['HEL', 'LO', '\u200b', 'WORLD']), [{ start: 1, end: 3, text: 'hello world' }]);
});

test('explicit spaces have the same readable result with pre-translation disabled', () => {
  assert.deepEqual(parse(['what', '\u200b', 'you', ' can'], { ...englishAsr, preTranslation: false }), [
    { start: 1, end: 3, text: 'what you can' },
  ]);
});

test('word fragments without separators remain joined instead of receiving invented spaces', () => {
  assert.equal(parse(['HEL', 'LO', ' WORLD'])[0].text, 'hello world');
  assert.equal(parse(['inter', 'national', ' space'])[0].text, 'international space');
});

test('apostrophes, decimal fragments and punctuation retain their adjacent characters', () => {
  assert.equal(parse(['I', "'m", ' ready', ',', ' are', ' you', '?'])[0].text, "i'm ready, are you?");
  assert.equal(parse(['Value', ':', ' 3', '.', '14', ' is', ' exact', '.'])[0].text, 'value: 3.14 is exact.');
});

test('normal Chinese subtitle fragments do not receive English word separators', () => {
  const cues = parse(['你', '好', '，', '世', '界'], { language: 'zh-CN', kind: 'asr' });
  assert.deepEqual(cues, [{ start: 1, end: 3, text: '你好，世界' }]);
});
