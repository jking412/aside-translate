import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { parseJson3 } from '../src/shared/cues.js';
import { youtubeCueFixtures } from '../tests/youtube-cue-fixtures.mjs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { build } from 'esbuild';
import { mkdir, mkdtemp, cp, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createServer } from 'node:http';
const root = resolve(import.meta.dirname, '..');
const out = join(root, 'output', 'youtube-parity');
await mkdir(out, { recursive: true });
const originalArgument = process.argv.indexOf('--original');
if (originalArgument >= 0) {
  const path = process.argv[originalArgument + 1];
  if (!path || path.startsWith('--')) throw new Error('Usage: node tools/youtube-parity-test.mjs --original <absolute path to the supplied 1.34.4 extension>');
  await compareOriginal(resolve(path)); process.exit(0);
}
const extension = await mkdtemp(join(out, 'extension-'));
await cp(join(root, 'dist'), extension, { recursive: true });
await build({ entryPoints: [join(root, 'src/content/youtube-main.js')], outfile: join(extension, 'content/youtube-main.js'), bundle: true, format: 'iife', target: 'chrome120' });
await build({ stdin: { contents: `import { YoutubeSubtitles } from './src/content/youtube.js';
const controller = new YoutubeSubtitles({ translate: async (text, {signal} = {}) => { if(signal?.aborted) throw new DOMException('Aborted','AbortError'); const result = await chrome.runtime.sendMessage({type:'TRANSLATE',text});if(signal?.aborted)throw new DOMException('Aborted','AbortError');if(!result.ok)throw new Error(result.error);return result.text; } });
const apply = async () => {const settings = await chrome.storage.local.get(null);controller.setPreferences?.(settings);controller.setEnabled(settings.youtubeEnabled !== false);};chrome.storage.onChanged.addListener(apply);apply();`, resolveDir: root, sourcefile: 'youtube-harness.js' }, outfile: join(extension, 'content/index.js'), bundle: true, format: 'iife', target: 'chrome120' });
const manifest = JSON.parse(await readFile(join(extension, 'manifest.json'), 'utf8'));
// The functional check loads the same declared host permissions as shipping.
await writeFile(join(extension, 'manifest.json'), JSON.stringify(manifest));
const calls = [];
const server = createServer(async (req, res) => {
  let raw = ''; for await (const chunk of req) raw += chunk;
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }); res.end(); return; }
  const { q } = JSON.parse(raw); calls.push(q);
  res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
  res.end(JSON.stringify({ translatedText: '已配置服务：' + q }));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let context;
