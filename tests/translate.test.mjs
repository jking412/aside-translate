import test from 'node:test';
import assert from 'node:assert/strict';
import { createTranslator, endpointPermission, MAX_TEXT_LENGTH, requestTranslation, TRANSLATION_INSTRUCTION, validateEndpoint, validateServiceSettings } from '../src/shared/translate.js';
import { DEFAULT_SETTINGS, loadSettings, normalizeSettings, saveSettings } from '../src/shared/settings.js';

const google = { service: 'google' };
const json = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, headers: new Headers(), json: async () => data });

test('Google uses fixed Chinese target, omits credentials and joins translated segments', async () => {
  let request;
  const result = await requestTranslation('Hello world.', google, { fetchImpl: async (url, options) => {
    request = { url: new URL(url), options };
    return json([[['你好', 'Hello'], ['世界。', ' world.']], null, 'en']);
  }});
  assert.equal(result, '你好世界。');
  assert.equal(request.url.origin, 'https://translate.googleapis.com');
  assert.equal(request.url.searchParams.get('tl'), 'zh-CN');
  assert.equal(request.url.searchParams.get('q'), 'Hello world.');
  assert.equal(request.options.credentials, 'omit');
  assert.equal(request.options.referrerPolicy, 'no-referrer');
});

test('LibreTranslate sends key in JSON body and accepts a translatedText response', async () => {
  let request;
  const result = await requestTranslation('Hello', { service: 'libre', endpoint: 'https://translate.example/translate', apiKey: 'test-key' }, { fetchImpl: async (url, options) => {
    request = { url, options };
    return json({ translatedText: '你好' });
  }});
  assert.equal(result, '你好');
  assert.equal(request.url, 'https://translate.example/translate');
  assert.deepEqual(JSON.parse(request.options.body), { q: 'Hello', source: 'auto', target: 'zh', format: 'text', api_key: 'test-key' });
  assert.equal(request.options.method, 'POST');
});

test('endpoint validation blocks credential/query/hash/plain remote HTTP and supports local development', () => {
  for (const endpoint of ['', 'garbage', 'http://remote.example/translate', 'https://user:pass@example.com/translate', 'https://example.com/translate?api_key=secret', 'https://example.com/#secret', 'file:///tmp/translate', 'javascript:alert(1)']) {
    assert.throws(() => validateEndpoint(endpoint));
  }
  assert.equal(validateEndpoint('http://localhost:5000/translate'), 'http://localhost:5000/translate');
  assert.equal(validateEndpoint('http://127.0.0.1:5000/translate'), 'http://127.0.0.1:5000/translate');
  assert.equal(endpointPermission('https://example.com/translate'), 'https://example.com/*');
  assert.equal(endpointPermission('http://localhost:5000/translate'), 'http://localhost/*');
});

test('normalization retains only supported settings and never trusts stored booleans or service names', () => {
  assert.deepEqual(normalizeSettings({ autoTranslate: 'true', youtubeEnabled: false, service: 'secret-service', foreign: 'ignored' }), { autoTranslate: false, youtubeEnabled: false, service: 'google', endpoint: '', apiKey: '', model: '', preset: 'custom' });
});

test('oversized/empty text never leaves the browser', async () => {
  let requests = 0;
  for (const value of ['', '  ', null, 'x'.repeat(MAX_TEXT_LENGTH + 1)]) {
    await assert.rejects(requestTranslation(value, google, { fetchImpl: async () => { requests++; return json([]); }}));
  }
  assert.equal(requests, 0);
});

test('timeout settles even if a transport ignores abort', async () => {
  let signal;
  await assert.rejects(requestTranslation('Hello', google, { timeoutMs: 10, fetchImpl: async (_url, options) => {
    signal = options.signal;
    return new Promise(() => {});
  }}), /超时/);
  assert.equal(signal.aborted, true);
});

test('rate limits, bad JSON, empty results and service errors provide actionable errors', async () => {
  await assert.rejects(requestTranslation('Hello', google, { fetchImpl: async () => json({}, 429) }), /请求过多/);
  await assert.rejects(requestTranslation('Hello', google, { fetchImpl: async () => json({}, 403) }), /拒绝/);
  await assert.rejects(requestTranslation('Hello', google, { fetchImpl: async () => ({ ok: true, json: async () => { throw new SyntaxError(); } }) }), /JSON/);
  await assert.rejects(requestTranslation('Hello', google, { fetchImpl: async () => json([[]]) }), /有效译文/);
  await assert.rejects(requestTranslation('Hello', { service: 'libre', endpoint: 'https://example.com/translate' }, { fetchImpl: async () => json({ error: 'sensitive remote detail' }) }), error => /检查接口/.test(error.message) && !error.message.includes('sensitive'));
});

