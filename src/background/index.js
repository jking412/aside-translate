import { loadSettings } from '../shared/settings.js';
import { createTranslator, endpointPermission } from '../shared/translate.js';

const translator = createTranslator();
const SCRIPT_ID = 'auto-pages';
const WEB_ORIGINS = ['http://*/*', 'https://*/*'];
let registration = Promise.resolve();

// Serialise permission/settings updates so the newest state always wins.
function synchronizeRegistration() {
  registration = registration.catch(() => {}).then(async () => {
    const settings = await loadSettings();
    const allowed = settings.autoTranslate && await chrome.permissions.contains({ origins: WEB_ORIGINS });
    const registered = await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] });
    if (allowed && !registered.length) {
      await chrome.scripting.registerContentScripts([{
        id: SCRIPT_ID,
        matches: WEB_ORIGINS,
        excludeMatches: ['https://www.youtube.com/*'],
        js: ['content/index.js'],
        runAt: 'document_idle',
        persistAcrossSessions: true,
      }]);
    } else if (!allowed && registered.length) {
      await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
    }
  });
  // A revoked permission or worker shutdown can race a registration operation.
  registration.catch(() => {});
  return registration;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || message?.type !== 'TRANSLATE') return false;
  const senderUrl = sender.url || sender.tab?.url || '';
  if (!/^(https?:|chrome-extension:)/.test(senderUrl)) return false;
  (async () => {
    const settings = await loadSettings();
    if (settings.service !== 'google') {
      const origin = endpointPermission(settings.endpoint);
      if (!await chrome.permissions.contains({ origins: [origin] })) {
        throw new Error('尚未授权翻译接口，请在扩展设置中重新保存并允许访问。');
      }
    }
    const text = await translator.translate(message.text, settings);
    sendResponse({ ok: true, text });
  })().catch(error => sendResponse({ ok: false, error: error?.message || '翻译失败，请稍后重试。' }));
  return true;
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  translator.clearCache();
  if (changes.autoTranslate) synchronizeRegistration();
});
chrome.permissions.onAdded.addListener(synchronizeRegistration);
chrome.permissions.onRemoved.addListener(synchronizeRegistration);
chrome.runtime.onInstalled.addListener(synchronizeRegistration);
chrome.runtime.onStartup.addListener(synchronizeRegistration);
synchronizeRegistration();
