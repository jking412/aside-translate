import test from 'node:test';
import assert from 'node:assert/strict';
import { splitText, shouldTranslate, isInlineTranslation } from '../src/content/page.js';
test('split preserves all text and Unicode code points within provider limits', () => {
  const text = 'A😀句 '.repeat(1500);
  const parts = splitText(text);
  assert.equal(parts.join(''), text);
  assert.ok(parts.every(p => p.length <= 1800 && !/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/.test(p)));
});
test('skip Chinese, numbers and URLs while translating mixed and foreign prose', () => {
  for (const text of ['你好，世界！', '12345', 'https://example.com', '   ']) assert.equal(shouldTranslate(text), false, text);
  for (const text of ['Hello world', '你好 world', 'こんにちは', 'Bonjour']) assert.equal(shouldTranslate(text), true, text);
});

test('short labels stay inline while sentences get a separate bilingual line', () => {
  assert.equal(isInlineTranslation('Good morning everyone'), true);
  assert.equal(isInlineTranslation('Read the complete documentation before you start.'), false);
  assert.equal(isInlineTranslation('One\nTwo'), false);
  assert.equal(isInlineTranslation('A long flexible toolbar label with several words', 'inline-flex'), true);
});

test('long paragraph splitting preserves separators without cutting through a word when space permits', () => {
  const text = 'A complete sentence with contextual words. '.repeat(120);
  const chunks = splitText(text, 100);
  assert.equal(chunks.join(''), text);
  assert.ok(chunks.every(chunk => chunk.length <= 100));
  assert.ok(chunks.slice(0, -1).every(chunk => /\s$/.test(chunk)));
});