const report = { date: new Date().toISOString(), checks: [], source: 'Controlled native request fixture. Raw metadata URLs intentionally return empty; only the site-initiated XHR/fetch provides JSON3. A controlled media clock isolates the bridge; the main browser suite separately exercises a real HTMLVideoElement.', errors: [] };
try {
  context = await chromium.launchPersistentContext(await mkdtemp(join(out, 'profile-')), { channel: 'chromium', executablePath: process.env.ASIDE_CHROMIUM_PATH || undefined, headless: true, viewport: { width: 1100, height: 850 }, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(endpoint => chrome.storage.local.set({ service: 'libre', endpoint, youtubeEnabled: true, youtubeHumanPreferred: true, youtubePreTranslation: true }), `http://127.0.0.1:${server.address().port}/translate`);
  const track = id => id === 'native-spacing' ? { events: [{ tStartMs: 300, dDurationMs: 1100, segs: [
    { utf8: 'what', tOffsetMs: 0 }, { utf8: '\u200b', tOffsetMs: 80 },
    { utf8: 'you', tOffsetMs: 160 }, { utf8: ' can', tOffsetMs: 300 },
  ] }] } : ({ events: [
    { tStartMs: 300, dDurationMs: 1100, segs: [{ utf8: id === 'native-two' ? 'Fresh video sentence.' : 'Native first sentence.' }] },
    { tStartMs: 1400, dDurationMs: 1400, segs: [{ utf8: 'Native second sentence.' }] },
    { tStartMs: 3200, dDurationMs: 1800, segs: [{ utf8: 'Native final sentence.' }] },
    { tStartMs: 20000, dDurationMs: 2000, segs: [{ utf8: 'Future context sentence.' }] },
  ] });
  await context.route('https://www.youtube.com/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/timedtext') {
      if (url.searchParams.get('fmt') === 'srv3' && url.searchParams.get('native') === '1') return route.fulfill({ contentType: 'application/xml', body: '<timedtext><body><p t="300" d="1100"><s>XML native sentence.</s></p><p t="1400" d="1400"><s>XML second sentence.</s></p></body></timedtext>' });
      return route.fulfill({ contentType: 'application/json', body: url.searchParams.get('native') === '1' ? JSON.stringify(track(url.searchParams.get('v'))) : '' });
    }
    if (url.pathname !== '/watch') return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ contentType: 'text/html', body: `<!doctype html><meta charset="utf-8"><style>body{background:#eee;margin:20px;font:16px Arial}#movie_player{position:relative;width:640px;height:360px;background:#234}video{width:100%;height:100%}.ytp-right-controls{position:absolute;right:0;bottom:0}.ytp-caption-window-container{position:absolute;bottom:20px;color:white}</style><h1>Controlled native caption fixture</h1><div id="movie_player" class="html5-video-player ytp-autohide"><video></video><div class="ytp-caption-window-container"></div><div class="ytp-right-controls"><button class="ytp-subtitles-button" aria-pressed="false">CC</button></div></div><script>
const player=document.querySelector('#movie_player'),video=player.querySelector('video'),cc=player.querySelector('button');window.mediaTime=.7;window.clockOffset=0;window.transport='xhr';
Object.defineProperties(video,{currentTime:{get:()=>window.mediaTime,set:value=>{video.dispatchEvent(new Event('seeking'));window.mediaTime=value;video.dispatchEvent(new Event('seeked'));}},duration:{get:()=>100},paused:{get:()=>true},readyState:{get:()=>4},seeking:{get:()=>false}});
const id=()=>new URL(location.href).searchParams.get('v');
player.getCurrentTime=()=>video.currentTime+window.clockOffset;player.getDuration=()=>100;
player.getPlayerResponse=()=>({videoDetails:{videoId:id()},captions:{playerCaptionsTracklistRenderer:{defaultAudioTrackIndex:0,audioTracks:[{audioTrackId:'en.0'}],captionTracks:[{languageCode:'en',vssId:'.en',kind:id()==='native-spacing'?'asr':'',baseUrl:'https://www.youtube.com/api/timedtext?v='+id()+'&lang=en'}]}}});
player.getOption=()=>({languageCode:'en',vssId:'.en'});player.setOption=()=>{};
window.requestNative=()=>{const url='/api/timedtext?native=1&v='+id()+'&lang=en'+(id()==='native-spacing'?'&kind=asr':'')+'&fmt='+(window.transport==='xml'?'srv3':'json3');if(window.transport==='fetch')return fetch(url);const xhr=new XMLHttpRequest();xhr.open('GET',url);xhr.send();};
cc.onclick=()=>{const active=cc.getAttribute('aria-pressed')!=='true';cc.setAttribute('aria-pressed',String(active));if(active)requestNative();};
</script>` });
  });
  const page = await context.newPage();
  page.on('pageerror', error => report.errors.push(error.message));
  await page.goto('https://www.youtube.com/watch?v=native-one');
  await page.locator('.lt-youtube-overlay').getByText('Native first sentence.', { exact: true }).waitFor({ timeout: 7000 });
  await page.locator('.lt-youtube-overlay').getByText('已配置服务：Native first sentence.', { exact: true }).waitFor({ timeout: 7000 });
  assert.equal(await page.locator('.ytp-subtitles-button').getAttribute('aria-pressed'), 'true');
  report.checks.push('Automatic CC triggers the native XHR; its valid JSON3 is consumed even though metadata URL fetches are empty. The selected translation service supplies the target line.');
  await page.waitForFunction(() => document.querySelector('.lt-youtube-toggle'));
  const source = page.locator('.lt-youtube-overlay .source');
  assert.equal(await source.evaluate(element => parseFloat(getComputedStyle(element).fontSize)), 14);
  await page.locator('#movie_player').evaluate(element => { element.style.width = '1280px'; element.style.height = '720px'; });
  await page.waitForTimeout(200);
  assert.equal(await source.evaluate(element => parseFloat(getComputedStyle(element).fontSize)), 28);
  await page.screenshot({ path: join(out, 'native-bilingual.png') });
  assert.ok(calls.includes('Future context sentence.'), 'Prefetch reaches future sentence beyond a fixed twelve-second window');
  report.checks.push('Source/target use the observed 14/28px player scale; future sentences are prefetched through the chosen service.');
  await page.evaluate(() => { window.clockOffset = 1.1; });
  await page.locator('.lt-youtube-overlay').getByText('Native second sentence.', { exact: true }).waitFor({ timeout: 3000 });
  await page.evaluate(() => { window.clockOffset = 0; document.querySelector('video').currentTime = 5.5; });
  await page.waitForTimeout(100);
  assert.equal(await page.locator('.lt-youtube-overlay .source').textContent(), '');
  report.checks.push('Player clock takes precedence; a seek beyond the caption lifetime clears both rows.');
  await page.locator('.lt-youtube-toggle').click();
  await page.waitForFunction(() => !document.querySelector('.lt-youtube-overlay'));
  assert.equal(await page.locator('.lt-youtube-toggle').getAttribute('aria-pressed'), 'false');
  await page.locator('.lt-youtube-toggle').click();
  await page.waitForFunction(() => document.querySelector('.lt-youtube-overlay'));
  report.checks.push('The in-player switch disables the overlay and remains available to enable it again.');
  await page.evaluate(() => { document.dispatchEvent(new Event('yt-navigate-start')); history.pushState({}, '', '/watch?v=native-two'); window.transport = 'fetch'; window.mediaTime = .7; document.dispatchEvent(new Event('yt-navigate-finish')); });
  await page.locator('.lt-youtube-overlay').getByText('Fresh video sentence.', { exact: true }).waitFor({ timeout: 7000 });
  report.checks.push('Native fetch capture works after SPA video navigation and replaces the old source timeline.');
  await page.evaluate(() => { document.dispatchEvent(new Event('yt-navigate-start')); history.pushState({}, '', '/watch?v=native-xml'); window.transport = 'xml'; window.mediaTime = .7; document.dispatchEvent(new Event('yt-navigate-finish')); });
  await page.locator('.lt-youtube-overlay').getByText('XML native sentence.', { exact: true }).waitFor({ timeout: 7000 });
  await page.locator('.lt-youtube-overlay').getByText('已配置服务：XML native sentence.', { exact: true }).waitFor({ timeout: 7000 });
  report.checks.push('A native srv3 XML response is parsed inertly, timed and translated through the selected service.');
  await page.evaluate(() => { document.querySelector('video').currentTime = 5.5; });
  await page.waitForTimeout(100);
  assert.equal(await page.locator('#movie_player').getAttribute('data-lt-caption-owner'), null);
  report.checks.push('An empty/expired extension caption restores native caption visibility rather than hiding a failed native fallback.');
  await page.evaluate(() => { document.dispatchEvent(new Event('yt-navigate-start')); history.pushState({}, '', '/watch?v=native-spacing'); window.transport = 'xhr'; window.mediaTime = .7; document.dispatchEvent(new Event('yt-navigate-finish')); requestNative(); });
  await page.locator('.lt-youtube-overlay .source').filter({ hasText: /^what you can$/ }).waitFor({ timeout: 7000 });
  await page.locator('.lt-youtube-overlay .translation').filter({ hasText: /^已配置服务：what you can$/ }).waitFor({ timeout: 7000 });
  assert.ok(calls.includes('what you can'), 'The selected service receives visible word boundaries too');
  assert.equal(await page.locator('.lt-youtube-overlay .source').textContent(), 'what you can');
  report.checks.push('Native ASR zero-width separators become visible spaces in both the English row and the chosen-service request.');
  assert.deepEqual(report.errors, []);
  report.ok = true;
} catch (error) { report.ok = false; report.failure = error.message.split('\n')[0]; throw error; }
finally { await writeFile(join(out, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2)); await context?.close(); await new Promise(resolve => server.close(resolve)); }




