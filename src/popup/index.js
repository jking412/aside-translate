import { DEFAULT_SETTINGS, loadSettings, saveSettings } from '../shared/settings.js';
import { SERVICE_NAMES } from '../shared/provider-drafts.js';
import { mountServiceEditor } from './service-editor.js';
const byId = id => document.getElementById(id);
const translateButton = byId('translate');
let activeTab, available = false, pending = false, refreshing = false;
function status(id, text, error = false) { const node = byId(id); node.textContent = text; node.dataset.error = String(error); if (id === 'preference-status') node.hidden = !text; }
function renderPage(value) {
  const restoring = Boolean(value.translated || value.busy);
  translateButton.textContent = restoring ? '恢复原文' : '翻译此页';
  translateButton.dataset.restore = String(restoring);
  translateButton.setAttribute('aria-busy', String(Boolean(value.busy)));
  translateButton.disabled = !available || pending;
  status('page-status', value.error || (value.busy ? '正在翻译…可随时恢复原文。' : value.translated ? '已显示中文译文。' : '翻译当前页面，保留原文。'), Boolean(value.error));
  byId('youtube-status').textContent = value.youtubeStatus || '';
  byId('youtube-status').hidden = !value.youtubeStatus || !byId('youtube-enabled').checked;
}
async function notifyPage() { if (available) try { await chrome.tabs.sendMessage(activeTab.id, { type: 'SETTINGS_CHANGED' }); } catch {} }
async function connectPage() {
  [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let url; try { url = new URL(activeTab?.url || ''); } catch {}
  if (!activeTab?.id || !url || !['http:', 'https:'].includes(url.protocol)) {
    byId('page-host').textContent = '当前页面不支持翻译';
    status('page-status', '请在普通网页中使用；浏览器内部页面和 PDF 无法翻译。', true); return;
  }
  byId('page-host').textContent = url.hostname;
  try {
    let value;
    try { value = await chrome.tabs.sendMessage(activeTab.id, { type: 'PAGE_STATUS' }, { frameId: 0 }); }
    catch { await chrome.scripting.executeScript({ target: { tabId: activeTab.id }, files: ['content/index.js'] }); value = await chrome.tabs.sendMessage(activeTab.id, { type: 'PAGE_STATUS' }, { frameId: 0 }); }
    if (!value || typeof value.translated !== 'boolean') throw Error('Page unavailable');
    available = true; renderPage(value);
  } catch { status('page-status', '无法读取此页。请刷新后重试，或换一个普通网页。', true); }
}
async function refresh() {
  if (!available || pending || refreshing) return;
  refreshing = true;
  try { const value = await chrome.tabs.sendMessage(activeTab.id, { type: 'PAGE_STATUS' }, { frameId: 0 }); if (value) renderPage(value); }
  catch { available = false; translateButton.disabled = true; status('page-status', '网页已更新，请重新打开弹窗。', true); }
  finally { refreshing = false; }
}
translateButton.addEventListener('click', async () => {
  if (!available || pending) return; pending = true; translateButton.disabled = true;
  try {
    const result = await chrome.runtime.sendMessage({ type: 'PAGE_TOGGLE_TAB' });
    if (!result?.ok) throw new Error('Page toggle failed');
    if (result.status) renderPage(result.status);
  }
  catch { status('page-status', '翻译未能启动，请刷新网页后重试。', true); }
  finally { pending = false; translateButton.disabled = !available; void refresh(); }
});
byId('open-settings').addEventListener('click', async () => {
  try { await chrome.runtime.sendMessage({ type: 'OPEN_SETTINGS' }); }
  catch { status('preference-status', '无法打开设置页，请从扩展管理页进入“扩展程序选项”。', true); }
});
for (const [id, key, name] of [['auto-translate', 'autoTranslate', '自动翻译'], ['youtube-enabled', 'youtubeEnabled', 'YouTube 双语字幕'], ['selection-enabled', 'selectionEnabled', '划词翻译']]) {
  const control = byId(id); control.disabled = true;
  control.addEventListener('change', async () => {
    const previous = !control.checked; control.disabled = true;
    try { await saveSettings({ [key]: control.checked }); status('preference-status', `已${control.checked ? '开启' : '关闭'}${name}。`); await notifyPage(); }
    catch { control.checked = previous; status('preference-status', '设置未保存，请重新打开弹窗后重试。', true); }
    finally { control.disabled = false; }
  });
}
try {
  const settings = await loadSettings();
  byId('auto-translate').checked = settings.autoTranslate;
  byId('youtube-enabled').checked = settings.youtubeEnabled;
  byId('selection-enabled').checked = settings.selectionEnabled;
  byId('service-name').textContent = SERVICE_NAMES[settings.service];
  await mountServiceEditor(byId('service-editor'), { settings, onSaved: async saved => { byId('service-name').textContent = SERVICE_NAMES[saved.service]; await notifyPage(); } });
  byId('auto-translate').disabled = false; byId('youtube-enabled').disabled = false; byId('selection-enabled').disabled = false;
} catch { status('preference-status', '无法读取设置，请重新加载扩展。', true); }
try { await connectPage(); } catch { status('page-status', '无法读取当前页面，请重新打开弹窗。', true); }
const timer = setInterval(() => { void refresh(); }, 750);
window.addEventListener('pagehide', () => clearInterval(timer), { once: true });

const preferencesChanged = (changes, area) => {
  if (area !== 'local') return;
  for (const [id, key] of [['auto-translate', 'autoTranslate'], ['youtube-enabled', 'youtubeEnabled']]) if (key in changes) byId(id).checked = changes[key].newValue ?? DEFAULT_SETTINGS[key];
  if ('service' in changes) byId('service-name').textContent = SERVICE_NAMES[changes.service.newValue] || SERVICE_NAMES.bing;
};
chrome.storage.onChanged?.addListener(preferencesChanged);
window.addEventListener('pagehide', () => chrome.storage.onChanged?.removeListener(preferencesChanged), { once: true });
