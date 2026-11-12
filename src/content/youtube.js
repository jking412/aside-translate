import { parseJson3, captionText, CueTimeline, alignedTranslation, selectCaptionTracks } from '../shared/cues.js';
import { YoutubePlayerView } from './youtube-player.js';
const chinese = track => /^zh(?:-|$)/i.test(track?.languageCode || '');
const videoId = () => new URL(location.href).searchParams.get('v') || location.pathname.match(/^\/(?:shorts|embed|live)\/([^/]+)/)?.[1] || '';

/** Native caption data enters once; asynchronous translation stores results;
 * only the current player clock decides which source/target rows are drawn. */
export class YoutubeSubtitles {
  constructor({ translate, onStatus = () => {} }) {
    Object.assign(this, { translate, onStatus, enabled: false, status: '', requests: new Map(), revision: 0,
      domRevision: 0, targets: [], preferences: { humanPreferred: true, preTranslation: true } });
    this.timeline = new CueTimeline((text, options) => {
      if (this.sourceChinese) return '';
      const target = this.preferences.humanPreferred && alignedTranslation(options.cue, this.targets);
      return target || this.translate(text, options);
    }, () => this.report('字幕翻译失败，请检查翻译服务。'));
    this.onMessage = event => this.receive(event);
    this.onNavigationStart = () => { this.navigating = true; this.reset(); };
    this.onNavigationEnd = () => { this.navigating = false; this.discover(); };
    this.onSeeking = () => {
      this.seeking = true; this.clearClock();
      this.blockedDomText = this.domText(); this.timeline.invalidatePending(); this.resetDom(); this.render('', '');
    };
    this.onSeeked = () => { this.seeking = false; this.frame(); };
    this.onRateChange = () => { this.clearClock(); if (this.enabled && !this.seeking && !this.video?.seeking) this.updateClock(); };
    this.onEmptied = () => { this.reset(); this.discover(); };
  }
  report(text) { if (text !== this.status) { this.status = text; this.onStatus(text); } }
  setPreferences(settings = {}) {
    const next = { humanPreferred: settings.youtubeHumanPreferred !== false, preTranslation: settings.youtubePreTranslation !== false };
    const changed = next.humanPreferred !== this.preferences.humanPreferred || next.preTranslation !== this.preferences.preTranslation;
    this.preferences = next;
    this.timeline.prefetchEnabled = next.preTranslation;
    if (changed) {
      if (this.rawSource) this.useSource(this.rawSource.data, this.rawSource.track, this.rawSource.origin, true);
      else this.timeline.reset(this.timeline.cues);
      this.nextAttempt = 0;
      if (this.enabled && !this.loading) this.loadTracks();
    }
  }
  watch() {
    if (this.watching) return;
    this.watching = true;
    window.addEventListener('message', this.onMessage);
    document.addEventListener('yt-navigate-start', this.onNavigationStart);
    document.addEventListener('yt-navigate-finish', this.onNavigationEnd);
    this.timer = setInterval(() => this.discover(), 700);
  }
  setEnabled(value) { this.watch(); if (value) this.start(); else this.stop(); }
  start() {
    this.watch();
    if (this.enabled) { this.discover(); return; }
    this.enabled = true;
    this.request('active', { enabled: true }).catch(() => {});
    this.discover();
    const animate = () => { if (!this.enabled) return; this.frame(); this.animation = requestAnimationFrame(animate); };
    this.animation = requestAnimationFrame(animate);
  }
  stop() {
    this.enabled = false; cancelAnimationFrame(this.animation);
    this.reset(); this.view?.enable(false);
    this.request('active', { enabled: false }).catch(() => {});
    this.report('YouTube 双语字幕已关闭');
  }
  resetDom() {
    this.domRevision++; this.domController?.abort(); this.domController = null;
    this.lastDomText = ''; this.domTranslation = '';
  }
  reset() {
    this.revision++; this.id = ''; this.ready = false; this.loading = false; this.nextAttempt = 0;
    this.targets = []; this.rawSource = null; this.sourceTrack = null; this.sourceSignature = ''; this.clearClock();
    this.timeline.reset(); this.blockedDomText = this.domText(); this.resetDom(); this.render('', '');
    for (const [id, pending] of this.requests) { clearTimeout(pending.timer); this.cancel(id); pending.reject(new Error('视频已切换')); }
    this.requests.clear();
  }
  cancel(id) { window.postMessage({ source: 'light-translate', kind: 'youtube-request', id: crypto.randomUUID(), operation: 'cancel', cancelId: id }, location.origin); }
  detach() {
    for (const [name, handler] of [['seeking', this.onSeeking], ['seeked', this.onSeeked], ['emptied', this.onEmptied], ['ratechange', this.onRateChange], ['play', this.onRateChange], ['pause', this.onRateChange]]) this.video?.removeEventListener(name, handler);
    this.view?.destroy(); this.view = null; this.player = this.video = null;
  }
  discover() {
    if (this.navigating) return;
    const id = videoId(), player = document.querySelector('#movie_player, .html5-video-player'), video = player?.querySelector('video');
    if (!id || !player || !video) {
      if (this.id || this.player) { this.reset(); this.detach(); }
      if (this.enabled) this.report('打开带字幕的 YouTube 视频即可使用');
      return;
    }
    if (id !== this.id || player !== this.player || video !== this.video) {
      this.reset(); this.detach(); this.id = id; this.attach(player, video);
      if (this.enabled) this.report('正在读取播放器字幕…');
    }
    this.view?.ensureButton(); this.view?.enable(this.enabled);
    if (this.enabled && !this.ready && !this.loading && Date.now() >= (this.nextAttempt || 0)) this.loadTracks();
  }
  attach(player, video) {
    this.player = player; this.video = video; this.seeking = video.seeking;
    this.view = new YoutubePlayerView(player, { onToggle: () => {
      const enabled = !this.enabled; this.setEnabled(enabled);
      try { chrome.storage.local.set({ youtubeEnabled: enabled }).catch(() => {}); } catch { /* Direct module harness. */ }
    } });
    this.view.enable(this.enabled);
    for (const [name, handler] of [['seeking', this.onSeeking], ['seeked', this.onSeeked], ['emptied', this.onEmptied], ['ratechange', this.onRateChange], ['play', this.onRateChange], ['pause', this.onRateChange]]) video.addEventListener(name, handler);
  }
  request(operation, data = {}) {
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.requests.delete(id); this.cancel(id); reject(new Error('读取字幕超时')); }, operation === 'clock' ? 500 : 9000);
      this.requests.set(id, { resolve, reject, timer });
      window.postMessage({ source: 'light-translate', kind: 'youtube-request', id, operation, videoId: this.id, ...data }, location.origin);
    });
  }
  receive(event) {
    const message = event.data;
    if (event.source !== window || message?.source !== 'light-translate') return;
    if (message.kind === 'youtube-native-track') { this.nativeTrack(message.result); return; }
    if (message.kind === 'youtube-native-error') {
      if (message.videoId === this.id && message.status === 429) this.report('YouTube 暂时限制字幕请求，请稍后重试。');
      return;
    }
    if (message.kind !== 'youtube-response') return;
    const pending = this.requests.get(message.id); if (!pending) return;
    clearTimeout(pending.timer); this.requests.delete(message.id);
    if (message.error) pending.reject(new Error(String(message.error).slice(0, 150))); else pending.resolve(message.result);
  }
  nativeTrack(track) {
    if (!this.enabled || this.navigating || !track || track.videoId !== this.id || !Array.isArray(track.data?.events)) return;
    if (track.translatedLanguage) return;
    const languageCode = track.languageCode || this.sourceTrack?.languageCode || '';
    if (chinese({ languageCode }) && track.kind !== 'asr' && !chinese(this.sourceTrack)) {
      if (this.preferences.humanPreferred) this.useTargets(track.data);
      return;
    }
    const wanted = this.sourceTrack?.languageCode?.split('-')[0];
    if (wanted && languageCode && languageCode.split('-')[0] !== wanted) return;
    this.useSource(track.data, { languageCode, kind: track.kind || '' }, 'native');
  }
  useSource(data, track, origin, force = false) {
    let cues;
    try { cues = parseJson3(data, { language: track.languageCode, kind: track.kind, preTranslation: this.preferences.preTranslation }); } catch { return; }
    if (!cues.length) return;
    const signature = JSON.stringify([track.languageCode, track.kind, this.preferences.preTranslation, cues]);
    this.rawSource = { data, track, origin };
    if (!force && this.sourceSignature === signature) return;
    this.sourceSignature = signature; this.sourceChinese = chinese(track); this.timeline.reset(cues); this.ready = true;
    this.resetDom();
    this.report(this.sourceChinese ? '当前字幕已是中文' : origin === 'native' ? '已读取播放器原生字幕，双语字幕已就绪' : 'YouTube 双语字幕已就绪');
    this.frame();
  }
  useTargets(data) {
    let targets;
    try { targets = parseJson3(data, { language: 'zh-CN' }); } catch { return; }
    if (!targets.some(cue => /\p{Script=Han}/u.test(cue.text))) return;
    if (JSON.stringify(targets) === JSON.stringify(this.targets)) return;
    this.targets = targets;
    this.timeline.reset(this.timeline.cues);
    this.frame();
  }
  async loadTracks() {
    if (!this.enabled || !this.id) return;
    const revision = this.revision; this.loading = true; this.nextAttempt = Date.now() + 10000;
    try {
      const metadata = await this.request('metadata');
      if (revision !== this.revision || !this.enabled) return;
      const { source, target } = selectCaptionTracks(metadata?.tracks, metadata?.sourceLanguage);
      this.sourceTrack = source;
      if (!source) { this.report('未找到完整字幕轨；开启播放器 CC 后可翻译当前字幕。'); return; }
      this.request('trigger', { trackIndex: source.index, force: !this.ready }).catch(() => {});
      const sourceRequest = this.request('track', { trackIndex: source.index }).then(data => {
        if (revision === this.revision && this.enabled && this.rawSource?.origin !== 'native') this.useSource(data, source, 'track');
      });
      let targetRequest = Promise.resolve();
      if (this.preferences.humanPreferred && !chinese(source) && target && target.index !== source.index) {
        targetRequest = this.request('track', { trackIndex: target.index }).then(data => {
          if (revision === this.revision && this.enabled) this.useTargets(data);
        });
      }
      await Promise.allSettled([sourceRequest, targetRequest]);
      if (revision === this.revision && !this.ready) this.report('等待播放器原生字幕，请确认 CC 已开启；当前字幕可见时将逐句翻译。');
    } catch { if (revision === this.revision && this.enabled) this.report('播放器字幕尚未就绪，请开启 CC 或稍后重试。'); }
    finally { if (revision === this.revision) this.loading = false; }
  }
  domText() { return this.player ? captionText([...this.player.querySelectorAll('.ytp-caption-segment')].map(element => element.textContent).join(' ')) : ''; }
  clearClock() {
    this.clock = null; this.clockRevision = (this.clockRevision || 0) + 1;
    this.clockPending = false; this.nextClockAt = 0;
  }
  mediaTime(now = performance.now()) {
    const clock = this.clock, rate = this.video.playbackRate || 1;
    if (clock && clock.videoId === this.id && now >= clock.at && now - clock.at < 700 && clock.paused === this.video.paused && clock.rate === rate) return clock.time + (clock.paused ? 0 : (now - clock.at) / 1000 * rate);
    return this.video.currentTime;
  }
  updateClock() {
    if (this.clockPending || Date.now() < (this.nextClockAt || 0) || !this.id) return;
    this.clockPending = true; this.nextClockAt = Date.now() + 200;
    const revision = this.revision, clockRevision = this.clockRevision, id = this.id, started = performance.now();
    this.request('clock').then(clock => {
      if (revision !== this.revision || clockRevision !== this.clockRevision || !this.enabled || !Number.isFinite(clock?.time)) return;
      const now = performance.now(), rate = Number.isFinite(clock.rate) && clock.rate > 0 ? clock.rate : this.video.playbackRate || 1;
      this.clock = { time: clock.time + (clock.paused ? 0 : (now - started) / 1000 * rate), at: now, paused: clock.paused, rate, videoId: id };
    }).catch(() => {}).finally(() => { if (revision === this.revision && clockRevision === this.clockRevision) this.clockPending = false; });
  }
  frame() {
    if (!this.enabled || !this.video || !this.player || this.navigating) return;
    if (this.seeking || this.video.seeking || this.player.classList.contains('ad-showing') || this.player.classList.contains('ad-interrupting')) { this.render('', ''); return; }
    this.updateClock();
    if (this.ready) {
      const cue = this.timeline.frame(this.mediaTime());
      const state = cue ? this.timeline.failed.has(cue.index) ? '翻译失败，请检查服务' : this.timeline.pending.has(cue.index) ? '翻译中…' : '' : '';
      this.render(cue?.text || '', cue?.translation || '', state); return;
    }
    const text = this.domText();
    if (!text || text === this.blockedDomText) { if (this.lastDomText) this.resetDom(); this.render('', ''); return; }
    if (text !== this.lastDomText) {
      this.resetDom(); this.lastDomText = text; this.blockedDomText = '';
      const revision = this.domRevision, controller = new AbortController(); this.domController = controller;
      Promise.resolve().then(() => this.translate(text, { signal: controller.signal })).then(translation => {
        if (!controller.signal.aborted && revision === this.domRevision && this.enabled && !this.seeking && this.domText() === text) {
          this.domTranslation = captionText(translation); this.report('正在翻译播放器当前字幕');
        }
      }).catch(() => { if (!controller.signal.aborted && revision === this.domRevision) this.report('字幕翻译失败，请检查翻译服务。'); });
    }
    this.render(text, this.domTranslation);
  }
  render(source, translation, state = '') { this.view?.render(source, translation === source ? '' : translation, source ? state : ''); }
}
