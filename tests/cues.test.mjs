import { youtubeCueFixtures } from './youtube-cue-fixtures.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseJson3, cueIndexAt, alignedTranslation, CueTimeline, selectCaptionTracks, sourceAudioLanguage } from '../src/shared/cues.js';
import { YoutubeSubtitles } from '../src/content/youtube.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; let reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const source = [ { start: 0, end: 1, text: 'first' }, { start: 1, end: 2, text: 'second' }, { start: 3, end: 4, text: 'last' } ];

test('JSON3 retains authored boundaries, ignores rolling append, and joins simultaneous voices', () => {
  assert.deepEqual(parseJson3({ events: [
    { tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: 'Hello &amp; welcome' }] },
    { tStartMs: 1000, dDurationMs: 1000, segs: [{ utf8: 'Next' }] },
    { tStartMs: 1500, dDurationMs: 1000, aAppend: 1, segs: [{ utf8: ' words.' }] },
    { tStartMs: 2000, segs: [{ utf8: '\n' }] },
    { tStartMs: 3000, dDurationMs: 2000, segs: [{ utf8: 'Two' }] },
    { tStartMs: 3000, dDurationMs: 2000, segs: [{ utf8: 'voices' }] },
  ] }), [
    { start: 0, end: 1, text: 'Hello & welcome' },
    { start: 1, end: 2, text: 'Next' },
    { start: 3, end: 5, text: 'Two voices' },
  ]);
});

test('JSON3 rejects unknown format and filters invalid timing', () => {
  assert.throws(() => parseJson3({ captions: [] }), /events/);
  assert.deepEqual(parseJson3({ events: [{ tStartMs: -1, segs: [{ utf8: 'invalid' }] }, { tStartMs: 0, dDurationMs: 3000, segs: [{ utf8: 'safe <text> &#x4e2d;' }] }] }), [{ start: 0, end: 3, text: 'safe <text> 中' }]);
});

test('cue boundaries are half-open and gaps/invalid clocks stay empty', () => {
  assert.equal(cueIndexAt(source, -1), -1);
  assert.equal(cueIndexAt(source, 0), 0);
  assert.equal(cueIndexAt(source, 0.999), 0);
  assert.equal(cueIndexAt(source, 1), 1);
  assert.equal(cueIndexAt(source, 2), -1);
  assert.equal(cueIndexAt(source, 2.9), -1);
  assert.equal(cueIndexAt(source, 4), -1);
  assert.equal(cueIndexAt(source, NaN), -1);
});

test('manual target alignment follows overlapping authored groups and excludes adjacent times', () => {
  assert.equal(alignedTranslation(source[1], [{ start: 1.05, end: 2.1, text: '第二句' }]), '第二句');
  assert.equal(alignedTranslation(source[1], [{ start: 0, end: 3, text: '合并的人工句' }]), '合并的人工句');
  assert.equal(alignedTranslation(source[1], [{ start: 2.5, end: 3, text: '相邻句' }]), '');
});

test('late translations never replay expired cues', async () => {
  const jobs = [];
  const timeline = new CueTimeline(text => { const job = deferred(); jobs.push({ ...job, text }); return job.promise; });
  timeline.reset(source);
  assert.equal(timeline.frame(0.5).text, 'first');
  await tick();
  assert.equal(jobs.length, 2, 'bounded prefetch only permits two requests');
  jobs[0].resolve('第一句'); await tick();
  assert.equal(timeline.frame(2.5), null, 'translation completing after expiry does not draw');
  assert.equal(timeline.frame(0.5).translation, '第一句', 'completed same-video data can be reused on seek');
});

test('seeking cancels pending work; an old finally cannot delete replacement work', async () => {
  const jobs = [];
  const timeline = new CueTimeline((text, options) => { const job = deferred(); jobs.push({ ...job, text, signal: options.signal }); return job.promise; });
  timeline.reset(source); timeline.frame(0.5); await tick();
  timeline.invalidatePending();
  assert.equal(jobs[0].signal.aborted, true);
  timeline.frame(1.5); await tick();
  const replacement = timeline.pending.get(1);
  jobs[1].resolve('旧请求译文'); await tick();
  assert.equal(timeline.pending.get(1), replacement);
  assert.equal(timeline.frame(1.5).translation, '');
  jobs.find((job, index) => index > 1 && job.text === 'second').resolve('第二句'); await tick();
  assert.equal(timeline.frame(1.5).translation, '第二句');
});

