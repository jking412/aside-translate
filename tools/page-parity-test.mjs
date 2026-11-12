import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(import.meta.dirname, '..');
const target = '[data-aside-translation]';
export const PAGE_PARITY_FIXTURE = `<!doctype html><html lang="en"><style>
body{margin:24px;font:18px/1.6 Arial,sans-serif;max-width:680px}p{margin:18px 0}.later{margin-top:5000px}a{color:#0645ad}
</style><main><h1 id="short">Good morning everyone</h1><p id="sentence">Read <strong>the complete guide</strong> and <a id="guide" href="#read">learn more</a> before you begin this interesting journey.</p><p id="dynamic">This paragraph will be updated by the application.</p><pre id="code">const secret = 'keep original';</pre><code id="standalone-code">Do not translate code.</code><input id="input" value="Keep this input unchanged."><section class="later"><p id="later">This distant paragraph should wait until the reader scrolls nearby.</p></section></main></html>`;

export async function pageTranslatorBundle() {
  const result = await build({ stdin: { contents: "import { PageTranslator } from './src/content/page.js';globalThis.TestPageTranslator=PageTranslator;", resolveDir: root }, bundle: true, format: 'iife', write: false, target: 'chrome120' });
  return result.outputFiles[0].text;
}

/** Shared contract: intact source DOM, whole inline paragraphs and viewport scheduling. */
export async function testPageParity(context) {
  const page = await context.newPage();
  const results = [];
  try {
    await page.setViewportSize({ width: 1000, height: 720 });
    await page.setContent(PAGE_PARITY_FIXTURE);
    await page.addScriptTag({ content: await pageTranslatorBundle() });
    await page.evaluate(() => {
      globalThis.parityRequests = [];
      globalThis.sourceNodes = [...document.querySelector('#sentence').childNodes];
      globalThis.sourceText = document.querySelector('#sentence').textContent;
      globalThis.guideNode = document.querySelector('#guide');
      globalThis.clicks = 0;
      guideNode.addEventListener('click', event => { event.preventDefault(); clicks++; });
      globalThis.translator = new TestPageTranslator({ translate: async text => {
        parityRequests.push(text);
        if (text.startsWith('Read ')) return '请阅读<i1>完整指南</i1>，<i2>了解更多</i2>，然后开始这段有趣的旅程。';
        if (text.startsWith('This distant')) return '这段远处的文字应等读者滚动靠近再翻译。';
        return '中文译文。';
      } });
      translator.start();
    });
    await page.waitForFunction(() => !translator.status.busy);
    const measurement = await page.evaluate(() => ({
      sourcePreserved: sourceNodes.every(node => node.isConnected) && sourceNodes.map(node => node.textContent).join('') === sourceText,
      inlineRequests: parityRequests.filter(text => /Read |complete guide|learn more|journey/.test(text)),
      distantRequests: parityRequests.filter(text => text.startsWith('This distant')).length,
      targetCount: document.querySelectorAll('#sentence [data-aside-translation]').length,
      originalLink: document.querySelector('#guide') === guideNode,
    }));
    const failures = [];
    if (!measurement.sourcePreserved) failures.push('original source text must stay readable');
    if (measurement.inlineRequests.length !== 1 || !measurement.inlineRequests[0]?.includes('learn more')) failures.push('inline descendants must form one contextual paragraph request');
    if (measurement.targetCount !== 1) failures.push('one separate bilingual target must be inserted per paragraph');
    if (measurement.distantRequests !== 0) failures.push('offscreen paragraph must wait for viewport proximity');
    if (!measurement.originalLink) failures.push('original link identity must survive');
    console.log('PAGE_PARITY_MEASUREMENT', JSON.stringify(measurement));
    assert.deepEqual(failures, [], failures.join('; '));
    await page.locator('#guide').click();
    assert.equal(await page.evaluate(() => clicks), 1);
    assert.equal(await page.locator('#sentence > strong').textContent(), 'the complete guide');
    assert.equal(await page.locator('#sentence [data-aside-translation] strong').textContent(), '完整指南');
    assert.equal(await page.locator('#sentence [data-aside-translation] a').getAttribute('href'), '#read');
    assert.equal(await page.locator('#code').textContent(), "const secret = 'keep original';");
    assert.equal(await page.locator('#standalone-code').textContent(), 'Do not translate code.');
    assert.equal(await page.locator('#standalone-code + [data-aside-translation]').count(), 0);
    assert.equal(await page.locator('#input').inputValue(), 'Keep this input unchanged.');
    assert.equal(await page.evaluate(() => parityRequests.some(text => text.includes('Do not translate code.') || text.includes('Keep this input'))), false);
    results.push('intact source DOM/listeners, one inline paragraph request and one bilingual target');

    const layout = await page.evaluate(() => ({
      shortDisplay: getComputedStyle(document.querySelector('#short [data-aside-translation]')).display,
      blockDisplay: getComputedStyle(document.querySelector('#sentence [data-aside-translation]')).display,
    }));
    assert.equal(layout.shortDisplay, 'inline');
    assert.equal(layout.blockDisplay, 'block');
    await mkdir(join(root, 'output', 'page-parity'), { recursive: true });
    await page.screenshot({ path: join(root, 'output', 'page-parity', 'current.png') });
    results.push('short labels remain inline while long paragraphs receive a separate translated line');

    await page.locator('#later').scrollIntoViewIfNeeded();
    await page.waitForFunction(() => !!document.querySelector('#later [data-aside-translation]'));
    assert.equal(await page.evaluate(() => parityRequests.filter(text => text.startsWith('This distant')).length), 1);
    results.push('viewport lazy loading translates a distant paragraph once after scrolling');

    await page.evaluate(() => {
      document.querySelector('#dynamic').firstChild.data = 'Updated paragraph with a live inline ';
      const emphasis = document.createElement('strong'); emphasis.textContent = 'addition';
      document.querySelector('#dynamic').append(emphasis, document.createTextNode(' from the app.'));
      const fresh = document.createElement('p'); fresh.id = 'fresh'; fresh.textContent = 'New content inserted while translating.';
      document.querySelector('#dynamic').after(fresh);
    });
    await page.locator('#dynamic').scrollIntoViewIfNeeded();
    await page.waitForFunction(() => [...document.querySelectorAll('#dynamic [data-aside-translation]')].length === 1 && !!document.querySelector('#fresh [data-aside-translation]'));
    assert.equal(await page.evaluate(() => parityRequests.filter(text => text.startsWith('Updated paragraph')).length), 1);
    await page.evaluate(() => translator.restore());
    assert.equal(await page.locator(target).count(), 0);
    assert.equal(await page.locator('#dynamic').textContent(), 'Updated paragraph with a live inline addition from the app.');
    assert.equal(await page.locator('#sentence').textContent(), await page.evaluate(() => sourceText));
    await page.locator('#guide').click();
    assert.equal(await page.evaluate(() => clicks), 2);
    results.push('dynamic paragraphs regroup and restore removes only the extension-owned translation');

    const longHref = 'https://example.test/documentation?section=' + 'long-link-'.repeat(300);
    await page.setContent(`<nav><a href="#home">Home</a> <a href="#docs">Documentation</a></nav><p id="rich">这是中文介绍，阅读 <a id="long-link" href="${longHref}"><strong>the complete English reference</strong></a> before using the service.</p><p id="protected">Keep <code>dangerous()</code> safe.</p>`);
    await page.evaluate(() => {
      globalThis.richCalls = [];
      globalThis.richLink = document.querySelector('#long-link');
      globalThis.richClicks = 0;
      richLink.addEventListener('click', event => { event.preventDefault(); richClicks++; });
      globalThis.translator = new TestPageTranslator({ translate: async (text, options) => {
        richCalls.push({ text, format: options.format });
        return '中文：' + text;
      } });
      translator.start();
    });
    await page.waitForFunction(() => !translator.status.busy);
    assert.equal(await page.locator('nav [data-aside-translation]').count(), 2, 'navigation links are separate items, not one merged paragraph');
    assert.equal(await page.locator('#rich [data-aside-translation] a').getAttribute('href'), longHref);
    assert.equal(await page.locator('#rich [data-aside-translation] a strong').textContent(), 'the complete English reference');
    assert.equal(await page.locator('#protected [data-aside-translation] code').textContent(), 'dangerous()');
    assert.equal(await page.evaluate(() => richCalls.some(call => call.text.includes('dangerous()') || call.text.includes('https://example.test'))), false, 'protected code and link destinations are not sent as prose');
    assert.equal(await page.evaluate(() => richCalls.filter(call => call.text.startsWith('这是中文介绍')).length), 1, 'mixed Chinese/English content remains eligible');
    assert.equal(await page.evaluate(() => richCalls.every(call => call.format === 'html')), true);
    await page.locator('#long-link').click();
    assert.equal(await page.evaluate(() => richClicks), 1);
    await page.evaluate(() => document.querySelector('#long-link').setAttribute('href', 'https://example.test/updated'));
    await page.waitForFunction(() => document.querySelector('#rich [data-aside-translation] a')?.getAttribute('href') === 'https://example.test/updated');
    await page.evaluate(() => translator.restore());
    assert.equal(await page.locator(target).count(), 0);
    assert.equal(await page.evaluate(() => document.querySelector('#long-link') === richLink), true);
    results.push('mixed prose, long link destinations, nested emphasis, protected inline code and navigation retain their roles');

    await page.setContent('<p id="unsafe"><strong>Unsafe translation sample.</strong></p><p id="missing"><a href="#missing">Missing marker sample.</a></p><p id="encoded"><em>Encoded marker sample.</em></p><p id="duplicate"><b>Duplicate marker sample.</b></p><p id="nested"><a href="#nested"><strong>Nested marker sample.</strong></a></p>');
    const remoteRequests = [];
    const catchRemote = route => { remoteRequests.push(route.request().url()); return route.abort(); };
    await page.route('https://untrusted.invalid/**', catchRemote);
    await page.evaluate(() => {
      globalThis.executedTranslation = false;
      globalThis.translator = new TestPageTranslator({ translate: async text => {
        if (text.includes('Unsafe')) return '<i1 onclick="executedTranslation=true">安全文本</i1><img src="https://untrusted.invalid/leak" onerror="executedTranslation=true"><script>executedTranslation=true</script>';
        if (text.includes('Missing')) return '丢失标记仍可显示中文。';
        if (text.includes('Encoded')) return '&lt;i1&gt;编码标记译文。&lt;/i1&gt;';
        if (text.includes('Duplicate')) return '<i1>重复一</i1><i1>重复二</i1>';
        return '<i1>错误外层<i2>错误内层</i2></i1>';
      } });
      translator.start();
    });
    await page.waitForFunction(() => !translator.status.busy);
    assert.equal(await page.locator('[data-aside-translation] img,[data-aside-translation] script,[data-aside-translation] [onclick]').count(), 0);
    assert.equal(await page.evaluate(() => executedTranslation), false);
    assert.deepEqual(remoteRequests, [], 'remote markup cannot initiate any resource requests');
    assert.equal(await page.locator('#encoded [data-aside-translation] em').textContent(), '编码标记译文。');
    assert.equal(await page.locator('#missing [data-aside-translation]').textContent(), '丢失标记仍可显示中文。');
    assert.equal(await page.locator('#duplicate [data-aside-translation] b').count(), 0);
    assert.equal(await page.locator('#nested [data-aside-translation] a').count(), 0);
    assert.equal(await page.locator('[data-aside-translation]').allTextContents().then(texts => texts.some(text => /<\/?i\d+>|ASIDE_KEEP_/.test(text))), false);
    await page.evaluate(() => translator.restore());
    await page.unroute('https://untrusted.invalid/**', catchRemote);
    results.push('invalid, missing, duplicated and encoded markers degrade safely without executable DOM or network requests');

    await page.setContent('<p id="old-body">Initial application body.</p>');
    await page.evaluate(() => {
      globalThis.translator = new TestPageTranslator({ translate: async () => '网页应用译文。' });
      translator.start();
    });
    await page.waitForFunction(() => !!document.querySelector('#old-body [data-aside-translation]'));
    await page.evaluate(() => {
      const body = document.createElement('body');
      const paragraph = document.createElement('p'); paragraph.id = 'new-body'; paragraph.textContent = 'Replacement application body.';
      body.append(paragraph); document.body.replaceWith(body);
    });
    await page.waitForFunction(() => !!document.querySelector('#new-body [data-aside-translation]'));
    await page.evaluate(() => translator.restore());
    assert.equal(await page.locator('#new-body').textContent(), 'Replacement application body.');
    assert.equal(await page.locator(target).count(), 0);
    results.push('replacing the application body keeps dynamic translation and restore working');

    await page.setContent('<p id="comparison">Comparison: a &lt; b and b &gt; c.</p><p id="generic">Understand Map&lt;T&gt; and Promise&lt;Result&gt;.</p><p id="literal">Discuss script and image tag syntax.</p>');
    remoteRequests.length = 0;
    await page.route('https://untrusted.invalid/**', catchRemote);
    await page.evaluate(() => {
      globalThis.executedLiteral = false;
      globalThis.translator = new TestPageTranslator({ translate: async text => {
        if (text.startsWith('Comparison:')) return '比较 a < b 且 b > c。';
        if (text.startsWith('Understand')) return '理解 Map<T> 和 Promise<Result>。';
        return '示例 <script>globalThis.executedLiteral=true</script> <img src="https://untrusted.invalid/literal"> 都是文字。';
      } });
      translator.start();
    });
    await page.waitForFunction(() => !translator.status.busy);
    assert.equal(await page.locator('#comparison [data-aside-translation]').textContent(), '比较 a < b 且 b > c。');
    assert.equal(await page.locator('#generic [data-aside-translation]').textContent(), '理解 Map<T> 和 Promise<Result>。');
    assert.equal(await page.locator('#literal [data-aside-translation]').textContent(), '示例 <script>globalThis.executedLiteral=true</script> <img src="https://untrusted.invalid/literal"> 都是文字。');
    assert.equal(await page.locator('[data-aside-translation] script,[data-aside-translation] img').count(), 0);
    assert.equal(await page.evaluate(() => executedLiteral), false);
    assert.deepEqual(remoteRequests, []);
    await page.evaluate(() => translator.restore());
    await page.unroute('https://untrusted.invalid/**', catchRemote);
    results.push('plain comparisons, generic types and literal HTML syntax remain readable text without execution or requests');
    return results;
  } finally { await page.close(); }
}


