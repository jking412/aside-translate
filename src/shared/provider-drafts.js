import { PROVIDER_PRESETS } from './providers.js';
const PREFIX = 'asideProviderDraftV1:';
const SELECTION = 'asideProviderSelectionV1';
const FIELDS = ['endpoint', 'apiKey', 'model'];
const SERVICES = new Set(['bing', 'google', 'libre', 'openai', 'anthropic', 'gemini']);
export const PUBLIC_SERVICES = new Set(['bing', 'google']);
export const SERVICE_NAMES = { bing: '微软翻译', google: 'Google 公共服务', libre: '自备 LibreTranslate', openai: 'OpenAI 兼容', anthropic: 'Anthropic', gemini: 'Gemini' };
export function serviceName(settings) {
  return settings.service === 'openai' && settings.preset === 'deepseek' ? 'DeepSeek' : SERVICE_NAMES[settings.service] || SERVICE_NAMES.bing;
}
export function providerPreset(service, preset) { return PROVIDER_PRESETS.find(item => item.id === preset && item.id !== 'custom' && item.service === service); }
export function firstPreset(service) { return PROVIDER_PRESETS.find(item => item.id !== 'custom' && item.service === service)?.id || 'custom'; }
export function normalizeDraft(value = {}) {
  const service = SERVICES.has(value.service) ? value.service : 'bing';
  const preset = providerPreset(service, value.preset) ? value.preset : 'custom';
  const defaults = providerPreset(service, preset);
  return { service, preset,
    endpoint: PUBLIC_SERVICES.has(service) ? '' : String(value.endpoint ?? defaults?.endpoint ?? '').slice(0, 2048),
    apiKey: PUBLIC_SERVICES.has(service) ? '' : String(value.apiKey ?? '').slice(0, 1024),
    model: PUBLIC_SERVICES.has(service) || service === 'libre' ? '' : String(value.model ?? defaults?.defaultModel ?? '').slice(0, 1024),
  };
}
const draftKey = draft => PREFIX + draft.service + ':' + draft.preset;

/** Local drafts use one key per field: simultaneous windows cannot replay stale whole-provider snapshots. */
export async function loadProviderDraftStore(settings, storage = chrome.storage.local) {
  const cache = { ...await storage.get(null) };
  const active = normalizeDraft(settings);
  const activeKey = draftKey(active);
  const listeners = new Set(), pending = new Set();
  const get = (service, preset) => {
    const base = normalizeDraft({ service, preset }), key = draftKey(base);
    const values = { ...base, ...(key === activeKey ? active : {}), ...(cache[key] || {}) };
    for (const field of FIELDS) if (key + ':' + field in cache) values[field] = cache[key + ':' + field];
    return normalizeDraft(values);
  };
  const ingest = changes => {
    const affected = new Map();
    for (const [key, change] of Object.entries(changes)) {
      if (change.newValue === undefined) delete cache[key]; else cache[key] = change.newValue;
      if (!key.startsWith(PREFIX)) continue;
      const [service, preset, field] = key.slice(PREFIX.length).split(':');
      if (!SERVICES.has(service)) continue;
      const id = service + ':' + preset;
      const fields = affected.get(id)?.fields || new Set();
      for (const name of field && FIELDS.includes(field) ? [field] : FIELDS) fields.add(name);
      affected.set(id, { service, preset, fields });
    }
    for (const item of affected.values()) for (const fn of listeners) fn(get(item.service, item.preset), [...item.fields]);
  };
  const changed = (changes, area) => { if (area === 'local') ingest(changes); };
  chrome.storage.onChanged?.addListener(changed);
  const write = patch => {
    Object.assign(cache, patch);
    // Start immediately during input. Closing a popup must not cancel a debounce or queued callback.
    const promise = storage.set(patch); pending.add(promise);
    promise.then(() => pending.delete(promise), () => pending.delete(promise));
    return promise;
  };
  const raw = cache[SELECTION] || {};
  const selected = normalizeDraft({ service: raw.service ?? active.service, preset: raw.preset ?? active.preset });
  return {
    selected: get(selected.service, selected.preset), get,
    lastPreset(service) {
      const saved = cache[SELECTION + ':' + service] ?? raw.byService?.[service];
      return providerPreset(service, saved) ? saved : firstPreset(service);
    },
    save(value, { fields = FIELDS } = {}) {
      const draft = normalizeDraft(value), key = draftKey(draft);
      const patch = { [SELECTION]: { service: draft.service, preset: draft.preset }, [SELECTION + ':' + draft.service]: draft.preset };
      for (const field of fields) if (FIELDS.includes(field)) patch[key + ':' + field] = draft[field];
      return write(patch);
    },
    async read(service, preset) {
      await Promise.all([...pending]);
      const base = normalizeDraft({ service, preset }), key = draftKey(base);
      const keys = [key, ...FIELDS.map(field => key + ':' + field)];
      const latest = await storage.get(keys);
      ingest(Object.fromEntries(keys.map(name => [name, { newValue: latest[name] }])));
      return get(service, preset);
    },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    dispose() { listeners.clear(); chrome.storage.onChanged?.removeListener(changed); },
  };
}
