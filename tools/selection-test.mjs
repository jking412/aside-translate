import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const out = join(root, 'output', 'selection');
await mkdir(out, { recursive: true });
const calls = [];
const slow = new Map();
let retryCount = 0;
const longText = Array.from({ length: 130 }, (_, index) => `Unique sentence ${String(index).padStart(3, '0')} keeps every selected word. `).join('');
const fixture = `<!doctype html><html lang="en"><meta charset="utf-8"><title>Selection translation fixture</title><style>
body{margin:32px;font:18px/1.6 Arial,sans-serif;color:#203047;background:#f5f8fc}main{max-width:760px}p{margin:18px 0}.single{font:20px/1.8 monospace;white-space:nowrap}input,textarea,[contenteditable]{display:block;margin:10px 0;padding:8px}#outside{display:block;width:180px;height:38px}#long{font-size:16px}#edge{position:absolute;right:3px;top:720px;width:250px;margin:0}iframe{width:600px;height:200px;margin-top:20px;background:white;border:1px solid #aaa}
</style><body><main><h1>Selection translation</h1><p id="first" class="single">A selected sentence.</p><p id="fresh" class="single">Fresh selection words.</p><p id="slow" class="single">A slow selected sentence.</p><p id="slow-close" class="single">Another slow selected sentence.</p><p id="retry" class="single">A retry selected sentence.</p><p id="markup" class="single">Literal markup response.</p><button id="outside">Outside selection</button><label>Editable input<input id="input" value="An input selection." /></label><label>Password<input id="password" type="password" value="Fixture password only." /></label><textarea id="textarea">A textarea selection.</textarea><div id="editable" contenteditable="true">An editable selection.</div><p id="edge">A selection near the viewport edge.</p><p id="long">${longText}</p><p id="oversized"></p><div id="frames"></div></main></body></html>`;
const literalMarkup = '<img src="https://untrusted.invalid/selection.png" onerror="globalThis.selectionExecuted=true">Literal translation.';
const server = createServer(async (request, response) => {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return; }
  if (request.method === 'POST') {
    let raw = ''; for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw);
    assert.equal(typeof body.q, 'string');
    calls.push(body.q);
    if (body.q === 'A retry selected sentence.' && retryCount++ === 0) { response.writeHead(503); response.end('{}'); return; }
    if (body.q === 'A slow selected sentence.' || body.q === 'Another slow selected sentence.') await new Promise(done => slow.set(body.q, done));
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ translatedText: body.q === 'Literal markup response.' ? literalMarkup : '译：' + body.q }));
    return;
  }
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.end(request.url === '/frame' ? '<!doctype html><html><style>body{margin:14px;font:20px/1.8 monospace}</style><body><p id="frame-text">Frame selected words.</p></body></html>' : fixture);
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`;
const report = { date: new Date().toISOString(), scope: 'Exact shipping manifest and bundles; isolated browser, synthetic text and local translation responses. No personal pages, browser data or cloud API keys.', checks: [], errors: [] };
let context;

const trigger = page => page.locator('#aside-selection [data-role="trigger"]');
const card = page => page.locator('#aside-selection [data-role="card"]');
const role = (page, name) => page.locator(`#aside-selection [data-role="${name}"]`);
const normalize = text => text.replace(/\s+/g, ' ').trim();
async function check(name, run) { await run(); report.checks.push(name); console.log('PASS', name); }
async function waitForCall(text) {
  for (let index = 0; index < 100; index++) { if (calls.includes(text)) return; await new Promise(done => setTimeout(done, 20)); }
  throw new Error('Expected controlled translation request was not made');
}
async function dragSelect(page, locator) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  const points = await locator.evaluate(element => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const nodes = []; for (let node; (node = walker.nextNode());) if (node.data.length) nodes.push(node);
    const first = document.createRange(); first.setStart(nodes[0], 0); first.setEnd(nodes[0], 1);
    const last = document.createRange(); last.setStart(nodes.at(-1), nodes.at(-1).length - 1); last.setEnd(nodes.at(-1), nodes.at(-1).length);
    const a = first.getBoundingClientRect(), b = last.getBoundingClientRect(), base = element.getBoundingClientRect();
    return { x1: a.left - base.left + .2, y1: a.top - base.top + a.height / 2, x2: b.right - base.left + 1, y2: b.top - base.top + b.height / 2 };
  });
  await page.mouse.move(box.x + points.x1, box.y + points.y1);
  await page.mouse.down();
  await page.mouse.move(box.x + points.x2, box.y + points.y2, { steps: 16 });
  await page.mouse.up();
  return locator.evaluate(element => {
    const owner = element.getRootNode();
    const selection = owner instanceof ShadowRoot && typeof owner.getSelection === 'function' ? owner.getSelection() : window.getSelection();
    return selection?.toString().trim() || '';
  });
}
async function selectContents(locator) {
  await locator.scrollIntoViewIfNeeded();
  // Start from a real outside-card gesture, as a user would when selecting
  // another paragraph after using the card or its retry button.
  await locator.click({ position: { x: 2, y: 2 } });
  // Flush the scroll notification before synthesizing keyboard selection;
  // real mouse selection naturally spans several frames after scrolling.
  await locator.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
  await locator.evaluate(element => {
    const range = document.createRange(); range.selectNodeContents(element);
    const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
    element.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'End', shiftKey: true }));
    element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    element.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse' }));
  });
}
async function isVisible(locator) { return await locator.count() > 0 && await locator.isVisible(); }
async function assertHidden(page) { assert.equal(await isVisible(trigger(page)), false); assert.equal(await isVisible(card(page)), false); }
async function expectTranslated(page, text) {
  await role(page, 'source').filter({ hasText: text }).waitFor();
  await role(page, 'target').filter({ hasText: '译：' + text }).waitFor();
}

