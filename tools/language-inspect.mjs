import { chromium } from 'playwright';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

// A deliberately narrow real-network diagnostic. Only language metadata is
// retained; the player response, signed URLs and cookies are never serialized.
const root = resolve(import.meta.dirname, '..');
const out = join(root, 'output', 'online');
await mkdir(out, { recursive: true });
const profile = await mkdtemp(join(out, 'language-profile-'));
const extension = join(root, 'dist');
const context = await chromium.launchPersistentContext(profile, {
  executablePath: process.env.ASIDE_CHROMIUM_PATH || undefined,
  channel: 'chromium', headless: true,
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
});
const report = { date: new Date().toISOString(), scope: 'Allowlisted language and caption identifiers only; no signed URL, Cookie or media content.' };
try {
  const page = await context.newPage();
  const response = await page.goto('https://www.youtube.com/watch?v=aircAruvnKk', { waitUntil: 'domcontentloaded', timeout: 25000 });
  await page.waitForTimeout(2500);
  report.httpStatus = response?.status();
  report.metadata = await page.evaluate(() => {
    const player = document.querySelector('#movie_player');
    const data = player?.getPlayerResponse?.() || window.ytInitialPlayerResponse;
    const renderer = data?.captions?.playerCaptionsTracklistRenderer;
    const cleanAudio = audio => audio && Object.fromEntries([
      'audioTrackId', 'languageCode', 'isOriginal', 'audioIsOriginal', 'audioIsDefault',
      'isDefault', 'defaultCaptionTrackIndex', 'captionTrackIndices', 'hasDefaultTrack',
    ].filter(key => key in audio).map(key => [key, audio[key]]));
    let selectedCaption;
    try { selectedCaption = player?.getOption?.('captions', 'track'); } catch { /* Metadata may be replacing itself. */ }
    const streams = (data?.streamingData?.adaptiveFormats || []).filter(format => format.audioTrack).map(format => ({
      // Only a language-shaped stream ID may be recorded, never an opaque ID.
      languageId: /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*(?:\.\d+)?$/i.test(format.audioTrack.id) ? format.audioTrack.id : undefined,
      audioIsDefault: format.audioTrack.audioIsDefault,
      isOriginal: format.audioTrack.isOriginal,
    }));
    return {
      videoId: data?.videoDetails?.videoId, defaultAudioLanguage: data?.videoDetails?.defaultAudioLanguage,
      defaultAudioTrackIndex: renderer?.defaultAudioTrackIndex,
      audioTracks: renderer?.audioTracks?.map(cleanAudio),
      captionTracks: renderer?.captionTracks?.map((track, index) => ({ index, languageCode: track.languageCode, kind: track.kind, vssId: track.vssId })),
      selectedCaption: selectedCaption ? { languageCode: selectedCaption.languageCode, kind: selectedCaption.kind } : null,
      streamAudio: [...new Map(streams.map(track => [JSON.stringify(track), track])).values()],
    };
  });
} catch (error) { report.error = error.message.split('\n')[0]; }
finally {
  await writeFile(join(out, 'language-metadata.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await context.close();
}
if (report.error) process.exitCode = 1;
