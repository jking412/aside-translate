import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const output = resolve(root, 'output/ui-parity');
const checks = [];
await mkdir(output, { recursive: true });
const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (pathname === '/fixture.html') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end('<!doctype html><html><body><h1>Controlled UI fixture</h1><p>Original webpage text.</p></body></html>');
    return;
  }
  try {
    const file = resolve(root, pathname.startsWith('/assets/') ? '.' + pathname : 'src/' + pathname.slice(1));
    if (!file.startsWith(root + '\\') && !file.startsWith(root + '/')) throw new Error('Invalid path');
    res.setHeader('Content-Type', { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png' }[extname(file)] || 'text/plain');
    res.end(await readFile(file));
  } catch { res.writeHead(404); res.end('Not found'); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
let context;
async function check(name, task) {
  try { await task(); checks.push({ name, passed: true }); console.log(`PASS ${name}`); }
  catch (error) { checks.push({ name, passed: false, error: error.message }); console.log(`FAIL ${name}: ${error.message}`); }
}
async function popup() {
  const page = await context.newPage();
  await page.goto(origin + '/popup/index.html');
  await page.locator('#translate').waitFor();
  await page.waitForFunction(() => !document.getElementById('auto-translate').disabled);
  await page.locator('#service-details').evaluate(node => { node.open = true; });
  return page;
}
try {
  browser = await chromium.launch({ executablePath: process.env.ASIDE_CHROMIUM_PATH || undefined, headless: true });
  context = await browser.newContext({ viewport: { width: 1000, height: 850 } });
  await context.addInitScript(() => {
    const listeners = new Set();
    window.addEventListener('storage', event => {
      if (event.key !== 'aside-test-storage') return;
      const before = JSON.parse(event.oldValue || '{}'), after = JSON.parse(event.newValue || '{}');
      const changes = {};
      for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) changes[key] = { oldValue: before[key], newValue: after[key] };
      for (const fn of listeners) fn(changes, 'local');
    });
    const load = () => JSON.parse(localStorage.getItem('aside-test-storage') || '{}');
    globalThis.__uiTranslated = false;
    globalThis.chrome = {
      runtime: { getURL: path => new URL('/' + path, location.origin).href, sendMessage: async message => { if (message.type === 'OPEN_SETTINGS') globalThis.__openedSettings = true; if (message.type === 'PAGE_TOGGLE_TAB') { globalThis.__uiTranslated = !globalThis.__uiTranslated; return { ok: true, status: { translated: globalThis.__uiTranslated, busy: false, error: '', youtubeStatus: '' } }; } return { ok: true }; } },
      storage: { local: {
        get: async keys => { const values = load(); if (!keys) return values; return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(key => key in values).map(key => [key, values[key]])); },
        set: async patch => { const previous = load(); localStorage.setItem('aside-test-storage', JSON.stringify({ ...previous, ...patch })); const changes = Object.fromEntries(Object.entries(patch).map(([key, newValue]) => [key, { oldValue: previous[key], newValue }])); for (const fn of listeners) fn(changes, 'local'); },
        remove: async keys => { const values = load(); for (const key of Array.isArray(keys) ? keys : [keys]) delete values[key]; localStorage.setItem('aside-test-storage', JSON.stringify(values)); },
      }, onChanged: { addListener: fn => listeners.add(fn), removeListener: fn => listeners.delete(fn) } },
      tabs: { query: async () => [{ id: 1, url: 'https://example.org/article' }], sendMessage: async (_id, message, options) => { if (message.type === 'PAGE_STATUS' && options?.frameId !== 0) throw new Error('Popup status must target the top frame'); if (message.type === 'PAGE_TOGGLE') throw new Error('Popup must use the coordinated tab toggle'); return { translated: globalThis.__uiTranslated, busy: false, error: '', youtubeStatus: '' }; } },
      scripting: { executeScript: async () => [] },
      permissions: { request: async () => { throw new Error('Runtime permission request must not be used'); } },
    };
  });
  let page = await popup();
  await check('DeepSeek has a verified default model without manual typing', async () => {
    await page.getByRole('button', { name: '翻译此页', exact: true }).click();
    await page.getByRole('button', { name: '恢复原文', exact: true }).click();
    await page.getByRole('button', { name: '翻译此页', exact: true }).waitFor();
    await page.selectOption('#service', 'openai');
    await page.selectOption('#provider', 'deepseek');
    assert.equal(await page.locator('#model').inputValue(), 'deepseek-flash');
  });
  await check('Closing popup and reopening preserves unfinished provider, model and key', async () => {
    await page.fill('#model', 'draft-model');
    await page.fill('#api-key', 'fixture-key-keep-this-draft');
    await page.close();
    page = await popup();
    assert.equal(await page.locator('#service').inputValue(), 'openai');
    assert.equal(await page.locator('#provider').inputValue(), 'deepseek');
    assert.equal(await page.locator('#model').inputValue(), 'draft-model');
    assert.equal(await page.locator('#api-key').inputValue(), 'fixture-key-keep-this-draft');
  });
  await check('Switching providers preserves each unfinished configuration', async () => {
    await page.selectOption('#service', 'openai');
    await page.selectOption('#provider', 'deepseek');
    await page.fill('#model', 'draft-model');
    await page.fill('#api-key', 'fixture-key-deepseek');
    await page.selectOption('#provider', 'openai');
    await page.fill('#model', 'openai-fixture-model');
    await page.fill('#api-key', 'fixture-key-openai');
    await page.selectOption('#provider', 'deepseek');
    assert.equal(await page.locator('#model').inputValue(), 'draft-model');
    assert.equal(await page.locator('#api-key').inputValue(), 'fixture-key-deepseek');
    await page.selectOption('#provider', 'openai');
    assert.equal(await page.locator('#model').inputValue(), 'openai-fixture-model');
    assert.equal(await page.locator('#api-key').inputValue(), 'fixture-key-openai');
  });
  await check('Popup and settings tabs cannot overwrite another field with an older provider snapshot', async () => {
    await page.selectOption('#service', 'openai'); await page.selectOption('#provider', 'deepseek');
    const parallel = await context.newPage(); await parallel.goto(origin + '/options/index.html');
    await parallel.waitForFunction(() => document.querySelector('#save-service') && !document.querySelector('#save-service').disabled);
    await page.fill('#api-key', 'fixture-cross-tab-fresh-key');
    await parallel.fill('#model', 'fixture-cross-tab-model');
    const reopened = await popup();
    assert.equal(await reopened.locator('#api-key').inputValue(), 'fixture-cross-tab-fresh-key');
    assert.equal(await reopened.locator('#model').inputValue(), 'fixture-cross-tab-model');
    await reopened.close(); await parallel.close();
  });
  await check('Dedicated settings page remains editable across tab switches and reloads', async () => {
    const settings = await context.newPage();
    const response = await settings.goto(origin + '/options/index.html');
    assert.equal(response.status(), 200, 'Standalone settings page must exist');
    await settings.locator('#service-form').waitFor();
    await settings.waitForFunction(() => !document.querySelector('#save-service').disabled);
    await settings.selectOption('#service', 'openai');
    await settings.selectOption('#provider', 'deepseek');
    await settings.fill('#api-key', 'fixture-key-settings');
    const other = await context.newPage();
    await other.goto(origin + '/fixture.html');
    await other.bringToFront();
    await settings.bringToFront();
    assert.equal(await settings.locator('#api-key').inputValue(), 'fixture-key-settings');
    await settings.reload();
    await settings.waitForFunction(() => !document.querySelector('#save-service').disabled);
    assert.equal(await settings.locator('#api-key').inputValue(), 'fixture-key-settings');
    await settings.locator('body').screenshot({ path: resolve(output, 'settings.png') });
    await settings.setViewportSize({ width: 400, height: 800 });
    assert.equal(await settings.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'Narrow settings page must not overflow horizontally');
    await settings.locator('body').screenshot({ path: resolve(output, 'settings-narrow.png') });
    await settings.close(); await other.close();
  });
  await check('Saving applies a valid draft without asking for runtime host permission', async () => {
    await page.selectOption('#service', 'openai');
    await page.selectOption('#provider', 'deepseek');
    await page.fill('#model', 'deepseek-flash');
    await page.fill('#api-key', 'fixture-key-save');
    await page.click('#save-service');
    await page.waitForFunction(() => document.querySelector('#settings-status').textContent.includes('已保存'));
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('aside-test-storage')).service), 'openai');
  });
  await check('Invalid endpoint reports the concrete HTTPS correction while retaining its draft', async () => {
    await page.fill('#endpoint', 'http://not-local.example/translate');
    await page.click('#save-service');
    await page.locator('#settings-status').filter({ hasText: 'HTTPS' }).waitFor();
    assert.equal(await page.locator('#endpoint').inputValue(), 'http://not-local.example/translate');
  });
  await check('Reference-parity floating controls click, expand, drag to edge, restore and hide safely', async () => {
    const fixture = await context.newPage(); await fixture.goto(origin + '/fixture.html');
    await fixture.evaluate(async () => {
      const { FloatingControls } = await import('/content/floating.js');
      let translated = false;
      globalThis.controls = new FloatingControls({ getStatus: () => ({ translated, busy: false, error: '' }), onToggle: async () => { translated = !translated; }, onOpenSettings: () => { globalThis.settingsOpened = true; } });
      await controls.start();
    });
    const host = fixture.locator('#aside-floating');
    await host.getByRole('button', { name: '翻译此页', exact: true }).click();
    await host.getByRole('button', { name: '恢复原文', exact: true }).waitFor();
    await host.getByRole('button', { name: '恢复原文', exact: true }).click();
    await host.getByRole('button', { name: '翻译此页', exact: true }).waitFor();
    await host.getByRole('button', { name: '展开翻译面板', exact: true }).click();
    await host.getByRole('button', { name: '翻译与服务设置', exact: true }).click();
    assert.equal(await fixture.evaluate(() => settingsOpened), true);
    await host.getByRole('button', { name: '展开翻译面板', exact: true }).click();
    await fixture.keyboard.press('Escape');
    assert.equal(await host.getByRole('region', { name: '旁译快捷面板' }).isVisible(), false);
    const ball = host.locator('[data-drag-handle]');
    const bounds = await ball.boundingBox();
    await fixture.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await fixture.mouse.down(); await fixture.mouse.move(20, 450, { steps: 12 }); await fixture.mouse.up();
    const moved = await host.boundingBox(); assert.ok(moved.x < 15, 'Floating ball should snap to the left');
    assert.equal(await host.getByRole('button', { name: '翻译此页', exact: true }).count(), 1, 'Dragging must not trigger translation');
    await host.getByRole('button', { name: '展开翻译面板', exact: true }).click();
    await fixture.screenshot({ path: resolve(output, 'floating.png') });
    await fixture.evaluate(() => { controls.stop(); });
    assert.equal(await host.count(), 0);
    await fixture.close();
  });
  await check('Saving an unchanged existing custom configuration retains its saved endpoint, model and key', async () => {
    await page.evaluate(() => { localStorage.removeItem('aside-test-storage'); });
    await page.evaluate(() => chrome.storage.local.set({ service: 'openai', preset: 'custom', endpoint: 'https://existing.example/chat/completions', model: 'existing-model', apiKey: 'fixture-existing-key' }));
    const existing = await context.newPage(); await existing.goto(origin + '/options/index.html');
    await existing.waitForFunction(() => document.querySelector('#save-service') && !document.querySelector('#save-service').disabled);
    await existing.click('#save-service');
    await existing.locator('#settings-status').filter({ hasText: '服务已保存' }).waitFor();
    assert.deepEqual(await existing.evaluate(() => { const value = JSON.parse(localStorage.getItem('aside-test-storage')); return [value.endpoint, value.model, value.apiKey]; }), ['https://existing.example/chat/completions', 'existing-model', 'fixture-existing-key']);
    await existing.close();
  });
  await page.evaluate(() => { localStorage.removeItem('aside-test-storage'); });
  const cleanPopup = await popup();
  await cleanPopup.setViewportSize({ width: 344, height: 720 });
  await cleanPopup.locator('#service-details').evaluate(node => { node.open = false; });
  await cleanPopup.locator('body').screenshot({ path: resolve(output, 'popup-default.png') });
  const cleanSettings = await context.newPage(); await cleanSettings.goto(origin + '/options/index.html');
  await cleanSettings.waitForFunction(() => document.querySelector('#save-service') && !document.querySelector('#save-service').disabled);
  await cleanSettings.locator('body').screenshot({ path: resolve(output, 'options-default.png') });
  await cleanSettings.selectOption('#service', 'openai'); await cleanSettings.selectOption('#provider', 'deepseek');
  await cleanSettings.locator('body').screenshot({ path: resolve(output, 'options-deepseek.png') });
  await cleanSettings.close(); await cleanPopup.close();
} finally {
  await mkdir(output, { recursive: true });
  await writeFile(resolve(output, 'result.json'), JSON.stringify({ kind: 'Controlled UI tests with Chrome API substitute; not native popup permission dialogs or real translation service', checks }, null, 2) + '\n');
  await context?.close(); await browser?.close(); await new Promise(done => server.close(done));
}
if (checks.some(check => !check.passed)) process.exitCode = 1;
