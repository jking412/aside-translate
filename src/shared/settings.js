import { SERVICES, validateServiceSettings } from './translate.js';

export const DEFAULT_SETTINGS = Object.freeze({
  autoTranslate: false,
  youtubeEnabled: true,
  service: 'google',
  endpoint: '',
  apiKey: '',
  model: '',
  preset: 'custom',
});

export function normalizeSettings(value = {}) {
  return {
    autoTranslate: value.autoTranslate === true,
    youtubeEnabled: value.youtubeEnabled !== false,
    service: SERVICES.includes(value.service) ? value.service : 'google',
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
  await chrome.storage.local.set(settings);
  return settings;
}