test('scheduler bounds concurrency, deduplicates active requests and caches successful translations', async () => {
  let active = 0;
  let peak = 0;
  let requests = 0;
  const release = [];
  const translator = createTranslator({ concurrency: 2, fetchImpl: async () => {
    requests++; active++; peak = Math.max(peak, active);
    await new Promise(resolve => release.push(resolve));
    active--;
    return json([[['译文']]]);
  }});
  const first = translator.translate('one', google);
  const duplicate = translator.translate('one', google);
  const second = translator.translate('two', google);
  const third = translator.translate('three', google);
  assert.equal(first, duplicate);
  assert.equal(requests, 2);
  release.shift()(); release.shift()();
  await Promise.all([first, second]);
  await new Promise(resolve => setImmediate(resolve));
  release.shift()();
  await third;
  assert.equal(await translator.translate('one', google), '译文');
  assert.equal(peak, 2);
  assert.equal(requests, 3);
});

test('cache is bounded and queued excess rejects without starting another request', async () => {
  const release = [];
  const scheduler = createTranslator({ concurrency: 1, maxQueue: 1, fetchImpl: async () => {
    await new Promise(resolve => release.push(resolve));
    return json([[['译文']]]);
  }});
  const first = scheduler.translate('one', google);
  const second = scheduler.translate('two', google);
  await assert.rejects(scheduler.translate('three', google), /内容过多/);
  release.shift()(); await first;
  await new Promise(resolve => setImmediate(resolve));
  release.shift()(); await second;
  let count = 0;
  const cached = createTranslator({ maxCache: 1, fetchImpl: async () => { count++; return json([[['译文']]]); }});
  await cached.translate('one', google);
  await cached.translate('two', google);
  await cached.translate('one', google);
  assert.equal(count, 3);
});



const aiSettings = {
  openai: { service: 'openai', endpoint: 'https://api.example/v1/chat/completions', apiKey: 'unit-test-key', model: 'user-chosen-model', preset: 'custom' },
  anthropic: { service: 'anthropic', endpoint: 'https://api.example/v1/messages', apiKey: 'unit-test-key', model: 'user-chosen-model', preset: 'custom' },
  gemini: { service: 'gemini', endpoint: 'https://generativelanguage.googleapis.com/v1beta', apiKey: 'unit-test-key', model: 'models/user-chosen-model', preset: 'custom' },
};
const aiResponse = (service, text = '你好。') => service === 'openai'
  ? { choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: text } }] }
  : service === 'anthropic'
    ? { content: [{ type: 'text', text }], stop_reason: 'end_turn' }
    : { candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }] };

test('OpenAI-compatible protocol sends only model and system/user messages, with optional bearer key', async () => {
  let captured;
  const fetchImpl = async (url, options) => {
    captured = { url, options, body: JSON.parse(options.body) };
    return json(aiResponse('openai'));
  };
  assert.equal(await requestTranslation('Hello.', aiSettings.openai, { fetchImpl }), '你好。');
  assert.equal(captured.url, aiSettings.openai.endpoint);
  assert.equal(captured.options.method, 'POST');
  assert.equal(captured.options.redirect, 'error');
  assert.equal(captured.options.cache, 'no-store');
  assert.deepEqual(captured.options.headers, { 'Content-Type': 'application/json', Authorization: 'Bearer unit-test-key' });
  assert.deepEqual(captured.body, { model: 'user-chosen-model', messages: [{ role: 'system', content: TRANSLATION_INSTRUCTION }, { role: 'user', content: 'Hello.' }] });
  assert.equal(captured.options.credentials, 'omit');
  await requestTranslation('Hello.', { ...aiSettings.openai, apiKey: '' }, { fetchImpl });
  assert.equal(captured.options.headers.Authorization, undefined, 'self-hosted compatible services may omit a key');
});