async function compareOriginal(directory) {
  const bundle = await readFile(join(directory, 'content_main.js'), 'utf8');
  const sha256 = createHash('sha256').update(bundle).digest('hex');
  assert.equal(sha256, '26a5ab8126206ab45f260052c491657176814930b8d2e3edfd2605fa3280dc60', 'This optional extractor is audited only for the supplied 1.34.4 artifact.');
  const config = JSON.parse(await readFile(join(directory, 'default_config.json'), 'utf8'));
  const slice = (start, finish) => { const a = bundle.indexOf(start), b = bundle.indexOf(finish, a + start.length); assert.ok(a >= 0 && b > a, 'Packaged function boundary changed'); return bundle.slice(a, b); };
  const context = vm.createContext({ I: { debug() {}, error(message) { throw new Error(message); } }, config: config.generalRule.ytAsrConfig,
    document: { createElement() { return { set innerHTML(value) { assert.ok(!/[<&]/.test(value), 'Reference shim only admits plain text'); this.textContent = value; } }; } },
  });
  // Extract and execute the actual packaged pure functions in memory. No
  // proprietary implementation or config is copied into this repository.
  const reference = [slice('function dCe(', 'T();function gCe('), slice('function pCe(', 'pl();Se();'), slice('function lr(', 'function fdt('), slice('function D6e(', 'T();function _6e('), slice('function qhe(', 'function cn('),
    'const youtube = {' + slice('mergeSegsText(t){', 'mergeSelfSubtitle(t,n){') + '};',
    'function referenceCues(){ const words=kind==="asr"?dCe(events,lang,config):null; const items=words??P6e(youtube.mergeSegsText({events}).events,lang==="ja"?"":" ").map(row=>({start:row.tStartMs/1000,end:(row.tStartMs+row.dDurationMs)/1000,text:row.text}));return pCe({items,sourceLanguage:lang,config:{ja:7}}); }',
  ].join('\n');
  vm.runInContext(reference, context, { timeout: 2000 });
  const cases = [], intentionalTailCorrections = [];
  for (const fixture of youtubeCueFixtures) {
    Object.assign(context, { events: structuredClone(fixture.events), lang: fixture.language, kind: fixture.kind });
    const original = JSON.parse(JSON.stringify(vm.runInContext('referenceCues()', context, { timeout: 2000 })));
    const current = parseJson3({ events: fixture.events }, { language: fixture.language, kind: fixture.kind, preTranslation: true });
    assert.deepEqual(current, fixture.expected, fixture.name + ' independent expected behavior');
    assert.deepEqual(current.map(({end,...cue})=>cue), original.map(({end,...cue})=>cue), fixture.name + ' text and starts');
    for (let index = 0; index < current.length; index++) {
      if (current[index].end === original[index].end) continue;
      assert.ok(index === current.length - 1 && fixture.kind === 'asr' && fixture.language === 'en', 'Only the documented English ASR terminal lifetime correction may differ');
      assert.ok(current[index].end > original[index].end, 'The intentional correction extends a valid terminal event, never truncates it');
      intentionalTailCorrections.push({ name: fixture.name, cue: index, originalEnd: original[index].end, correctedEnd: current[index].end });
    }
    cases.push({ name: fixture.name, count: current.length, cues: current });
  }
  const endingProbes = [];
  for (const segs of [[{utf8:'Hello',tOffsetMs:0}],[{utf8:'Final',tOffsetMs:0},{utf8:' word',tOffsetMs:600}]]) {
    const events = [{tStartMs:1000,dDurationMs:2000,segs}];
    Object.assign(context,{events,lang:'en',kind:'asr'});
    const original = JSON.parse(JSON.stringify(vm.runInContext('referenceCues()',context,{timeout:2000})));
    const corrected = parseJson3({events},{language:'en',kind:'asr'});
    assert.equal(corrected[0].end,3);
    endingProbes.push({original,corrected});
  }
  const result = { endingProbes, date: new Date().toISOString(), originalVersion: '1.34.4', originalContentMainSha256: sha256, fixtures: cases.length,
    matchingTextAndStartCues: cases.reduce((sum, item) => sum + item.count, 0),
    completelyIdenticalCues: cases.reduce((sum, item) => sum + item.count, 0) - intentionalTailCorrections.length, intentionalTailCorrections, cases,
    scope: 'Actual released pure functions against independent synthetic public-format fixtures, with five explicitly reported valid terminal-duration repairs in a bounded VM with a plain-text DOM shim. No network, full player, cloud ASR or account behavior is inferred. Explicit --original only; CI requires no local proprietary artifact.' };
  await writeFile(join(out, 'original-cue-comparison.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}
