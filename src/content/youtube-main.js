import { sourceAudioLanguage } from '../shared/cues.js';
/** Runs in YouTube's MAIN world. The bridge only reads public player metadata
 * and fetches a currently advertised timedtext track on the same site. It has
 * no extension API access, credentials, translation keys or arbitrary URL API. */
(() => {
  const marker = '__light_translate_youtube_bridge_v1__';
  if (window[marker]) return;
  window[marker] = true;
  const videoId = () => new URL(location.href).searchParams.get('v') || location.pathname.match(/^\/shorts\/([^/]+)/)?.[1] || '';
  const playerData = (expected) => {
    if (!expected || videoId() !== expected) throw new Error('视频已切换');
    const player = document.querySelector('#movie_player, .html5-video-player');
    let response;
    try { response = player?.getPlayerResponse?.(); } catch { /* Player can be replacing itself. */ }
    if (response?.videoDetails?.videoId !== expected) response = window.ytInitialPlayerResponse;
    if (response?.videoDetails?.videoId !== expected) throw new Error('播放器字幕尚未就绪');
    return response;
  };
  const active = new Map();
  window.addEventListener('message', async (event) => {
    const request = event.data;
    if (event.source !== window || request?.source !== 'light-translate' || request.kind !== 'youtube-request') return;
    if (typeof request.id !== 'string' || request.id.length > 100) return;
    const reply = (result, error) => window.postMessage({ source: 'light-translate', kind: 'youtube-response', id: request.id, result, error }, location.origin);
    if (request.operation === 'cancel') { active.get(request.cancelId)?.abort(); return; }
    let controller;
    let timeout;
    try {
      const response = playerData(request.videoId);
      const renderer = response.captions?.playerCaptionsTracklistRenderer;
      const tracks = renderer?.captionTracks ?? [];
      const sourceLanguage = sourceAudioLanguage(response);
      if (request.operation === 'metadata') {
        reply({ videoId: request.videoId, sourceLanguage: String(sourceLanguage).slice(0, 30), tracks: tracks.slice(0, 100).map((track, index) => ({
          index, languageCode: String(track.languageCode ?? '').slice(0, 30), kind: String(track.kind ?? '').slice(0, 20),
        })) });
        return;
      }
      if (request.operation !== 'track' || !Number.isInteger(request.trackIndex)) throw new Error('不支持的字幕请求');
      if (active.size >= 6) throw new Error('字幕请求过多');
      const track = tracks[request.trackIndex];
      const url = new URL(track?.baseUrl);
      if (url.protocol !== 'https:' || !(url.hostname === 'youtube.com' || url.hostname.endsWith('.youtube.com')) || url.pathname !== '/api/timedtext') throw new Error('字幕轨地址无效');
      url.searchParams.set('fmt', 'json3');
      url.searchParams.delete('tlang');
      controller = new AbortController();
      active.set(request.id, controller);
      timeout = setTimeout(() => controller.abort(), 8000);
      const result = await fetch(url.href, { credentials: 'same-origin', signal: controller.signal });
      if (!result.ok) throw new Error('字幕轨暂不可用');
      const text = await result.text();
      if (text.length > 4000000 || videoId() !== request.videoId) throw new Error('字幕已过期或过大');
      if (!text.trim()) throw new Error('字幕轨为空，播放器未返回字幕内容');
      let data;
      try { data = JSON.parse(text); } catch { throw new Error('字幕格式不受支持'); }
      if (!Array.isArray(data.events)) throw new Error('字幕格式不受支持');
      reply(data);
    } catch (error) {
      reply(undefined, error?.name === 'AbortError' ? '读取字幕超时' : String(error?.message ?? '读取字幕失败').slice(0, 120));
    } finally {
      clearTimeout(timeout);
      active.delete(request.id);
    }
  });
})();
