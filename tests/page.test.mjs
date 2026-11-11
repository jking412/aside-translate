import test from 'node:test';
import assert from 'node:assert/strict';
import { splitText, shouldTranslate } from '../src/content/page.js';
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
