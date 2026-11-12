import { SERVICES, validateServiceSettings } from './translate.js';

export const DEFAULT_SETTINGS = Object.freeze({
  autoTranslate: false,
  youtubeEnabled: true,
  youtubeHumanPreferred: true,
  youtubePreTranslation: true,
  floatingEnabled: true,
  selectionEnabled: true,
  service: 'bing',
  endpoint: '',
  apiKey: '',
  model: '',
  preset: 'custom',
});

export function normalizeSettings(value = {}) {
  return {
    autoTranslate: value.autoTranslate === true,
    youtubeEnabled: value.youtubeEnabled !== false,
    youtubeHumanPreferred: value.youtubeHumanPreferred !== false,
    youtubePreTranslation: value.youtubePreTranslation !== false,
    floatingEnabled: value.floatingEnabled !== false,
    selectionEnabled: value.selectionEnabled !== false,
    service: SERVICES.includes(value.service) ? value.service : 'bing',
    endpoint: typeof value.endpoint === 'string' ? value.endpoint.slice(0, 2048) : '',
    apiKey: typeof value.apiKey === 'string' ? value.apiKey.slice(0, 1024) : '',
    model: typeof value.model === 'string' ? value.model.trim().slice(0, 1024) : '',
    preset: typeof value.preset === 'string' && value.preset.trim() ? value.preset.trim().slice(0, 64) : 'custom',
  };
}

export async function loadSettings() {
  return normalizeSettings(await chrome.storage.local.get(Object.keys(DEFAULT_SETTINGS)));
}

export async function saveSettings(patch) {
  const settings = validateServiceSettings(normalizeSettings({ ...await loadSettings(), ...patch }));
  // Write only requested fields so another window's unrelated preference cannot be replayed from an old read.
  const changes = Object.fromEntries(Object.keys(patch).filter(key => key in DEFAULT_SETTINGS).map(key => [key, settings[key]]));
  await chrome.storage.local.set(changes);
  return loadSettings();
}