test('Anthropic protocol sends required direct-browser/version headers and a top-level system instruction', async () => {
  let captured;
  const result = await requestTranslation('Hello.', aiSettings.anthropic, { fetchImpl: async (url, options) => {
    captured = { url, options, body: JSON.parse(options.body) };
    return json(aiResponse('anthropic'));
  } });
  assert.equal(result, '你好。');
  assert.equal(captured.url, aiSettings.anthropic.endpoint);
  assert.deepEqual(captured.options.headers, { 'Content-Type': 'application/json', 'x-api-key': 'unit-test-key', 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' });
  assert.deepEqual(captured.body, { model: 'user-chosen-model', max_tokens: 4096, system: TRANSLATION_INSTRUCTION, messages: [{ role: 'user', content: 'Hello.' }] });
});

test('Gemini protocol keeps the key in a header and encodes the model as one URL path component', async () => {
  let captured;
  const settings = { ...aiSettings.gemini, endpoint: aiSettings.gemini.endpoint + '/', model: 'models/team/model ?#' };
  const result = await requestTranslation('Hello.', settings, { fetchImpl: async (url, options) => {
    captured = { url, options, body: JSON.parse(options.body) };
    return json(aiResponse('gemini'));
  } });
  assert.equal(result, '你好。');
  assert.equal(captured.url, 'https://generativelanguage.googleapis.com/v1beta/models/team%2Fmodel%20%3F%23:generateContent');
  assert.equal(new URL(captured.url).search, '');
  assert.deepEqual(captured.options.headers, { 'Content-Type': 'application/json', 'x-goog-api-key': 'unit-test-key' });
  assert.deepEqual(captured.body, { systemInstruction: { parts: [{ text: TRANSLATION_INSTRUCTION }] }, contents: [{ role: 'user', parts: [{ text: 'Hello.' }] }] });
});

test('model/key/endpoint validation rejects incomplete AI settings before network I/O', async () => {
  let requests = 0;
  const invalid = [
    { ...aiSettings.openai, model: '' },
    { ...aiSettings.openai, model: 'line\nmodel' },
    { ...aiSettings.openai, endpoint: 'http://remote.example/chat' },
    { ...aiSettings.openai, endpoint: 'https://user:secret@example.com/chat' },
    { ...aiSettings.openai, endpoint: 'https://example.com/chat?key=secret' },
    { ...aiSettings.anthropic, apiKey: '' },
    { ...aiSettings.gemini, apiKey: '' },
    { ...aiSettings.gemini, model: 'models/' },
    { ...aiSettings.anthropic, apiKey: 'line\nkey' },
  ];
  for (const settings of invalid) {
    await assert.rejects(requestTranslation('Hello.', settings, { fetchImpl: async () => { requests++; return json({}); } }));
  }
  assert.equal(requests, 0);
  assert.equal(validateServiceSettings({ ...aiSettings.openai, endpoint: 'http://localhost:1234/v1/chat/completions', apiKey: '' }).endpoint, 'http://localhost:1234/v1/chat/completions');
});

test('AI responses reject refusal, tool calls, truncated output and empty translations', async () => {
  const invalid = [
    ['openai', { choices: [{ finish_reason: 'stop', message: { content: 'hidden', refusal: 'refused' } }] }],
    ['openai', { choices: [{ finish_reason: 'tool_calls', message: { content: 'hidden', tool_calls: [{}] } }] }],
    ['openai', { choices: [{ finish_reason: 'length', message: { content: 'partial' } }] }],
    ['openai', { choices: [{ finish_reason: 'stop', message: { content: '' } }] }],
    ['anthropic', { content: [{ type: 'tool_use', name: 'tool' }, { type: 'text', text: 'hidden' }], stop_reason: 'tool_use' }],
    ['anthropic', { content: [{ type: 'text', text: 'partial' }], stop_reason: 'max_tokens' }],
    ['anthropic', { content: [], stop_reason: 'end_turn' }],
    ['gemini', { promptFeedback: { blockReason: 'SAFETY' } }],
    ['gemini', { candidates: [{ content: { parts: [{ functionCall: { name: 'tool' } }, { text: 'hidden' }] }, finishReason: 'STOP' }] }],
    ['gemini', { candidates: [{ content: { parts: [{ text: 'partial' }] }, finishReason: 'MAX_TOKENS' }] }],
    ['gemini', { candidates: [{ content: { parts: [{ text: 'reasoning', thought: true }] }, finishReason: 'STOP' }] }],
  ];
  for (const [service, response] of invalid) {
    await assert.rejects(requestTranslation('Hello.', aiSettings[service], { fetchImpl: async () => json(response) }), /译文/);
  }
  assert.equal(await requestTranslation('Hello.', aiSettings.gemini, { fetchImpl: async () => json({ candidates: [{ content: { parts: [{ text: 'reasoning', thought: true }, { text: '译文。' }] }, finishReason: 'STOP' }] }) }), '译文。');
});

test('all three AI protocols report auth/rate-limit failures without exposing remote diagnostics', async () => {
  for (const settings of Object.values(aiSettings)) {
    for (const status of [401, 403, 429]) {
      await assert.rejects(requestTranslation('Hello.', settings, { fetchImpl: async () => json({ error: { message: 'unit-test-secret-diagnostic' } }, status) }), error => /拒绝|请求过多/.test(error.message) && !error.message.includes('diagnostic'));
    }
    await assert.rejects(requestTranslation('Hello.', settings, { fetchImpl: async () => json({ error: { message: 'unit-test-secret-diagnostic' } }) }), error => /检查/.test(error.message) && !error.message.includes('diagnostic'));
  }
});

test('all AI protocols retain per-sentence outputs when concurrent responses complete out of order', async () => {
  for (const service of ['openai', 'anthropic', 'gemini']) {
    const releases = new Map();
    let active = 0;
    let peak = 0;
    const settings = { ...aiSettings[service], model: 'model-A' };
    const translator = createTranslator({ concurrency: 3, fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      const source = service === 'openai' ? body.messages[1].content : service === 'anthropic' ? body.messages[0].content : body.contents[0].parts[0].text;
      active++; peak = Math.max(peak, active);
      await new Promise(resolve => releases.set(source, resolve));
      active--;
      return json(aiResponse(service, `${settings.model}:${source}`));
    } });
    const first = translator.translate('sentence-one', settings);
    const second = translator.translate('sentence-two', settings);
    const third = translator.translate('sentence-three', settings);
    releases.get('sentence-three')();
    releases.get('sentence-one')();
    releases.get('sentence-two')();
    assert.deepEqual(await Promise.all([first, second, third]), ['model-A:sentence-one', 'model-A:sentence-two', 'model-A:sentence-three'], service);
    assert.equal(peak, 3, service);
  }
});
test('AI cache and in-flight deduplication separate model IDs and presets', async () => {
  let calls = 0;
  const translator = createTranslator({ fetchImpl: async (_url, options) => {
    calls++;
    return json(aiResponse('openai', `${JSON.parse(options.body).model}:${calls}`));
  } });
  const base = { ...aiSettings.openai, model: 'model-A', preset: 'provider-A' };
  const first = translator.translate('same source', base);
  assert.equal(first, translator.translate('same source', base));
  assert.equal(await first, 'model-A:1');
  assert.equal(await translator.translate('same source', { ...base, model: 'model-B' }), 'model-B:2');
  assert.equal(await translator.translate('same source', { ...base, preset: 'provider-B' }), 'model-A:3');
  assert.equal(await translator.translate('same source', base), 'model-A:1');
  assert.equal(calls, 3);
});

test('settings persist the seven supported fields and validate AI credentials on save', async () => {
  assert.deepEqual(Object.keys(DEFAULT_SETTINGS).sort(), ['apiKey', 'autoTranslate', 'endpoint', 'model', 'preset', 'service', 'youtubeEnabled']);
  const originalChrome = globalThis.chrome;
  let stored = { ...DEFAULT_SETTINGS };
  globalThis.chrome = { storage: { local: { get: async () => ({ ...stored }), set: async value => { stored = { ...value }; } } } };
  try {
    await assert.rejects(saveSettings({ ...aiSettings.anthropic, apiKey: '' }), /密钥/);
    assert.equal(stored.service, 'google', 'invalid configuration must not be saved');
    await saveSettings({ ...aiSettings.openai, apiKey: '', model: '  my-own-model  ', preset: 'provider-test' });
    assert.equal((await loadSettings()).model, 'my-own-model');
    assert.equal(stored.service, 'openai');
    assert.equal(stored.apiKey, '');
    assert.equal(stored.preset, 'provider-test');
  } finally {
    if (originalChrome === undefined) delete globalThis.chrome; else globalThis.chrome = originalChrome;
  }
});
