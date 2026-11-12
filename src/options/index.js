import { DEFAULT_SETTINGS, loadSettings, saveSettings } from '../shared/settings.js';
import { mountServiceEditor } from '../popup/service-editor.js';
const status = document.getElementById('preference-status');
const settings = await loadSettings();
for (const [id, key] of [['auto-translate', 'autoTranslate'], ['selection-enabled', 'selectionEnabled'], ['youtube-enabled', 'youtubeEnabled'], ['youtube-human', 'youtubeHumanPreferred'], ['youtube-prefetch', 'youtubePreTranslation'], ['floating-enabled', 'floatingEnabled']]) {
  const control = document.getElementById(id); control.checked = settings[key]; control.disabled = false;
  control.addEventListener('change', async () => {
    const previous = !control.checked; control.disabled = true;
    try { await saveSettings({ [key]: control.checked }); status.textContent = '设置已保存。'; status.dataset.error = 'false'; }
    catch { control.checked = previous; status.textContent = '设置未保存，请稍后重试。'; status.dataset.error = 'true'; }
    finally { control.disabled = false; }
  });
}
await mountServiceEditor(document.getElementById('service-editor'), { settings });

const preferencesChanged = (changes, area) => {
  if (area !== 'local') return;
  for (const [id, key] of [['auto-translate', 'autoTranslate'], ['selection-enabled', 'selectionEnabled'], ['youtube-enabled', 'youtubeEnabled'], ['youtube-human', 'youtubeHumanPreferred'], ['youtube-prefetch', 'youtubePreTranslation'], ['floating-enabled', 'floatingEnabled']]) if (key in changes) document.getElementById(id).checked = changes[key].newValue ?? DEFAULT_SETTINGS[key];
};
chrome.storage.onChanged?.addListener(preferencesChanged);
window.addEventListener('pagehide', () => chrome.storage.onChanged?.removeListener(preferencesChanged), { once: true });
