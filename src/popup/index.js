import { loadSettings, saveSettings } from '../shared/settings.js';
import { validateEndpoint, endpointPermission } from '../shared/translate.js';
import { PROVIDER_PRESETS } from '../shared/providers.js';

const byId = (id) => document.getElementById(id);
const translateButton = byId('translate');
const autoSwitch = byId('auto-translate');
const youtubeSwitch = byId('youtube-enabled');
const serviceSelect = byId('service');
const providerSelect = byId('provider');
const AI_SERVICES = new Set(['openai', 'anthropic', 'gemini']);
const SERVICE_NAMES = { google: 'Google 公共服务', libre: '自备 LibreTranslate', openai: 'OpenAI 兼容', anthropic: 'Anthropic', gemini: 'Gemini' };
let activeTab;
let pageAvailable = false;
let actionPending = false;
let refreshing = false;
let settings;

function showStatus(id, text, error = false) {
  const node = byId(id);
  node.textContent = text;
  node.dataset.error = String(error);
  if (id === 'preference-status') node.hidden = !text;
}

function renderPage(status) {
  const restoring = Boolean(status.translated || status.busy);
  translateButton.textContent = restoring ? '恢复原文' : '翻译此页';
  translateButton.dataset.restore = String(restoring);
  translateButton.setAttribute('aria-busy', String(Boolean(status.busy)));
  translateButton.disabled = !pageAvailable || actionPending;
  const note = status.error || (status.busy ? '正在翻译…可随时恢复原文。' : status.translated ? '已显示中文译文。' : '翻译当前页面，保留原文。');
  showStatus('page-status', note, Boolean(status.error));
  const subtitleStatus = byId('youtube-status');
  subtitleStatus.textContent = status.youtubeStatus || '';
  subtitleStatus.hidden = !status.youtubeStatus || !youtubeSwitch.checked;
}

function populateProviders(preferred = 'custom') {
  providerSelect.replaceChildren();
  for (const preset of PROVIDER_PRESETS.filter(p => p.id !== 'custom' && p.service === serviceSelect.value)) {
    const option = document.createElement('option');
    option.value = preset.id;
    option.textContent = preset.name;
    providerSelect.append(option);
  }
  const custom = document.createElement('option');
  custom.value = 'custom';
  custom.textContent = '自定义接口';
  providerSelect.append(custom);
  providerSelect.value = [...providerSelect.options].some(p => p.value === preferred) ? preferred : 'custom';
}

function currentPreset() {
  return PROVIDER_PRESETS.find(p => p.id === providerSelect.value && p.service === serviceSelect.value);
}

function renderService() {
  const service = serviceSelect.value;
  const custom = service !== 'google';
  const ai = AI_SERVICES.has(service);
  byId('custom-fields').hidden = !custom;
  byId('ai-fields').hidden = !ai;
  byId('endpoint').required = custom;
  byId('model').required = ai;
  byId('api-key').required = ['anthropic', 'gemini'].includes(service);
  byId('key-label').textContent = byId('api-key').required ? 'API 密钥' : 'API 密钥（可选）';
  byId('endpoint-label').textContent = service === 'gemini' ? 'API 基础地址（v1beta）' : ai ? '完整 API URL' : '翻译接口地址';
  byId('endpoint').placeholder = service === 'gemini' ? 'https://generativelanguage.googleapis.com/v1beta' : ai ? 'https://example.org/v1/chat/completions' : 'https://example.org/translate';
  byId('service-help').textContent = !custom
    ? '无需密钥；可用性取决于当前网络。翻译内容会发送到此服务。'
    : ai
      ? `${currentPreset()?.help || '模型 ID 请按服务商文档填写。'} 原文发送到所选服务，可能产生服务费用；密钥仅保存在本机。`
      : '使用完整 /translate 接口地址。内容发送到此服务，密钥仅保存在本机。';
}

async function notifyPage() {
  if (!activeTab?.id || !pageAvailable) return;
  try { await chrome.tabs.sendMessage(activeTab.id, { type: 'SETTINGS_CHANGED' }); } catch { /* Storage changes also reach content scripts. */ }
}

