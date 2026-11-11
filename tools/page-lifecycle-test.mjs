import assert from 'node:assert/strict';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const root = resolve(import.meta.dirname, '..');
async function bundle(entry, exposeClass = false) {
  const options = exposeClass
    ? { stdin: { contents: "import { PageTranslator } from './src/content/page.js'; globalThis.TestPageTranslator = PageTranslator;", resolveDir: root } }
    : { entryPoints: [join(root, entry)] };
  const result = await build({ ...options, bundle: true, write: false, format: 'iife', target: 'chrome120' });
  return result.outputFiles[0].text;
}

async function makeChrome(page, { delayedSettings = false } = {}) {
  await page.evaluate(({ delayedSettings }) => {
    globalThis.testSettings = { autoTranslate: false, youtubeEnabled: true, service: 'google', endpoint: '', apiKey: '' };
    globalThis.testMessages = [];
    globalThis.testChanges = [];
    globalThis.testStorageReads = 0;
    globalThis.chrome = {
      storage: {
        local: { get: async () => {
          testStorageReads++;
          if (delayedSettings && testStorageReads === 1) await new Promise(resolve => { globalThis.releaseSettings = resolve; });
          return { ...testSettings };
        } },
        onChanged: { addListener: listener => testChanges.push(listener) },
      },
      runtime: {
        onMessage: { addListener: listener => testMessages.push(listener) },
        sendMessage: async () => ({ ok: true, text: testSettings.service === 'google' ? '谷歌译文。' : '自备译文。' }),
      },
    };
    globalThis.pageMessage = type => {
      let response;
      for (const listener of testMessages) listener({ type }, {}, value => { response = value; });
      return response;
    };
    globalThis.changeSettings = patch => {
      const changes = {};
      for (const [key, value] of Object.entries(patch)) {
        changes[key] = { oldValue: testSettings[key], newValue: value };
        testSettings[key] = value;
      }
      for (const listener of testChanges) listener(changes, 'local');
    };
  }, { delayedSettings });
}

