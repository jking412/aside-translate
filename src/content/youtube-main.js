import { parseYoutubePayload } from '../shared/youtube-payload.js';
import { sourceAudioLanguage } from '../shared/cues.js';

/** MAIN-world bridge: observe the site's own caption requests without replacing
 * its responses. No translation key or extension API is available in this world. */
(() => {
  const marker = '__light_translate_youtube_bridge_v2__';
  if (window[marker]) return;
  window[marker] = true;
  let enabled = false;
  const active = new Map();
  const originalFetch = window.fetch;
  const currentId = () => new URL(location.href).searchParams.get('v') || location.pathname.match(/^\/(?:shorts|embed|live)\/([^/]+)/)?.[1] || '';
  const post = message => window.postMessage({ source: 'light-translate', ...message }, location.origin);
  const playerData = expected => {
    if (!expected || currentId() !== expected) throw new Error('视频已切换');
    const player = document.querySelector('#movie_player, .html5-video-player');
    let response;
    try { response = player?.getPlayerResponse?.(); } catch { /* The player may be replacing itself. */ }
    if (response?.videoDetails?.videoId !== expected) response = window.ytInitialPlayerResponse;
    if (response?.videoDetails?.videoId !== expected) throw new Error('播放器字幕尚未就绪');
    return { player, response };
  };
  const captionUrl = input => {
    try {
      const url = new URL(typeof input === 'string' ? input : input?.url || input?.href, location.href);
      return url.protocol === 'https:' && (url.hostname === 'youtube.com' || url.hostname.endsWith('.youtube.com')) && url.pathname === '/api/timedtext' ? url : null;
    } catch { return null; }
  };
  const publish = (url, text, status) => {
    if (!enabled || !url) return;
    const id = currentId(), requestedId = url.searchParams.get('v');
    if (!id || requestedId && requestedId !== id) return;
    if (status !== 200) {
      post({ kind: 'youtube-native-error', videoId: id, status });
      return;
    }
    try {
      if (typeof text !== 'string' || text.length > 4000000 || !text.trim()) return;
      const data = parseYoutubePayload(text);
      if (!Array.isArray(data.events) || !data.events.some(event => event?.segs?.some(segment => segment?.utf8?.trim()))) return;
      post({ kind: 'youtube-native-track', result: { videoId: id, languageCode: url.searchParams.get('lang') || '',
        kind: url.searchParams.get('kind') || '', translatedLanguage: url.searchParams.get('tlang') || '', data } });
    } catch { /* Malformed or non-JSON3 native responses remain the site's own responses. */ }
  };
  // Keep native return values, event handlers and response bodies untouched.
  window.fetch = function (...args) {
    const result = Reflect.apply(originalFetch, this, args);
    const url = captionUrl(args[0]);
    if (url) result.then(response => {
      if (!enabled) return;
      response.clone().text().then(text => publish(url, text, response.status)).catch(() => {});
    }).catch(() => {});
    return result;
  };
  const xhrUrls = new WeakMap();
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    xhrUrls.set(this, captionUrl(url));
    return Reflect.apply(originalOpen, this, [method, url, ...rest]);
  };
  XMLHttpRequest.prototype.send = function (...args) {
    const url = xhrUrls.get(this);
    if (url) this.addEventListener('load', () => {
      try {
        const text = this.responseType === 'json' ? JSON.stringify(this.response) : (!this.responseType || this.responseType === 'text') ? this.responseText : '';
        publish(url, text, this.status);
      } catch { /* Binary native caption formats are not changed. */ }
    }, { once: true });
    return Reflect.apply(originalSend, this, args);
  };

  window.addEventListener('message', async event => {
    const request = event.data;
    if (event.source !== window || request?.source !== 'light-translate' || request.kind !== 'youtube-request' || typeof request.id !== 'string' || request.id.length > 100) return;
    const reply = (result, error) => post({ kind: 'youtube-response', id: request.id, result, error });
    if (request.operation === 'cancel') { active.get(request.cancelId)?.abort(); return; }
    if (request.operation === 'active') { enabled = request.enabled === true; reply({ enabled }); return; }
    let timeout;
    try {
      const { player, response } = playerData(request.videoId);
      const renderer = response.captions?.playerCaptionsTracklistRenderer;
      const tracks = renderer?.captionTracks ?? [];
      const sourceLanguage = sourceAudioLanguage(response);
      if (request.operation === 'metadata') {
        reply({ videoId: request.videoId, sourceLanguage, tracks: tracks.slice(0, 100).map((track, index) => ({ index,
          languageCode: String(track.languageCode ?? '').slice(0, 30), kind: String(track.kind ?? '').slice(0, 20),
        })) }); return;
      }
      if (request.operation === 'clock') {
        const video = player?.querySelector('video');
        let time;
        try { time = player?.getCurrentTime?.(); } catch { /* Fall back to media time. */ }
        reply({ time: Number.isFinite(time) ? time : video?.currentTime, paused: video?.paused !== false, rate: video?.playbackRate || 1 }); return;
      }
      if (request.operation === 'trigger') {
        if (!enabled) { reply({ triggered: false }); return; }
        const desired = tracks[request.trackIndex];
        let selected;
        try { selected = player?.getOption?.('captions', 'track'); } catch { /* No current native track yet. */ }
        const changed = desired && (selected?.languageCode !== desired.languageCode || (selected?.kind || '') !== (desired.kind || ''));
        try {
          player?.loadModule?.('captions');
          if (changed) player?.setOption?.('captions', 'track', { languageCode: desired.languageCode, vssId: desired.vssId, kind: desired.kind });
        } catch { /* The native CC button still provides a supported fallback. */ }
        const cc = player?.querySelector('.ytp-subtitles-button');
        const stillCurrent = () => enabled && currentId() === request.videoId;
        if (cc) {
          if (cc.getAttribute('aria-pressed') !== 'true') cc.click();
          else if (request.force && !changed) {
            cc.click();
            setTimeout(() => { if (stillCurrent() && cc.isConnected && cc.getAttribute('aria-pressed') !== 'true') cc.click(); }, 100);
          }
        } else if (player?.toggleSubtitles) {
          player.toggleSubtitles();
          setTimeout(() => { if (stillCurrent()) player.toggleSubtitles(); }, 100);
        }
        reply({ triggered: true }); return;
      }
      if (!['track', 'translatedTrack'].includes(request.operation) || !Number.isInteger(request.trackIndex) || !enabled) throw new Error('不支持的字幕请求');
      if (active.size >= 6) throw new Error('字幕请求过多');
      const url = captionUrl(tracks[request.trackIndex]?.baseUrl);
      if (!url) throw new Error('字幕轨地址无效');
      url.searchParams.set('fmt', 'json3');
      url.searchParams.delete('tlang');
      if (request.operation === 'translatedTrack') {
        const target = renderer?.translationLanguages?.find(language => /^zh-(?:Hans|CN)$/i.test(language.languageCode))?.languageCode || 'zh-Hans';
        url.searchParams.set('tlang', target);
      }
      const controller = new AbortController(); active.set(request.id, controller);
      timeout = setTimeout(() => controller.abort(), 8000);
      const result = await Reflect.apply(originalFetch, window, [url.href, { credentials: 'same-origin', signal: controller.signal }]);
      if (!result.ok) throw new Error('字幕轨暂不可用');
      const text = await result.text();
      if (text.length > 4000000 || currentId() !== request.videoId) throw new Error('字幕已过期或过大');
      if (!text.trim()) throw new Error('字幕轨为空，请等待播放器原生字幕');
      let data; try { data = parseYoutubePayload(text); } catch { throw new Error('字幕格式不受支持'); }
      if (!Array.isArray(data.events)) throw new Error('字幕格式不受支持');
      reply(data);
    } catch (error) { reply(undefined, error?.name === 'AbortError' ? '读取字幕超时' : String(error?.message || '读取字幕失败').slice(0, 120)); }
    finally { clearTimeout(timeout); active.delete(request.id); }
  });
})();