async function connectPage() {
  [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let url;
  try { url = new URL(activeTab?.url || ''); } catch { /* Handled as a restricted page below. */ }
  if (!activeTab?.id || !url || !['http:', 'https:'].includes(url.protocol)) {
    byId('page-host').textContent = '当前页面不支持翻译';
    showStatus('page-status', '请在普通网页中使用；浏览器内部页面和 PDF 无法翻译。', true);
    return;
  }
  byId('page-host').textContent = url.hostname;
  try {
    let status;
    try {
      status = await chrome.tabs.sendMessage(activeTab.id, { type: 'PAGE_STATUS' });
    } catch {
      await chrome.scripting.executeScript({ target: { tabId: activeTab.id }, files: ['content/index.js'] });
      status = await chrome.tabs.sendMessage(activeTab.id, { type: 'PAGE_STATUS' });
    }
    if (!status || typeof status.translated !== 'boolean') throw new Error('Missing page status');
    pageAvailable = true;
    renderPage(status);
  } catch {
    showStatus('page-status', '无法读取此页。请刷新后重试，或换一个普通网页。', true);
  }
}

async function refreshPageStatus() {
  if (!pageAvailable || refreshing || actionPending) return;
  refreshing = true;
  try {
    const status = await chrome.tabs.sendMessage(activeTab.id, { type: 'PAGE_STATUS' });
    if (status) renderPage(status);
  } catch {
    pageAvailable = false;
    translateButton.disabled = true;
    showStatus('page-status', '网页已更新，请重新打开弹窗。', true);
  } finally { refreshing = false; }
}

translateButton.addEventListener('click', async () => {
  if (!pageAvailable || actionPending) return;
  actionPending = true;
  translateButton.disabled = true;
  try {
    const status = await chrome.tabs.sendMessage(activeTab.id, { type: 'PAGE_TOGGLE' });
    if (status) renderPage(status);
  } catch {
    showStatus('page-status', '翻译未能启动，请刷新网页后重试。', true);
  } finally {
    actionPending = false;
    translateButton.disabled = !pageAvailable;
    void refreshPageStatus();
  }
});

autoSwitch.addEventListener('change', async () => {
  const enabled = autoSwitch.checked;
  // Start permission request before awaiting anything: Chromium requires a user gesture.
  const permission = enabled ? chrome.permissions.request({ origins: ['http://*/*', 'https://*/*'] }) : Promise.resolve(true);
  autoSwitch.disabled = true;
  try {
    if (!await permission) throw new Error('开启自动翻译需要网页访问权限。');
    settings = await saveSettings({ autoTranslate: enabled });
    showStatus('preference-status', enabled ? '已开启，之后打开的网页会自动翻译。' : '已关闭自动翻译。');
    await notifyPage();
  } catch (error) {
    autoSwitch.checked = Boolean(settings?.autoTranslate);
    showStatus('preference-status', error.message === '开启自动翻译需要网页访问权限。' ? error.message : '设置未保存，请重新打开弹窗后重试。', true);
  } finally { autoSwitch.disabled = false; }
});

youtubeSwitch.addEventListener('change', async () => {
  youtubeSwitch.disabled = true;
  try {
    settings = await saveSettings({ youtubeEnabled: youtubeSwitch.checked });
    showStatus('preference-status', youtubeSwitch.checked ? '已开启 YouTube 双语字幕。' : '已关闭 YouTube 双语字幕。');
    await notifyPage();
    void refreshPageStatus();
  } catch {
    youtubeSwitch.checked = Boolean(settings?.youtubeEnabled);
    showStatus('preference-status', '设置未保存，请重新打开弹窗后重试。', true);
  } finally { youtubeSwitch.disabled = false; }
});

serviceSelect.addEventListener('change', () => {
  showStatus('preference-status', '');
  const first = PROVIDER_PRESETS.find(p => p.id !== 'custom' && p.service === serviceSelect.value);
  populateProviders(first?.id);
  byId('endpoint').value = first?.endpoint || '';
  byId('api-key').value = '';
  byId('model').value = '';
  renderService();
});
providerSelect.addEventListener('change', () => {
  const preset = currentPreset();
  if (preset) byId('endpoint').value = preset.endpoint;
  byId('api-key').value = '';
  renderService();
});

byId('endpoint').addEventListener('input', () => {
  const preset = currentPreset();
  if (preset && byId('endpoint').value.trim() !== preset.endpoint) {
    providerSelect.value = 'custom';
    renderService();
  }
});
byId('service-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = byId('save-service');
  button.disabled = true;
  showStatus('settings-status', '');
  try {
    const service = serviceSelect.value;
    const ai = AI_SERVICES.has(service);
    let patch = { service, endpoint: '', apiKey: '', model: '', preset: 'custom' };
    if (service !== 'google') {
      const endpoint = validateEndpoint(byId('endpoint').value.trim());
      const allowed = await chrome.permissions.request({ origins: [endpointPermission(endpoint)] });
      if (!allowed) throw new Error('尚未授予此服务的访问权限，配置未保存。');
      patch = { service, endpoint, apiKey: byId('api-key').value.trim(), model: ai ? byId('model').value.trim() : '', preset: ai ? providerSelect.value : 'custom' };
    }
    settings = await saveSettings(patch);
    byId('service-name').textContent = SERVICE_NAMES[settings.service];
    byId('endpoint').value = settings.endpoint;
    byId('api-key').value = settings.apiKey;
    showStatus('settings-status', '服务已保存。下次翻译使用新服务。');
    await notifyPage();
  } catch (error) {
    const safe = ['尚未授予此服务的访问权限，配置未保存。', '请输入完整的翻译接口 URL。', '接口须为 HTTPS（本机可用 HTTP），且不能包含账号、查询参数或片段。'];
    showStatus('settings-status', safe.includes(error.message) ? error.message : '服务未保存，请检查地址、模型、密钥与权限后重试。', true);
  } finally { button.disabled = false; }
});

autoSwitch.disabled = true;
youtubeSwitch.disabled = true;
try {
  settings = await loadSettings();
  autoSwitch.checked = settings.autoTranslate;
  youtubeSwitch.checked = settings.youtubeEnabled;
  serviceSelect.value = settings.service;
  populateProviders(settings.preset);
  byId('endpoint').value = settings.endpoint;
  byId('api-key').value = settings.apiKey;
  byId('model').value = settings.model || '';
  byId('service-name').textContent = SERVICE_NAMES[settings.service];
  renderService();
  autoSwitch.disabled = false;
  youtubeSwitch.disabled = false;
} catch { showStatus('preference-status', '无法读取设置，请重新加载扩展。', true); }
try { await connectPage(); } catch { showStatus('page-status', '无法读取当前页面，请重新打开弹窗。', true); }
const refreshTimer = setInterval(() => { void refreshPageStatus(); }, 750);
window.addEventListener('pagehide', () => clearInterval(refreshTimer), { once: true });
