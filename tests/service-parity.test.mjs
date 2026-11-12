import test from 'node:test';
import assert from 'node:assert/strict';
import { requestTranslation, createTranslator } from '../src/shared/translate.js';

test('Microsoft public translation follows original default protocol without a key', async () => {
  let request;
  const result = await requestTranslation('A complete sentence.', { service: 'bing' }, {
    fetchImpl: async (url, options) => {
      request = { url: new URL(url), options };
      return { ok: true, headers: new Headers(), json: async () => [{ translations: [{ text: '一个完整的句子。', to: 'zh-Hans' }] }] };
    },
  });
  assert.equal(result, '一个完整的句子。');
  assert.equal(request.url.href, 'https://edge.microsoft.com/translate/translatetext?to=zh-Hans&isEnterpriseClient=false');
  assert.equal(request.options.method, 'POST');
  assert.deepEqual(JSON.parse(request.options.body), ['A complete sentence.']);
  assert.equal(request.options.headers.Authorization, undefined);
  assert.equal(request.options.credentials, 'omit');
});

test('paragraph markup has explicit provider mode and a separate cache entry', async () => {
  const calls = [];
  const translator = createTranslator({ fetchImpl: async (url, init) => {
    calls.push(new URL(url).searchParams.get('textType'));
    return { ok: true, headers: new Headers(), json: async () => [{ translations: [{ text: JSON.parse(init.body)[0] }] }] };
  } });
  await translator.translate('<i1>Marked source.</i1>', { service: 'bing' }, { format: 'html' });
  await translator.translate('<i1>Marked source.</i1>', { service: 'bing' }, { format: 'text' });
  await translator.translate('<i1>Marked source.</i1>', { service: 'bing' }, { format: 'html' });
  assert.deepEqual(calls, ['html', null]);
});

test('DeepSeek preset disables thinking for timely translation while custom APIs keep their protocol', async () => {
  const bodies = [];
  const options = { fetchImpl: async (_url, init) => {
    bodies.push(JSON.parse(init.body));
    return { ok: true, headers: new Headers(), json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: '你好。' } }] }) };
  } };
  const config = { service: 'openai', endpoint: 'https://api.deepseek.com/chat/completions', apiKey: 'fixture-only', model: 'deepseek-flash' };
  await requestTranslation('Hello.', { ...config, preset: 'deepseek' }, options);
  await requestTranslation('Hello.', { ...config, preset: 'custom' }, options);
  assert.deepEqual(bodies[0].thinking, { type: 'disabled' });
  assert.equal(bodies[1].thinking, undefined);
  await assert.rejects(requestTranslation('Hello.', { ...config, preset: 'deepseek', apiKey: '' }, options), /需要 API 密钥/);
});