test('switching video discards old-video completion even at the same cue index', async () => {
  const jobs = [];
  const timeline = new CueTimeline(() => { const job = deferred(); jobs.push(job); return job.promise; });
  timeline.reset([source[0]]); timeline.frame(0.5); await tick();
  timeline.reset([{ start: 0, end: 1, text: 'new video' }]); timeline.frame(0.5); await tick();
  jobs[0].resolve('旧视频'); await tick();
  assert.equal(timeline.frame(0.5).translation, '');
  jobs[1].resolve('新视频'); await tick();
  assert.equal(timeline.frame(0.5).translation, '新视频');
});

function domController() {
  const jobs = [];
  const controller = new YoutubeSubtitles({ translate: (text, options) => { const job = deferred(); jobs.push({ ...job, text, signal: options.signal }); return job.promise; } });
  controller.enabled = true;
  controller.player = { classList: { contains: () => false } };
  controller.video = { currentTime: 0, seeking: false };
  controller.text = 'old source';
  controller.domText = () => controller.text;
  controller.render = (text, translation) => { controller.drawn = { text, translation }; };
  return { controller, jobs };
}

test('DOM fallback validates current native text when a slow translation completes', async () => {
  const { controller, jobs } = domController();
  controller.frame(); await tick();
  controller.text = 'new source';
  jobs[0].resolve('过期译文'); await tick();
  assert.equal(controller.domTranslation, '');
  controller.frame(); await tick();
  assert.deepEqual(controller.drawn, { text: 'new source', translation: '' });
  jobs[1].resolve('新译文'); await tick(); controller.frame();
  assert.deepEqual(controller.drawn, { text: 'new source', translation: '新译文' });
});

test('DOM fallback clears immediately on seek and blocks unchanged stale native text', async () => {
  const { controller, jobs } = domController();
  controller.frame(); await tick();
  controller.onSeeking();
  assert.equal(jobs[0].signal.aborted, true);
  assert.deepEqual(controller.drawn, { text: '', translation: '' });
  jobs[0].resolve('不得补播'); await tick();
  controller.onSeeked();
  assert.deepEqual(controller.drawn, { text: '', translation: '' });
  controller.text = 'after seek'; controller.frame(); await tick();
  jobs[1].resolve('拖动后'); await tick(); controller.frame();
  assert.deepEqual(controller.drawn, { text: 'after seek', translation: '拖动后' });
});

test('DOM fallback clears and ignores completion after a video reset', async () => {
  const { controller, jobs } = domController();
  controller.frame(); await tick(); controller.reset();
  jobs[0].resolve('旧视频译文'); await tick();
  assert.deepEqual(controller.drawn, { text: '', translation: '' });
  assert.equal(controller.domTranslation, '');
});


test('source language selection ignores a language-sorted first track and prefers manual original speech', () => {
  const tracks = [
    { index: 0, languageCode: 'ar', kind: '' },
    { index: 1, languageCode: 'de', kind: '' },
    { index: 2, languageCode: 'en', kind: '' },
    { index: 3, languageCode: 'en', kind: 'asr' },
    { index: 4, languageCode: 'zh-TW', kind: '' },
    { index: 5, languageCode: 'zh-CN', kind: '' },
  ];
  assert.equal(selectCaptionTracks(tracks, 'en').source.index, 2);
  assert.equal(selectCaptionTracks(tracks, 'de-DE').source.index, 1);
  assert.equal(selectCaptionTracks(tracks).source.index, 2);
  assert.equal(selectCaptionTracks(tracks).target.index, 5);
  assert.equal(selectCaptionTracks(tracks, 'zh').source.index, 4);
  assert.equal(selectCaptionTracks([null, {}]).source, undefined);
});


test('real player shape: Chinese caption preference never overrides en-US.4 audio', () => {
  const tracks = [
    { languageCode: 'ar' }, { languageCode: 'en' }, { languageCode: 'en', kind: 'asr' }, { languageCode: 'zh-CN' },
  ];
  const response = { captions: { playerCaptionsTracklistRenderer: {
    captionTracks: tracks, defaultAudioTrackIndex: 0,
    audioTracks: [{ audioTrackId: 'en-US.4', defaultCaptionTrackIndex: 3 }, { audioTrackId: 'fr.3', defaultCaptionTrackIndex: 3 }],
  } } };
  assert.equal(sourceAudioLanguage(response), 'en-US');
  assert.equal(selectCaptionTracks(tracks.map((track, index) => ({ ...track, index })), sourceAudioLanguage(response)).source.index, 1);
});

