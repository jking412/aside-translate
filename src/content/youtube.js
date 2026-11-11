import { parseJson3, captionText, CueTimeline, alignedTranslation, selectCaptionTracks } from '../shared/cues.js';
const chinese = track => /^zh(?:-|$)/i.test(track.languageCode);
const videoId = () => new URL(location.href).searchParams.get('v') || location.pathname.match(/^\/shorts\/([^/]+)/)?.[1] || '';

/** Isolated-world controller: completions store data; only the media clock draws. */
export class YoutubeSubtitles {
  constructor({ translate, onStatus = () => {} }) {
    Object.assign(this, { translate, onStatus, enabled: false, status: '', requests: new Map(), revision: 0, domRevision: 0, targets: [] });
    this.timeline = new CueTimeline((text, options) => this.sourceChinese ? '' : alignedTranslation(options.cue, this.targets) || this.translate(text, options), () => this.report('字幕翻译失败，请检查翻译服务。'));
    this.onMessage = event => this.receive(event);
    this.onNavigationStart = () => this.reset();
    this.onNavigationEnd = () => this.discover();
    this.onSeeking = () => {
      this.seeking = true;
      this.blockedDomText = this.domText();
      this.timeline.invalidatePending(); this.resetDom(); this.render('', '');
    };
    this.onSeeked = () => { this.seeking = false; this.frame(); };
    this.onEmptied = () => { this.reset(); this.discover(); };
  }
  report(text) { if (text !== this.status) { this.status = text; this.onStatus(text); } }
  setEnabled(value) { if (value) this.start(); else this.stop(); }
  start() {
    if (this.enabled) return;
    this.enabled = true;
    window.addEventListener('message', this.onMessage);
    document.addEventListener('yt-navigate-start', this.onNavigationStart);
    document.addEventListener('yt-navigate-finish', this.onNavigationEnd);
    this.timer = setInterval(() => this.discover(), 700);
    this.discover();
    const animate = () => { if (!this.enabled) return; this.frame(); this.animation = requestAnimationFrame(animate); };
    this.animation = requestAnimationFrame(animate);
  }
  stop() {
    this.enabled = false; clearInterval(this.timer); cancelAnimationFrame(this.animation);
    window.removeEventListener('message', this.onMessage);
    document.removeEventListener('yt-navigate-start', this.onNavigationStart);
    document.removeEventListener('yt-navigate-finish', this.onNavigationEnd);
    this.reset(); this.detach(); this.report('YouTube 双语字幕已关闭');
  }
  resetDom() {
    this.domRevision++; this.domController?.abort(); this.domController = null;
    this.lastDomText = ''; this.domTranslation = '';
  }
  reset() {
    this.revision++; this.id = ''; this.ready = false; this.loading = false; this.nextAttempt = 0;
    this.targets = []; this.timeline.reset(); this.blockedDomText = this.domText(); this.resetDom(); this.render('', '');
    for (const [id, pending] of this.requests) {
      clearTimeout(pending.timer); this.cancel(id); pending.reject(new Error('视频已切换'));
    }
    this.requests.clear();
  }
  cancel(id) { window.postMessage({ source: 'light-translate', kind: 'youtube-request', id: crypto.randomUUID(), operation: 'cancel', cancelId: id }, location.origin); }
  detach() {
    this.resizeObserver?.disconnect();
    for (const [name, handler] of [['seeking', this.onSeeking], ['seeked', this.onSeeked], ['emptied', this.onEmptied]]) this.video?.removeEventListener(name, handler);
    this.player?.removeAttribute('data-lt-caption-active');
    if (this.changedPosition && this.player) this.player.style.position = this.oldPosition;
    this.host?.remove(); this.nativeStyle?.remove();
    this.player = this.video = this.host = this.sourceRow = this.targetRow = null; this.changedPosition = false;
  }
  discover() {
    if (!this.enabled) return;
    const id = videoId();
    const player = document.querySelector('#movie_player, .html5-video-player');
    const video = player?.querySelector('video');
    if (!id || !player || !video) {
      if (this.id || this.player) { this.reset(); this.detach(); }
      this.report('打开带字幕的 YouTube 视频即可使用'); return;
    }
    if (id !== this.id || player !== this.player || video !== this.video) {
      this.reset(); this.detach(); this.id = id; this.attach(player, video); this.report('正在读取播放器字幕…');
    }
    if (!this.ready && !this.loading && Date.now() >= (this.nextAttempt || 0)) this.loadTracks();
  }
  attach(player, video) {
    this.player = player; this.video = video; this.seeking = video.seeking;
    this.oldPosition = player.style.position; this.changedPosition = getComputedStyle(player).position === 'static';
    if (this.changedPosition) player.style.position = 'relative';
    const host = document.createElement('div'); host.className = 'lt-youtube-overlay'; host.dataset.ltIgnore = '';
    host.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:75;'; host.setAttribute('aria-hidden', 'true');
    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = ':host{all:initial;position:absolute;inset:0;pointer-events:none;z-index:75;font-family:Arial,"Microsoft YaHei",sans-serif}.captions{position:absolute;bottom:9%;left:5%;width:90%;text-align:center;line-height:1.4}.row{display:block;width:fit-content;max-width:100%;box-sizing:border-box;margin:2px auto;padding:1px 6px;background:rgba(0,0,0,.8);color:#fff;border-radius:3px;white-space:pre-wrap;overflow-wrap:anywhere;text-shadow:0 1px 2px #000}.row:empty{display:none}.source{font-size:.88em;font-weight:400}.translation{font-size:1em;font-weight:600}';
    const container = document.createElement('div'); container.className = 'captions';
    this.sourceRow = document.createElement('span'); this.sourceRow.className = 'row source';
    this.targetRow = document.createElement('span'); this.targetRow.className = 'row translation';
    container.append(this.sourceRow, this.targetRow); shadow.append(style, container); this.host = host; player.append(host);
    this.nativeStyle = document.createElement('style'); this.nativeStyle.dataset.ltIgnore = '';
    this.nativeStyle.textContent = '[data-lt-caption-active] .ytp-caption-window-container{visibility:hidden!important}'; player.append(this.nativeStyle);
    const resize = () => { const { width, height } = player.getBoundingClientRect(); host.style.fontSize = Math.max(12, Math.min(40, width / 38, height / 17)) + 'px'; };
    this.resizeObserver = new ResizeObserver(resize); this.resizeObserver.observe(player); resize();
    for (const [name, handler] of [['seeking', this.onSeeking], ['seeked', this.onSeeked], ['emptied', this.onEmptied]]) video.addEventListener(name, handler);
  }
  request(operation, trackIndex) {
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.requests.delete(id); this.cancel(id); reject(new Error('读取字幕超时')); }, 9000);
      this.requests.set(id, { resolve, reject, timer });
      window.postMessage({ source: 'light-translate', kind: 'youtube-request', id, operation, videoId: this.id, trackIndex }, location.origin);
    });
  }
  receive(event) {
    const message = event.data;
    if (event.source !== window || message?.source !== 'light-translate' || message.kind !== 'youtube-response') return;
    const pending = this.requests.get(message.id); if (!pending) return;
    clearTimeout(pending.timer); this.requests.delete(message.id);
    if (message.error) pending.reject(new Error(String(message.error).slice(0, 150))); else pending.resolve(message.result);
  }
  async loadTracks() {
    const revision = this.revision; this.loading = true; this.nextAttempt = Date.now() + 5000;
    try {
      const metadata = await this.request('metadata');
      if (revision !== this.revision || !this.enabled) return;
      const { source, target } = selectCaptionTracks(metadata?.tracks, metadata?.sourceLanguage);
      if (!source) { this.report('未找到字幕轨，请打开播放器 CC。'); return; }
      const [a, b] = await Promise.allSettled([this.request('track', source.index), target && target.index !== source.index ? this.request('track', target.index) : Promise.resolve(null)]);
      if (revision !== this.revision || !this.enabled) return;
      if (a.status !== 'fulfilled') throw a.reason;
      const cues = parseJson3(a.value); if (!cues.length) throw new Error('字幕轨为空');
      this.targets = [];
      if (b.status === 'fulfilled' && b.value) { try { this.targets = parseJson3(b.value); } catch { /* Bad target data must preserve a valid source track. */ } }
      this.sourceChinese = chinese(source); this.timeline.reset(cues); this.ready = true; this.resetDom();
      this.report(this.sourceChinese ? '当前字幕已是中文' : 'YouTube 双语字幕已就绪'); this.frame();
    } catch {
      if (revision === this.revision && this.enabled) this.report('无法读取完整字幕，请打开播放器 CC；将翻译当前字幕。');
    } finally { if (revision === this.revision) this.loading = false; }
  }
  domText() { return this.player ? captionText([...this.player.querySelectorAll('.ytp-caption-segment')].map(el => el.textContent).join(' ')) : ''; }
  frame() {
    if (!this.enabled || !this.video || !this.player) return;
    if (this.seeking || this.video.seeking || this.player.classList.contains('ad-showing') || this.player.classList.contains('ad-interrupting')) { this.render('', ''); return; }
    if (this.ready) { const cue = this.timeline.frame(this.video.currentTime); this.render(cue?.text || '', cue?.translation || ''); return; }
    const text = this.domText();
    if (!text || text === this.blockedDomText) { if (this.lastDomText) this.resetDom(); this.render('', ''); return; }
    if (text !== this.lastDomText) {
      this.resetDom(); this.lastDomText = text; this.blockedDomText = '';
      const revision = this.domRevision; const controller = new AbortController(); this.domController = controller;
      Promise.resolve().then(() => this.translate(text, { signal: controller.signal })).then(translation => {
        if (!controller.signal.aborted && revision === this.domRevision && this.enabled && !this.seeking && this.domText() === text) { this.domTranslation = captionText(translation); this.report('正在翻译播放器当前字幕'); }
      }).catch(() => { if (!controller.signal.aborted && revision === this.domRevision) this.report('字幕翻译失败，请检查翻译服务。'); });
    }
    this.render(text, this.domTranslation);
  }
  render(source, translation) {
    if (!this.sourceRow || !this.targetRow) return;
    if (this.sourceRow.textContent !== source) this.sourceRow.textContent = source;
    const target = translation === source ? '' : translation;
    if (this.targetRow.textContent !== target) this.targetRow.textContent = target;
    if (source) this.player?.setAttribute('data-lt-caption-active', ''); else this.player?.removeAttribute('data-lt-caption-active');
  }
}