/** Real DOM and MutationObserver regressions, with only network/Chrome I/O faked. */
export async function testPageLifecycle(context) {
  const pageBundle = await bundle('src/content/page.js', true);
  const indexBundle = await bundle('src/content/index.js');
  const page = await context.newPage();
  const results = [];
  try {
    await page.setContent('<p>Hello first.</p>');
    await page.addScriptTag({ content: pageBundle });
    await page.evaluate(() => {
      globalThis.calls = [];
      globalThis.releases = [];
      globalThis.translator = new TestPageTranslator({ translate: text => new Promise(resolve => { calls.push(text); releases.push(resolve); }) });
      translator.start();
      document.querySelector('p').firstChild.data = 'Hello updated.';
    });
    // Ensure the observer scanned the edited node while its old text was pending.
    await page.waitForTimeout(350);
    await page.evaluate(() => releases[0]('旧译文。'));
    await page.waitForFunction(() => calls.length === 2);
    assert.deepEqual(await page.evaluate(() => calls), ['Hello first.', 'Hello updated.']);
    await page.evaluate(() => releases[1]('更新译文。'));
    await page.waitForFunction(() => document.querySelector('p').textContent === '更新译文。');
    await page.evaluate(() => translator.restore());
    assert.equal(await page.locator('p').textContent(), 'Hello updated.');
    results.push('pending text-node edits are translated and restore preserves the new original');

    await page.setContent('<p>One.</p><p>Two.</p><p>Three.</p>');
    const restarted = await page.evaluate(() => {
      globalThis.calls = [];
      globalThis.releases = [];
      globalThis.translator = new TestPageTranslator({ translate: text => new Promise(resolve => { calls.push(text); releases.push(resolve); }) });
      translator.start();
      translator.restore();
      const restored = translator.status;
      translator.start();
      return { restored, calls: calls.length, active: translator.active };
    });
    assert.deepEqual(restarted, { restored: { translated: false, busy: false, error: '' }, calls: 6, active: 3 });
    await page.evaluate(() => { releases[0]('过期一。'); releases[1]('过期二。'); releases[2]('过期三。'); });
    await page.waitForTimeout(20);
    assert.deepEqual(await page.evaluate(() => ({ active: translator.active, markers: [...document.querySelectorAll('p')].map(p => translator.queued.has(p.firstChild)) })), { active: 3, markers: [true, true, true] });
    await page.evaluate(() => {
      document.body.append(document.createElement('hr'));
      releases[4]('新二。');
    });
    await page.waitForTimeout(350);
    assert.equal(await page.evaluate(() => calls.length), 6, 'late old work must not allow duplicate current-generation jobs');
    await page.evaluate(() => { releases[3]('新一。'); releases[5]('新三。'); });
    await page.waitForFunction(() => !translator.status.busy);
    assert.deepEqual(await page.locator('p').allTextContents(), ['新一。', '新二。', '新三。']);
    await page.evaluate(() => translator.restore());
    assert.deepEqual(await page.locator('p').allTextContents(), ['One.', 'Two.', 'Three.']);
    results.push('restore/restart starts immediately and ignores old-generation completions');

    await page.setContent('<p>Service fails.</p><p>Works.</p>');
    await page.evaluate(() => {
      globalThis.failureCalls = [];
      globalThis.translator = new TestPageTranslator({ translate: async text => {
        failureCalls.push(text);
        if (text === 'Service fails.') throw new Error('受控服务失败');
        return '已翻译。';
      } });
      translator.start();
    });
    await page.waitForFunction(() => !translator.status.busy);
    // A successful sibling changes the DOM and must not keep retrying the failure.
    await page.waitForTimeout(600);
    assert.deepEqual(await page.evaluate(() => failureCalls), ['Service fails.', 'Works.']);
    assert.equal(await page.evaluate(() => translator.status.error), '受控服务失败');
    await page.evaluate(() => { translator.restore(); translator.start(); });
    await page.waitForFunction(() => !translator.status.busy);
    assert.equal(await page.evaluate(() => failureCalls.filter(text => text === 'Service fails.').length), 2, 'explicit restore/start retries a failed original');
    await page.evaluate(() => { document.querySelector('p').firstChild.data = 'Changed text.'; });
    await page.waitForFunction(() => document.querySelector('p').textContent === '已翻译。');
    assert.equal(await page.evaluate(() => failureCalls.filter(text => text === 'Changed text.').length), 1, 'a changed node can retry without a page restart');
    await page.evaluate(() => translator.restore());
    assert.equal(await page.locator('p').first().textContent(), 'Changed text.');
    results.push('failed originals do not retry on sibling DOM changes, but explicit retries and changed text work');
  } finally { await page.close(); }

  const settingsPage = await context.newPage();
  try {
    await settingsPage.setContent('<p>Hello world.</p>');
    await makeChrome(settingsPage);
    await settingsPage.addScriptTag({ content: indexBundle });
    await settingsPage.waitForFunction(() => testStorageReads === 1);
    await settingsPage.evaluate(() => pageMessage('PAGE_TOGGLE'));
    await settingsPage.waitForFunction(() => document.querySelector('p').textContent === '谷歌译文。');
    await settingsPage.evaluate(() => changeSettings({ youtubeEnabled: false }));
    await settingsPage.waitForFunction(() => testStorageReads === 2);
    assert.equal(await settingsPage.locator('p').textContent(), '谷歌译文。');
    await settingsPage.evaluate(() => changeSettings({ service: 'libre', endpoint: 'https://example.test/translate' }));
    await settingsPage.waitForFunction(() => document.querySelector('p').textContent === '自备译文。');
    assert.equal(await settingsPage.evaluate(() => pageMessage('PAGE_STATUS').translated), true);
    await settingsPage.evaluate(() => pageMessage('PAGE_TOGGLE'));
    await settingsPage.evaluate(() => changeSettings({ youtubeEnabled: true }));
    await settingsPage.waitForFunction(() => testStorageReads === 4);
    assert.equal(await settingsPage.locator('p').textContent(), 'Hello world.');
    await settingsPage.evaluate(() => changeSettings({ autoTranslate: true }));
    await settingsPage.waitForFunction(() => document.querySelector('p').textContent === '自备译文。');
    await settingsPage.evaluate(() => pageMessage('PAGE_TOGGLE'));
    await settingsPage.evaluate(() => changeSettings({ youtubeEnabled: false }));
    await settingsPage.waitForFunction(() => testStorageReads === 6);
    assert.equal(await settingsPage.locator('p').textContent(), 'Hello world.');
    results.push('subtitle/provider preferences preserve manual page toggles; auto preference still applies');
  } finally { await settingsPage.close(); }

  const initializationPage = await context.newPage();
  try {
    await initializationPage.setContent('<p>Hello world.</p>');
    await makeChrome(initializationPage, { delayedSettings: true });
    await initializationPage.addScriptTag({ content: indexBundle });
    await initializationPage.waitForFunction(() => typeof releaseSettings === 'function');
    await initializationPage.evaluate(() => pageMessage('PAGE_TOGGLE'));
    await initializationPage.waitForFunction(() => document.querySelector('p').textContent === '谷歌译文。');
    await initializationPage.evaluate(() => releaseSettings());
    await initializationPage.waitForTimeout(30);
    assert.equal(await initializationPage.locator('p').textContent(), '谷歌译文。');
    results.push('a late initial settings read cannot undo a newer manual translation');
  } finally { await initializationPage.close(); }
  return results;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const browser = await chromium.launch({ headless: true, ...(process.env.ASIDE_CHROMIUM_PATH ? { executablePath: process.env.ASIDE_CHROMIUM_PATH } : {}) });
  try {
    const context = await browser.newContext();
    const results = await testPageLifecycle(context);
    for (const result of results) console.log(`PASS ${result}`);
  } finally { await browser.close(); }
}
