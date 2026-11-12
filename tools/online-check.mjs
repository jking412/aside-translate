import { chromium } from 'playwright';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

// This optional check uses the real network and a disposable browser profile.
// It never intercepts responses, imports user cookies or logs signed track URLs.
const root = resolve(import.meta.dirname, '..');
const out = join(root, 'output', 'online');
await mkdir(out, { recursive: true });
const profile = await mkdtemp(join(out, 'isolated-profile-'));
const extension = join(root, 'dist');
const context = await chromium.launchPersistentContext(profile, {
  channel: 'chromium', executablePath: process.env.ASIDE_CHROMIUM_PATH || undefined,
  headless: true, viewport: { width: 1200, height: 900 },
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--autoplay-policy=no-user-gesture-required'],
});
const report = {
  date: new Date().toISOString(), browser: context.browser()?.version(), translation: null, youtube: null,
  scope: 'Real network without interception. Disposable profile, synthetic Hello world and public video aircAruvnKk. No signed URL, Cookie or account data is recorded.',
};
try {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const extensionPage = await context.newPage();
  await extensionPage.goto(`chrome-extension://${new URL(worker.url()).hostname}/popup/index.html`);
  report.translation = await extensionPage.evaluate(() => chrome.runtime.sendMessage({ type: 'TRANSLATE', text: 'Hello world.' }));
  const page = await context.newPage();
  const timedtext = [];
  const bodyChecks = [];
  page.on('response', response => {
    const url = new URL(response.url());
    if (url.hostname.endsWith('youtube.com') && url.pathname === '/api/timedtext') {
      const entry = { status: response.status(), language: url.searchParams.get('lang'), format: url.searchParams.get('fmt') };
      timedtext.push(entry);
      bodyChecks.push(response.text().then(text => {
        entry.bodyCharacters = text.length;
        entry.nonWhitespaceCharacters = text.trim().length;
        try { entry.json3Events = JSON.parse(text)?.events?.length ?? null; }
        catch { entry.json3Events = null; }
      }).catch(() => { entry.bodyReadFailed = true; }));
    }
  });
  await page.addInitScript(() => {
    window.__asideOnlineEvidence = { replies: [], requests: {} };
    window.addEventListener('message', event => {
      const message = event.data;
      if (event.source !== window || message?.source !== 'light-translate') return;
      const evidence = window.__asideOnlineEvidence;
      if (message.kind === 'youtube-request') evidence.requests[message.id] = message.operation;
      if (message.kind === 'youtube-native-track') {
        const result = message.result;
        evidence.replies.push({operation:'nativeTrack', languageCode:result?.languageCode, translatedLanguage:result?.translatedLanguage, eventCount:result?.data?.events?.length, nonemptyEventCount:result?.data?.events?.filter(event=>event.segs?.some(segment=>segment?.utf8?.trim())).length});
      }
      if (message.kind === 'youtube-response') {
        const operation = evidence.requests[message.id] || 'unknown';
        if (operation === 'clock') { delete evidence.requests[message.id]; return; }
        const result = message.result;
        evidence.replies.push({ operation: evidence.requests[message.id] || 'unknown',
          error: typeof message.error === 'string' ? message.error.slice(0, 150) : undefined,
          sourceLanguage: typeof result?.sourceLanguage === 'string' ? result.sourceLanguage : undefined,
          tracks: Array.isArray(result?.tracks) ? result.tracks.map(track => ({ languageCode: track.languageCode, kind: track.kind })) : undefined,
          eventCount: Array.isArray(result?.events) ? result.events.length : undefined,
          nonemptyEventCount: Array.isArray(result?.events) ? result.events.filter(event => event.segs?.some(segment => segment?.utf8?.trim())).length : undefined,
        });
        delete evidence.requests[message.id];
      }
    });
  });
  try {
    const response = await page.goto('https://www.youtube.com/watch?v=aircAruvnKk', { waitUntil: 'domcontentloaded', timeout: 25000 });
    await page.waitForTimeout(4000);
    for (const name of [/Reject all/i, /全部拒绝|拒绝全部/]) {
      const consent = page.getByRole('button', { name, exact: true });
      if (await consent.count() && await consent.first().isVisible()) await consent.first().click({ timeout: 2000 }).catch(() => {});
    }
    await page.locator('video').first().waitFor({ timeout: 10000 });
    const video = page.locator('video').first();
    const playback = await video.evaluate(async element => {
      element.muted = true;
      try { await element.play(); return { requested: true }; }
      catch (error) { return { requested: false, error: error.name }; }
    });
    const cc = page.locator('.ytp-subtitles-button').first();
    let ccRequested = false;
    if (await cc.count() && await cc.isVisible() && await cc.getAttribute('aria-pressed') !== 'true') {
      await cc.click({ timeout: 2000 }).then(() => { ccRequested = true; }).catch(() => {});
    }
    const sample = () => page.evaluate(() => {
      const video = document.querySelector('video');
      const player = document.querySelector('#movie_player, .html5-video-player');
      const shadow = document.querySelector('.lt-youtube-overlay')?.shadowRoot;
      const source = shadow?.querySelector('.source');
      const target = shadow?.querySelector('.translation');
      return { wallTime: new Date().toISOString(), mediaTime: video?.currentTime ?? null,
        duration: Number.isFinite(video?.duration) ? video.duration : null, paused: video?.paused,
        readyState: video?.readyState, seeking: video?.seeking, adShowing: player?.classList.contains('ad-showing') || false,
        source: source?.textContent?.slice(0, 160) || '', translation: target?.textContent?.slice(0, 160) || '',
        nativeCaptionCharacters: [...document.querySelectorAll('.ytp-caption-segment')].reduce((sum, element) => sum + element.textContent.length, 0),
        fontSize: source ? parseFloat(getComputedStyle(source).fontSize) : null,
      };
    });
    const samples = [];
    for (let index = 0; index < 5; index++) { samples.push(await sample()); await page.waitForTimeout(1000); }
    const beforeSeek = await sample();
    const seek = await video.evaluate(element => {
      if (!(element.duration > 45)) return { attempted: false, reason: 'Media duration is unavailable or short' };
      const from = element.currentTime;
      element.currentTime = 30;
      return { attempted: true, from, requested: 30 };
    });
    const immediatelyAfterSeek = await sample();
    for (let index = 0; index < 7; index++) { await page.waitForTimeout(1000); samples.push(await sample()); }
    const sizes = [];
    for (const width of [640, 960]) {
      await page.locator('#movie_player, .html5-video-player').first().evaluate((element, width) => {
        element.style.width = `${width}px`; element.style.height = `${width * 9 / 16}px`;
      }, width);
      await page.waitForTimeout(250);
      sizes.push({ width, sample: await sample() });
      await page.screenshot({ path: join(out, `youtube-real-${width}.png`) });
    }
    const bridge = await page.evaluate(() => window.__asideOnlineEvidence?.replies || []);
    const nativeSucceeded = bridge.some(reply => reply.operation === 'nativeTrack' && reply.nonemptyEventCount > 0);
    const trackSucceeded = nativeSucceeded || bridge.some(reply => reply.operation === 'track' && reply.nonemptyEventCount > 0);
    const sourceVisible = samples.some(frame => frame.source);
    const bilingualVisible = samples.some(frame => frame.source && frame.translation);
    const progressed = samples.some(frame => !frame.paused && frame.mediaTime > (samples[0]?.mediaTime ?? 0) + 1);
    const mode = nativeSucceeded ? 'native player caption track captured' : trackSucceeded ? 'public JSON3 track fetched' : sourceVisible ? 'current native caption DOM fallback' : 'no visible extension caption in sample';
    await Promise.race([Promise.allSettled(bodyChecks), new Promise(resolve => setTimeout(resolve, 3000))]);
    report.youtube = { ok: progressed && bilingualVisible && seek.attempted, httpStatus: response?.status(), title: await page.title(), videoPresent: await video.count(), overlayPresent: await page.locator('.lt-youtube-overlay').count(),
      playback, ccRequested, progressed, sourceVisible, bilingualVisible, mode, timedtext, bridge, samples, beforeSeek, seek, immediatelyAfterSeek, sizes,
      limitation: 'A single real public VOD and a short sampled window cannot establish behavior across regions, advertisements, all languages or live streams. A 200 timedtext response alone is not treated as a valid track.',
    };
    await page.screenshot({ path: join(out, 'youtube-real.png') });
  } catch (error) {
    report.youtube = { ok: false, error: error.message.split('\n')[0], timedtext,
      limitation: 'Real YouTube playback/caption verification did not complete; no fixture is substituted.' };
  }
} finally {
  await writeFile(join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await context.close();
}
// Reachable video pages without visible bilingual captions fail this optional check.
if (!report.translation?.ok || !report.youtube?.ok) process.exitCode = 1;
