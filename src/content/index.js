import { loadSettings } from '../shared/settings.js';
import { PageTranslator } from './page.js';
import { YoutubeSubtitles } from './youtube.js';

if (!globalThis.__asideContent) {
  globalThis.__asideContent = true;
  let youtubeStatus = '';
  let settingsUpdate = Promise.resolve();
  let pageActionRevision = 0;
  const translate = async (text, { signal } = {}) => {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    let onAbort;
    const aborted = signal && new Promise((_, reject) => {
      onAbort = () => reject(new DOMException('Aborted', 'AbortError'));
      signal.addEventListener('abort', onAbort, { once: true });
    });
    try {
      const request = chrome.runtime.sendMessage({ type: 'TRANSLATE', text });
      const result = await (aborted ? Promise.race([request, aborted]) : request);
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      if (!result?.ok) throw new Error(result?.error || '翻译服务无响应，请重新加载扩展。');
      return result.text;
    } finally {
      if (onAbort) signal.removeEventListener('abort', onAbort);
    }
  };
  const page = new PageTranslator({ translate });
  const youtube = location.hostname === 'www.youtube.com'
    ? new YoutubeSubtitles({ translate, onStatus: status => { youtubeStatus = status; } }) : null;
  const status = () => ({ ...page.status, youtubeStatus });
  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message?.type === 'PAGE_STATUS') { respond(status()); return; }
    if (message?.type === 'PAGE_TOGGLE') {
      pageActionRevision++;
      if (page.enabled) page.restore(); else page.start();
      respond(status());
    }
  });
  const applySettings = (changes) => {
    const actionRevision = pageActionRevision;
    settingsUpdate = settingsUpdate.catch(() => {}).then(async () => {
      const settings = await loadSettings();
      const providerChanged = changes && ['service', 'endpoint', 'apiKey', 'model', 'preset'].some(key => key in changes);
      if (providerChanged) {
        const enabled = page.enabled;
        page.restore();
        if (enabled) page.start();
        // Reset the subtitle cache without changing the current page toggle.
        youtube?.stop();
      }
      youtube?.setEnabled(settings.youtubeEnabled);
      // Subtitle/service preferences preserve manual page translation. A delayed
      // initial read must also preserve a page action performed since it began.
      if ((!changes || 'autoTranslate' in changes) && actionRevision === pageActionRevision) {
        if (settings.autoTranslate) page.start(); else page.restore();
      }
    });
    return settingsUpdate;
  };
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && ['autoTranslate', 'youtubeEnabled', 'service', 'endpoint', 'apiKey', 'model', 'preset'].some(key => key in changes)) {
      applySettings(changes).catch(() => {});
    }
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) page.scan(); });
  applySettings().catch(() => {});
}