test('unrecognized audio identifiers use English fallback without guessing from captions', () => {
  const response = { captions: { playerCaptionsTracklistRenderer: {
    defaultAudioTrackIndex: 0, audioTracks: [{ audioTrackId: '251;opaque-player-id', defaultCaptionTrackIndex: 0 }],
    captionTracks: [{ languageCode: 'zh-CN' }, { languageCode: 'en' }],
  } } };
  assert.equal(sourceAudioLanguage(response), '');
  assert.equal(selectCaptionTracks([{ index: 0, languageCode: 'zh-CN' }, { index: 1, languageCode: 'en' }], sourceAudioLanguage(response)).source.index, 1);
});

test('explicit original audio outranks a different default dub; stream default is a language fallback', () => {
  const response = { captions: { playerCaptionsTracklistRenderer: {
    defaultAudioTrackIndex: 0, audioTracks: [{ audioTrackId: 'zh-CN.3' }, { audioTrackId: 'fr.4', isOriginal: true }],
  } } };
  assert.equal(sourceAudioLanguage(response), 'fr');
  assert.equal(sourceAudioLanguage({ streamingData: { adaptiveFormats: [{ audioTrack: { id: 'en-US.4', audioIsDefault: true } }] } }), 'en-US');
  assert.equal(sourceAudioLanguage({}), '');
});

test('word-timed English ASR splits at a spoken pause rather than one rolling event', () => {
  const events = [{ tStartMs: 1000, dDurationMs: 5000, segs: [
    ['We', 0], [' can', 200], [' start', 400], [' now', 700], [' and', 2300], [' keep', 2600], [' going', 3000],
  ].map(([utf8, tOffsetMs]) => ({ utf8, tOffsetMs })) }];
  const cues = parseJson3({ events }, { language: 'en', kind: 'asr', preTranslation: true });
  assert.equal(cues.length, 2);
  assert.equal(cues[0].text.trim(), 'we can start now');
  assert.equal(cues[1].start, 3.3);
  assert.equal(parseJson3({ events }, { language: 'en', kind: 'asr', preTranslation: false }).length, 1);
});

test('caption source and target share original player-relative default sizes', async () => {
  const { captionFontPixels } = await import('../src/shared/cues.js');
  assert.equal(typeof captionFontPixels, 'function');
  assert.equal(captionFontPixels(640, 360), 14);
  assert.equal(captionFontPixels(1280, 720), 28);
  assert.ok(captionFontPixels(360, 640) >= 14);
});



test('human preference defaults on, while disabling it clears cache and uses the configured service', async () => {
  const calls = [];
  const controller = new YoutubeSubtitles({ translate: async text => { calls.push(text); return '服务译文'; } });
  controller.targets = [{ start: 0, end: 1, text: '人工译文' }];
  controller.timeline.reset([source[0]]); controller.timeline.frame(.5); await tick();
  assert.equal(controller.timeline.frame(.5).translation, '人工译文');
  assert.deepEqual(calls, []);
  controller.setPreferences({ youtubeHumanPreferred: false });
  controller.timeline.frame(.5); await tick();
  assert.equal(controller.timeline.frame(.5).translation, '服务译文');
  assert.deepEqual(calls, ['first']);
});

test('a Chinese ASR or machine target is not accepted as a human source translation', () => {
  const controller = new YoutubeSubtitles({ translate: async () => 'service' });
  controller.enabled = true; controller.id = 'current'; controller.sourceTrack = { languageCode: 'en' }; controller.frame = () => {};
  const data = { events: [{ tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: '中文目标' }] }] };
  controller.nativeTrack({ videoId: 'current', languageCode: 'zh-CN', kind: 'asr', data });
  assert.equal(controller.targets.length, 0);
  controller.nativeTrack({ videoId: 'current', languageCode: 'en', translatedLanguage: 'zh-CN', data });
  assert.equal(controller.targets.length, 0);
  controller.nativeTrack({ videoId: 'previous', languageCode: 'zh-CN', kind: '', data });
  assert.equal(controller.targets.length, 0);
  controller.nativeTrack({ videoId: 'current', languageCode: 'zh-CN', kind: '', data });
  assert.equal(controller.targets[0].text, '中文目标');
});

test('ordinary human overlap joins the same spoken group and ignores appended roll-up text', () => {
  const events = [
    { tStartMs: 1000, dDurationMs: 90000, segs: [{ utf8: 'First' }] },
    { tStartMs: 4000, dDurationMs: 2000, segs: [{ utf8: 'Second' }] },
    { tStartMs: 4000, dDurationMs: 2000, segs: [{ utf8: 'Second' }] },
    { tStartMs: 5100, dDurationMs: 900, segs: [{ utf8: 'speaker' }] },
    { tStartMs: 5400, dDurationMs: 300, aAppend: 1, segs: [{ utf8: 'roll-up' }] },
  ];
  assert.deepEqual(parseJson3({ events }, { language: 'en' }), [{ start: 1, end: 4, text: 'First' }, { start: 4, end: 6, text: 'Second speaker' }]);
});