try {
  const extension = join(root, 'dist');
  context = await chromium.launchPersistentContext(await mkdtemp(join(out, 'profile-')), {
    channel: 'chromium', executablePath: process.env.ASIDE_CHROMIUM_PATH || undefined, headless: true,
    viewport: { width: 1100, height: 850 }, args: [`--load-extension=${extension}`, `--disable-extensions-except=${extension}`],
  });
  context.setDefaultTimeout(8000);
  context.on('page', page => page.on('pageerror', error => report.errors.push(error.message)));
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(endpoint => chrome.storage.local.set({ service: 'libre', endpoint, autoTranslate: false, youtubeEnabled: false, floatingEnabled: false }), origin + '/translate');
  const page = await context.newPage();
  await page.goto(origin + '/article');
  await check('Mouse selection offers a trigger without sending; click preserves source and selection and shows the chosen service translation', async () => {
    await page.locator('#first').evaluate(element => { globalThis.originalSelectedParagraph = element; globalThis.originalClicks = 0; element.addEventListener('click', () => originalClicks++); });
    assert.equal(await dragSelect(page, page.locator('#first')), 'A selected sentence.');
    await trigger(page).waitFor({ state: 'visible' });
    assert.equal(calls.length, 0, 'Selection itself must not send text');
    await trigger(page).click();
    await expectTranslated(page, 'A selected sentence.');
    assert.equal(await page.evaluate(() => window.getSelection().toString().trim()), 'A selected sentence.');
    assert.equal(await page.evaluate(() => document.querySelector('#first') === originalSelectedParagraph), true);
    assert.equal(await page.locator('#first').textContent(), 'A selected sentence.');
    await page.screenshot({ path: join(out, 'selection-desktop.png') });
    const preview = await page.evaluate(() => {
      const source = window.getSelection().getRangeAt(0).getClientRects()[0];
      const card = document.querySelector('#aside-selection').shadowRoot.querySelector('[data-role="card"]').getBoundingClientRect();
      const x = Math.max(0, Math.min(source.left, card.left) - 8), y = Math.max(0, Math.min(source.top, card.top) - 8);
      return { x, y, width: Math.min(innerWidth - x, Math.max(source.right, card.right) - x + 8), height: Math.min(innerHeight - y, Math.max(source.bottom, card.bottom) - y + 8) };
    });
    await page.screenshot({ path: join(out, 'selection-preview.png'), clip: preview });
  });
  await check('Real Shift+Arrow selection translates, and selecting/copying its result keeps the card open without another request', async () => {
    assert.equal(await dragSelect(page, page.locator('#first')), 'A selected sentence.');
    await page.keyboard.down('Shift');
    for (let index = 0; index < ' sentence.'.length; index++) await page.keyboard.press('ArrowLeft');
    await page.keyboard.up('Shift');
    assert.equal(await page.evaluate(() => window.getSelection().toString()), 'A selected');
    await trigger(page).click(); await expectTranslated(page, 'A selected');
    const before = calls.length;
    assert.equal(await dragSelect(page, role(page, 'target')), '译：A selected');
    // Dispatch a copy event without writing the operating-system clipboard.
    await role(page, 'target').evaluate(element => element.dispatchEvent(new ClipboardEvent('copy', { bubbles: true, composed: true })));
    await page.waitForTimeout(80);
    assert.equal(await card(page).isVisible(), true);
    assert.equal(await trigger(page).isVisible(), false);
    assert.equal(calls.length, before);
  });
  await check('Escape, close and outside click dismiss the selection UI without modifying the original text', async () => {
    await page.keyboard.press('Escape'); await assertHidden(page);
    await selectContents(page.locator('#first')); await trigger(page).click(); await expectTranslated(page, 'A selected sentence.');
    await role(page, 'close').click(); await assertHidden(page);
    await selectContents(page.locator('#first')); await trigger(page).click(); await expectTranslated(page, 'A selected sentence.');
    await page.locator('#outside').click(); await assertHidden(page);
    assert.equal(await page.locator('#first').textContent(), 'A selected sentence.');
  });
  await check('Network errors retain the selected text and support an explicit retry', async () => {
    await selectContents(page.locator('#retry')); await trigger(page).click();
    await role(page, 'retry').waitFor({ state: 'visible' });
    assert.equal(await role(page, 'source').textContent(), 'A retry selected sentence.');
    await role(page, 'retry').click(); await expectTranslated(page, 'A retry selected sentence.');
    assert.equal(retryCount, 2);
  });
  await check('A newer selection wins even when a previous translation completes later', async () => {
    await selectContents(page.locator('#slow')); await trigger(page).click(); await waitForCall('A slow selected sentence.');
    await dragSelect(page, page.locator('#fresh')); await trigger(page).click(); await expectTranslated(page, 'Fresh selection words.');
    slow.get('A slow selected sentence.')(); slow.delete('A slow selected sentence.');
    await page.waitForTimeout(100);
    assert.equal(await role(page, 'source').textContent(), 'Fresh selection words.');
    assert.equal(await role(page, 'target').textContent(), '译：Fresh selection words.');
  });
  await check('Closing a pending card prevents the old response from reopening it', async () => {
    await selectContents(page.locator('#slow-close')); await trigger(page).click(); await waitForCall('Another slow selected sentence.');
    await role(page, 'close').click();
    slow.get('Another slow selected sentence.')(); slow.delete('Another slow selected sentence.');
    await page.waitForTimeout(100); await assertHidden(page);
  });
  await check('Editable input, textarea, password and contenteditable selections are ignored', async () => {
    const before = calls.length;
    for (const id of ['input', 'password', 'textarea']) {
      await page.locator('#' + id).evaluate(element => { element.focus(); element.select(); element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); element.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })); });
      await page.waitForTimeout(60); await assertHidden(page);
    }
    await selectContents(page.locator('#editable')); await page.waitForTimeout(60); await assertHidden(page);
    assert.equal(calls.length, before);
  });
  await check('Literal service markup is displayed as text and cannot become executable page content', async () => {
    await selectContents(page.locator('#markup')); await trigger(page).click();
    await role(page, 'target').filter({ hasText: literalMarkup }).waitFor();
    assert.equal(await role(page, 'target').textContent(), literalMarkup);
    assert.equal(await role(page, 'target').locator('img,script').count(), 0);
    assert.equal(await page.evaluate(() => globalThis.selectionExecuted), undefined);
  });
  await check('Long selected text is chunked within the service limit and translated completely', async () => {
    await selectContents(page.locator('#long')); await trigger(page).click();
    await page.waitForFunction(expected => {
      const host = document.querySelector('#aside-selection');
      const text = host?.shadowRoot?.querySelector('[data-role="target"]')?.textContent || '';
      return text.replaceAll('译：', '').replace(/\s+/g, ' ').trim() === expected;
    }, normalize(longText), { timeout: 12000 });
    const longCalls = calls.filter(text => text.includes('Unique sentence'));
    assert.ok(longCalls.length >= 3, 'The fixture must exceed a single service request');
    assert.ok(longCalls.every(text => text.length <= 1800));
    assert.equal(await page.locator('#long').textContent(), longText);
  });
  await check('Oversized selections give a local explanation without sending or silently truncating text', async () => {
    await page.locator('#oversized').evaluate(element => { element.textContent = 'Limit word. '.repeat(2000); });
    await selectContents(page.locator('#oversized')); await trigger(page).click();
    await role(page, 'status').filter({ hasText: /20[,， ]?000|过长|最多/ }).waitFor();
    assert.equal(calls.some(text => text.includes('Limit word.')), false);
  });
  await check('The setting disables listeners and hides existing UI, then reenables fresh selections', async () => {
    await worker.evaluate(() => chrome.storage.local.set({ selectionEnabled: false }));
    await page.waitForTimeout(100); await assertHidden(page);
    await selectContents(page.locator('#first')); await page.waitForTimeout(100); await assertHidden(page);
    await worker.evaluate(() => chrome.storage.local.set({ selectionEnabled: true }));
    await page.evaluate(() => window.getSelection().removeAllRanges());
    await selectContents(page.locator('#fresh')); await trigger(page).waitFor({ state: 'visible' });
  });
  await check('A cross-origin frame owns its selection trigger and uses the same background service', async () => {
    await page.keyboard.press('Escape');
    await page.locator('#frames').evaluate((element, url) => { const frame = document.createElement('iframe'); frame.id = 'selection-frame'; frame.src = url; element.append(frame); }, origin.replace('127.0.0.1', 'localhost') + '/frame');
    await page.locator('#selection-frame').scrollIntoViewIfNeeded();
    const frame = page.frameLocator('#selection-frame');
    assert.equal(await dragSelect(page, frame.locator('#frame-text')), 'Frame selected words.');
    await trigger(frame).click(); await expectTranslated(frame, 'Frame selected words.');
    assert.equal(await frame.locator('#frame-text').textContent(), 'Frame selected words.');
  });
  await check('Trigger and card stay inside a narrow viewport near its edge; scroll does not send text', async () => {
    await page.setViewportSize({ width: 360, height: 520 });
    await selectContents(page.locator('#edge'));
    await trigger(page).waitFor({ state: 'visible' });
    for (const item of [trigger(page)]) {
      const bounds = await item.boundingBox(); assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= 361 && bounds.y + bounds.height <= 521);
    }
    await trigger(page).click(); await expectTranslated(page, 'A selection near the viewport edge.');
    const bounds = await card(page).boundingBox();
    assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= 361 && bounds.y + bounds.height <= 521);
    await page.screenshot({ path: join(out, 'selection-narrow.png') });
    const before = calls.length;
    await page.mouse.wheel(0, 200); await page.waitForTimeout(100);
    assert.equal(calls.length, before);
    if (await isVisible(card(page))) { const moved = await card(page).boundingBox(); assert.ok(moved.x >= 0 && moved.y >= 0 && moved.x + moved.width <= 361 && moved.y + moved.height <= 521); }
  });
  assert.deepEqual(report.errors, []);
  report.ok = true;
} catch (error) {
  report.ok = false; report.failure = error.message.split('\n')[0];
  try { await context?.pages().find(page => page.url() === origin + '/article')?.screenshot({ path: join(out, 'failure.png') }); } catch {}
  throw error;
} finally {
  for (const release of slow.values()) release(); slow.clear();
  await writeFile(join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  await context?.close();
  await new Promise(done => server.close(done));
}
