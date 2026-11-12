import { loadSettings } from '../shared/settings.js';
import { createTranslator } from '../shared/translate.js';

const translator = createTranslator();
const PROVIDER_KEYS = ['service', 'endpoint', 'apiKey', 'model', 'preset'];

// v0.1.0 registered auto-pages dynamically. Static all-site content scripts now
// provide both the floating controls and automatic translation, as in the client.
async function removeLegacyRegistration() {
  try {
    const scripts = await chrome.scripting.getRegisteredContentScripts({ ids: ['auto-pages'] });
    if (scripts.length) await chrome.scripting.unregisterContentScripts({ ids: ['auto-pages'] });
  } catch { /* A retiring worker may lose its execution context. */ }
}

async function toggleTab(tabId) {
  if (!Number.isInteger(tabId)) throw new Error('请在普通网页中使用翻译。');
  // Read the top frame once, then set every frame to the same intended state.
  const status = await chrome.tabs.sendMessage(tabId, { type: 'PAGE_STATUS' }, { frameId: 0 });
  await chrome.tabs.sendMessage(tabId, { type: 'PAGE_SET_ENABLED', enabled: !status.translated });
  return chrome.tabs.sendMessage(tabId, { type: 'PAGE_STATUS' }, { frameId: 0 });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  const senderUrl = sender.url || sender.tab?.url || '';
  const inheritedWebFrame = /^(?:about:(?:blank|srcdoc)(?:[?#]|$)|blob:|data:)/.test(senderUrl)
    && /^https?:/.test(sender.tab?.url || sender.origin || '');
  if (!/^(https?:|chrome-extension:)/.test(senderUrl) && !inheritedWebFrame) return false;
  let work;
  if (message?.type === 'TRANSLATE') {
    work = loadSettings().then(settings => translator.translate(message.text, settings, { format: message.format === 'html' ? 'html' : 'text' })).then(text => ({ ok: true, text }));
  } else if (message?.type === 'OPEN_SETTINGS') {
    work = chrome.runtime.openOptionsPage().then(() => ({ ok: true }));
  } else if (message?.type === 'PAGE_TOGGLE_TAB') {
    work = (async () => {
      const tabId = sender.tab?.id ?? (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id;
      return { ok: true, status: await toggleTab(tabId) };
    })();
  } else return false;
  work.then(sendResponse).catch(error => sendResponse({ ok: false, error: error?.message || '操作失败，请稍后重试。' }));
  return true;
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && PROVIDER_KEYS.some(key => key in changes)) translator.clearCache();
});
chrome.commands.onCommand.addListener(async command => {
  if (!['toggleTranslatePage', 'toggleTranslateTheWholePage'].includes(command)) return;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await toggleTab(tab?.id);
  } catch { /* Browser settings, stores and other protected pages cannot translate. */ }
});
chrome.runtime.onInstalled.addListener(removeLegacyRegistration);
chrome.runtime.onStartup.addListener(removeLegacyRegistration);
void removeLegacyRegistration();