for (const fixture of youtubeCueFixtures) test(`public-format fixture: ${fixture.name}`, () => {
  assert.deepEqual(parseJson3({ events: fixture.events }, { language: fixture.language, kind: fixture.kind, preTranslation: true }), fixture.expected);
});

test('a one-word ASR ending remains visible through its valid platform duration', () => {
  const cues = parseJson3({ events: [{ tStartMs: 1000, dDurationMs: 2000, segs: [{ utf8: 'Hello', tOffsetMs: 0 }] }] }, { language: 'en', kind: 'asr' });
  assert.deepEqual(cues, [{ start: 1, end: 3, text: 'hello' }]);
  assert.equal(cueIndexAt(cues, 2), 0);
});

test('the final ASR phrase ends at its event end instead of the beginning of its last word', () => {
  const cues = parseJson3({ events: [{ tStartMs: 1000, dDurationMs: 2000, segs: [{ utf8: 'Final', tOffsetMs: 0 }, { utf8: ' word', tOffsetMs: 600 }] }] }, { language: 'en', kind: 'asr' });
  assert.equal(cues.at(-1).end, 3);
  assert.equal(cueIndexAt(cues, 2), 0);
});

test('player clock projection uses two-times and half-times playback speed', () => {
  const controller = new YoutubeSubtitles({ translate: async text => text });
  controller.id = 'rate-video'; controller.video = { currentTime: 20, paused: false, playbackRate: 2 };
  controller.clock = { videoId: 'rate-video', time: 10, at: 1000, paused: false, rate: 2 };
  assert.equal(controller.mediaTime(1250), 10.5);
  controller.video.playbackRate = .5; controller.clock.rate = .5;
  assert.equal(controller.mediaTime(1250), 10.125);
});

test('changing playback speed invalidates a clock sample and requests a fresh one', () => {
  const controller = new YoutubeSubtitles({ translate: async text => text });
  controller.enabled = true; controller.video = { seeking: false }; controller.clock = { time: 2 }; controller.nextClockAt = Infinity;
  let requests = 0; controller.updateClock = () => { requests++; };
  controller.onRateChange();
  assert.equal(controller.clock, null);
  assert.equal(controller.nextClockAt, 0);
  assert.equal(requests, 1);
});

test('a delayed pre-seek clock cannot replace the new media time or playback speed', async () => {
  const controller = new YoutubeSubtitles({ translate: async text => text });
  const job = deferred();
  controller.enabled = true; controller.id = 'clock-video'; controller.video = { paused: false, currentTime: 20, playbackRate: 2 };
  controller.request = () => job.promise;
  controller.clearClock(); controller.updateClock();
  controller.onSeeking();
  job.resolve({ time: 1, paused: false, rate: 1 }); await tick();
  assert.equal(controller.clock, null);
  assert.equal(controller.mediaTime(), 20);
});

test('turning off pre-translation requests only the currently visible cue, never future cues or gaps', async () => {
  const calls = [];
  const controller = new YoutubeSubtitles({ translate: async text => { calls.push(text); return '译文'; } });
  controller.setPreferences({ youtubePreTranslation: false });
  controller.timeline.reset(source);
  controller.timeline.frame(-1); await tick();
  assert.deepEqual(calls, [], 'A gap before the next cue must not trigger prefetch');
  controller.timeline.frame(.5); await tick();
  controller.timeline.frame(.5); await tick();
  assert.deepEqual(calls, ['first']);
});

test('disabling pre-translation retains the chosen service when no human Chinese track exists', async () => {
  const calls = [], operations = [];
  const controller = new YoutubeSubtitles({ translate: async text => { calls.push(text); return '所选服务译文'; } });
  controller.setPreferences({ youtubePreTranslation: false });
  controller.enabled = true; controller.id = 'provider-video'; controller.frame = () => {};
  controller.request = async operation => {
    operations.push(operation);
    if (operation === 'metadata') return { sourceLanguage: 'en', tracks: [{ index: 0, languageCode: 'en', kind: '' }] };
    return { events: [{ tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: operation === 'translatedTrack' ? '平台机器翻译' : 'source sentence' }] }] };
  };
  await controller.loadTracks();
  controller.timeline.frame(.5); await tick();
  assert.equal(operations.includes('translatedTrack'), false);
  assert.equal(controller.timeline.frame(.5).translation, '所选服务译文');
  assert.deepEqual(calls, ['source sentence']);
});
