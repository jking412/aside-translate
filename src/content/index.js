import { loadSettings } from '../shared/settings.js';
import { PageTranslator } from './page.js';
import { YoutubeSubtitles } from './youtube.js';
import { FloatingControls } from './floating.js';

if (!globalThis.__asideContent) {
  globalThis.__asideContent = true;
  let youtubeStatus = '';
  let settingsUpdate = Promise.resolve();
  let pageActionRevision = 0;
  let floating;
  const translate = async (text, { signal, format = 'text' } = {}) => {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    let onAbort;
    const aborted = signal && new Promise((_, reject) => {
      onAbort = () => reject(new DOMException('Aborted', 'AbortError'));
      signal.addEventListener('abort', onAbort, { once: true });
    });
    try {
      const request = chrome.runtime.sendMessage({ type: 'TRANSLATE', text, format });
      const result = await (aborted ? Promise.race([request, aborted]) : request);
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      if (!result?.ok) throw new Error(result?.error || '翻译服务无响应，请重新加载扩展。');
      return result.text;
    } finally {
      if (onAbort) signal.removeEventListener('abort', onAbort);
    }
  };
  const page = new PageTranslator({ translate, onChange: () => floating?.update() });
  const youtube = location.hostname === 'www.youtube.com'
    ? new YoutubeSubtitles({ translate, onStatus: status => { youtubeStatus = status; floating?.update(); } }) : null;
  const status = () => ({ ...page.status, youtubeStatus });
  if (window.top === window) floating = new FloatingControls({
    getStatus: status,
    onToggle: async () => {
      const result = await chrome.runtime.sendMessage({ type: 'PAGE_TOGGLE_TAB' });
      if (!result?.ok) throw new Error(result?.error || '无法切换网页翻译。');
      floating.update();
    },
    onOpenSettings: () => chrome.runtime.sendMessage({ type: 'OPEN_SETTINGS' }),
  });
  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message?.type === 'PAGE_STATUS') { respond(status()); return; }
    if (message?.type === 'PAGE_TOGGLE') {
      pageActionRevision++;
      if (page.enabled) page.restore(); else page.start();
      respond(status());
    }
    if (message?.type === 'PAGE_SET_ENABLED') {
      pageActionRevision++;
      if (message.enabled) page.start(); else page.restore();
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
      youtube?.setPreferences(settings);
      youtube?.setEnabled(settings.youtubeEnabled);
      if (settings.floatingEnabled !== false) floating?.start(); else floating?.stop();
      // Subtitle/service preferences preserve manual page translation. A delayed
      // initial read must also preserve a page action performed since it began.
      if ((!changes || 'autoTranslate' in changes) && actionRevision === pageActionRevision) {
        if (settings.autoTranslate) page.start(); else page.restore();
      }
    });
    return settingsUpdate;
  };
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && ['autoTranslate', 'youtubeEnabled', 'youtubeHumanPreferred', 'youtubePreTranslation', 'floatingEnabled', 'service', 'endpoint', 'apiKey', 'model', 'preset'].some(key => key in changes)) {
      applySettings(changes).catch(() => {});
    }
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) page.scan(); });
  applySettings().catch(() => {});
}