/** Observe the actual 1.34.4 package in a disposable copy; never load its source directory. */
export async function compareOriginalPage() {
  const reference = process.env.ASIDE_ORIGINAL_EXTENSION;
  if (!reference) throw new Error('Set ASIDE_ORIGINAL_EXTENSION to your local reference extension directory.');
  const output = join(root, 'output', 'page-parity');
  const run = Date.now();
  const copy = join(output, `original-extension-${run}`);
  const profile = join(output, `original-profile-${run}`);
  await mkdir(output, { recursive: true });
  const mainBefore = await readFile(join(reference, 'content_main.js'));
  const identity = createHash('sha256').update(mainBefore).digest('hex');
  await cp(reference, copy, { recursive: true });
  const requests = [];
  let blockedConnections = 0;
  const translate = text => {
    let result = text;
    for (const [from, to] of [
      ['Good morning everyone', '大家早上好'], ['Read ', '请阅读'], ['the complete guide', '完整指南'], [' and ', '，'], ['learn more', '了解更多'],
      ['before you begin this interesting journey.', '然后开始这段有趣的旅程。'],
      ['This paragraph will be updated by the application.', '这一段将由网页应用更新。'],
      ['This distant paragraph should wait until the reader scrolls nearby.', '这段远处的文字应等读者滚动靠近再翻译。'],
    ]) result = result.replaceAll(from, to);
    return result === text ? '中文译文：' + result : result;
  };
  const server = createServer(async (req, res) => {
    if (req.url === '/article.html') return res.writeHead(200, { 'content-type': 'text/html;charset=utf-8' }).end(PAGE_PARITY_FIXTURE);
    if (req.url === '/favicon.ico') return res.writeHead(204).end();
    if (req.url !== '/translate') { blockedConnections++; return res.writeHead(403).end(); }
    if (req.method === 'OPTIONS') return res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }).end();
    let raw = ''; for await (const part of req) raw += part;
    const body = raw ? JSON.parse(raw) : {};
    const texts = Array.isArray(body.text_list) ? body.text_list : [body.text_list || ''];
    requests.push(...texts);
    res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }).end(JSON.stringify({ translations: texts.map(text => ({ text: translate(text) })) }));
  });
  server.on('connect', (_req, socket) => { blockedConnections++; socket.destroy(); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, {
      channel: 'chromium', headless: true, executablePath: process.env.ASIDE_CHROMIUM_PATH || undefined,
      viewport: { width: 1000, height: 720 }, locale: 'zh-CN',
      args: [`--disable-extensions-except=${copy}`, `--load-extension=${copy}`, '--no-first-run', `--proxy-server=${base}`],
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const id = new URL(worker.url()).host;
    const control = await context.newPage();
    await control.goto(`chrome-extension://${id}/popup.html`);
    const settingsReply = await control.evaluate(async endpoint => chrome.runtime.sendMessage({ from: 'options:main', to: 'background:main', payload: { method: 'setUserConfig', data: {
      translationService: 'custom', targetLanguage: 'zh-CN', cache: false, enabled: true,
      translationServices: { custom: { url: endpoint, langs: 'zh-CN,en', limitPerSecond: 20, maxTextLengthPerRequest: 4000, maxTextGroupLengthPerRequest: 10 } },
    } } }), base + '/translate');
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.goto(base + '/article.html');
    await page.evaluate(() => {
      globalThis.originalSourceNodes = [...document.querySelector('#sentence').childNodes];
      globalThis.originalSourceText = document.querySelector('#sentence').textContent;
      globalThis.originalGuide = document.querySelector('#guide');
      globalThis.originalClicks = 0;
      originalGuide.addEventListener('click', event => { event.preventDefault(); originalClicks++; });
    });
    const action = method => worker.evaluate(async ({ url, method }) => {
      const tab = (await chrome.tabs.query({})).find(item => item.url === url);
      return chrome.tabs.sendMessage(tab.id, { from: 'popup:main', to: 'content:main', payload: { method, data: {} } }, { frameId: 0 });
    }, { url: base + '/article.html', method });
    let ready = false;
    for (let i = 0; i < 30 && !ready; i++) {
      try { await action('getPageStatus'); ready = true; } catch { await page.waitForTimeout(100); }
    }
    await action('translateTheWholePage');
    let translated = true;
    try { await page.waitForSelector('#sentence .immersive-translate-target-wrapper', { timeout: 15000 }); } catch { translated = false; }
    await page.waitForTimeout(800);
    const beforeScroll = await page.evaluate(() => {
      const targetFor = selector => document.querySelector(selector + ' .immersive-translate-target-wrapper');
      const source = document.querySelector('#sentence').cloneNode(true);
      source.querySelectorAll('.immersive-translate-target-wrapper').forEach(node => node.remove());
      return {
        sourcePreserved: originalSourceNodes.every(node => node.isConnected) && originalSourceNodes.map(node => node.textContent).join('') === originalSourceText,
        sourceText: source.textContent, sourceNodeCount: originalSourceNodes.length,
        linkIdentity: document.querySelector('#guide') === originalGuide,
        shortTarget: targetFor('#short')?.outerHTML || '', blockTarget: targetFor('#sentence')?.outerHTML || '',
        shortDisplay: targetFor('#short') ? getComputedStyle(targetFor('#short').querySelector('.immersive-translate-target-translation-inline-wrapper') || targetFor('#short')).display : '',
        blockDisplay: targetFor('#sentence') ? getComputedStyle(targetFor('#sentence').querySelector('.immersive-translate-target-translation-block-wrapper') || targetFor('#sentence')).display : '',
        shortSourceHTML: document.querySelector('#short').outerHTML, laterSourceHTML: document.querySelector('#later').outerHTML,
        distantHasTarget: !!targetFor('#later'), htmlState: document.documentElement.getAttribute('imt-state'),
      };
    });
    await page.screenshot({ path: join(output, 'original.png') });
    const requestsBeforeScroll = [...requests];
    await page.locator('#guide').click();
    await page.locator('#later').scrollIntoViewIfNeeded();
    await page.waitForTimeout(2500);
    const distantAfterScroll = await page.locator('#later .immersive-translate-target-wrapper').count();
    await action('restorePage');
    await page.waitForTimeout(100);
    const restored = await page.evaluate(() => ({
      text: document.querySelector('#sentence').textContent,
      targetCount: document.querySelectorAll('.immersive-translate-target-wrapper').length,
      linkIdentity: document.querySelector('#guide') === originalGuide,
      clicks: originalClicks,
    }));
    const unchanged = createHash('sha256').update(await readFile(join(reference, 'content_main.js'))).digest('hex') === identity;
    const report = { scope: 'Actual shipped 1.34.4 code; local synthetic HTML and translation endpoint; outbound remote connections blocked. Renderer/scheduling comparison, not online translation quality.',
      manifestVersion: JSON.parse(await readFile(join(reference, 'manifest.json'), 'utf8')).version, mainSha256: identity, referenceMainUnchanged: unchanged,
      fixtureSha256: createHash('sha256').update(PAGE_PARITY_FIXTURE).digest('hex'),
      browser: context.browser()?.version(), translated, settingsReply: settingsReply === undefined ? 'undefined' : typeof settingsReply,
      requestsBeforeScroll, requestsAfterScroll: requests, beforeScroll, distantAfterScroll, restored, pageErrors, blockedConnections,
    };
    await writeFile(join(output, 'original.json'), JSON.stringify(report, null, 2) + '\n');
    console.log('ORIGINAL_PAGE_PARITY', JSON.stringify(report));
    assert.equal(translated, true, 'original package must actually produce a target before comparing its renderer');
    assert.equal(unchanged, true);
    return report;
  } finally {
    await context?.close();
    await new Promise(resolve => server.close(resolve));
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--original')) await compareOriginalPage();
  else {
    const browser = await chromium.launch({ headless: true, ...(process.env.ASIDE_CHROMIUM_PATH ? { executablePath: process.env.ASIDE_CHROMIUM_PATH } : {}) });
    try {
      console.log('BROWSER', browser.version());
      const results = await testPageParity(await browser.newContext());
      for (const result of results) console.log('PASS', result);
      await mkdir(join(root, 'output', 'page-parity'), { recursive: true });
      await writeFile(join(root, 'output', 'page-parity', 'current.json'), JSON.stringify({ browser: browser.version(), fixtureSha256: createHash('sha256').update(PAGE_PARITY_FIXTURE).digest('hex'), results }, null, 2) + '\n');
    } finally { await browser.close(); }
  }
}
