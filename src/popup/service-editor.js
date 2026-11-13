import { loadSettings, saveSettings } from '../shared/settings.js';
import { validateEndpoint } from '../shared/translate.js';
import { PROVIDER_PRESETS } from '../shared/providers.js';
import { loadProviderDraftStore, PUBLIC_SERVICES, SERVICE_NAMES, providerPreset } from '../shared/provider-drafts.js';
const AI = new Set(['openai', 'anthropic', 'gemini']);
const markup = `
<form id="service-form">
  <div class="field"><label for="service">服务</label><select id="service"><option value="bing">微软翻译（免费）</option><option value="deepseek">DeepSeek</option><option value="google">Google 公共服务</option><option value="libre">自备 LibreTranslate</option><option value="openai">OpenAI 兼容</option><option value="anthropic">Anthropic</option><option value="gemini">Gemini</option></select></div>
  <div id="ai-fields" hidden>
    <div id="provider-field" class="field"><label for="provider">服务商预设</label><select id="provider"></select></div>
    <label class="field" for="model">模型 ID<input id="model" type="text" list="model-list" placeholder="选择推荐模型或填写自定义模型 ID" autocomplete="off" spellcheck="false" /><datalist id="model-list"></datalist></label>
  </div>
  <div id="custom-fields" hidden>
    <label class="field" for="endpoint"><span id="endpoint-label">翻译接口地址</span><input id="endpoint" type="url" placeholder="https://example.org/translate" autocomplete="url" spellcheck="false" /></label>
    <label class="field" for="api-key"><span id="key-label">API 密钥（可选）</span><input id="api-key" type="password" autocomplete="off" spellcheck="false" /></label>
  </div>
  <p id="service-help" class="help"></p>
  <p class="help draft-help">输入自动保留为本机草稿。点击保存后才用于翻译；密钥不会发送到其他服务。</p>
  <button id="save-service" class="secondary" type="submit" disabled>保存服务</button>
  <p id="settings-status" class="status" role="status" aria-live="polite"></p>
</form>`;

export async function mountServiceEditor(container, { settings, onSaved = () => {} } = {}) {
  container.innerHTML = markup;
  const field = id => container.querySelector('#' + id);
  const setStatus = (text, error = false) => {
    field('settings-status').textContent = text;
    field('settings-status').dataset.error = String(error);
  };
  const controls = [...container.querySelectorAll('input,select,button')];
  controls.forEach(node => { node.disabled = true; });
  const active = settings || await loadSettings();
  const store = await loadProviderDraftStore(active);
  let current = store.selected;
  function snapshot() {
    return { service: current.service, preset: current.preset, endpoint: field('endpoint').value, apiKey: field('api-key').value, model: field('model').value };
  }
  function persist(fields = []) {
    const promise = store.save(snapshot(), { fields });
    promise.then(() => setStatus('草稿已保留在本机，保存后启用。'), () => setStatus('草稿未能保留，请先复制未保存的配置后重试。', true));
    return promise;
  }
  function render(draft) {
    current = { ...draft };
    const deepseek = draft.service === 'openai' && draft.preset === 'deepseek';
    field('service').value = deepseek ? 'deepseek' : draft.service;
    field('provider-field').hidden = deepseek;
    const ai = AI.has(draft.service);
    const custom = !PUBLIC_SERVICES.has(draft.service);
    field('provider').replaceChildren();
    const presets = PROVIDER_PRESETS.filter(p => p.id !== 'custom' && p.id !== 'deepseek' && p.service === draft.service);
    for (const preset of [...presets, { id: 'custom', name: '自定义接口' }]) {
      const option = document.createElement('option'); option.value = preset.id; option.textContent = preset.name; field('provider').append(option);
    }
    // The dedicated entry still writes the original openai/deepseek draft keys.
    if (deepseek) {
      const option = document.createElement('option');
      option.value = 'deepseek'; option.textContent = 'DeepSeek'; field('provider').append(option);
    }
    field('provider').value = draft.preset;
    field('endpoint').value = draft.endpoint;
    field('api-key').value = draft.apiKey;
    field('model').value = draft.model;
    field('ai-fields').hidden = !ai;
    field('custom-fields').hidden = !custom;
    field('endpoint').required = custom;
    field('model').required = ai;
    field('api-key').required = ['anthropic', 'gemini'].includes(draft.service) || draft.preset === 'deepseek';
    field('key-label').textContent = field('api-key').required ? 'API 密钥' : 'API 密钥（可选）';
    field('endpoint-label').textContent = draft.service === 'gemini' ? 'API 基础地址（v1beta）' : ai ? '完整 API URL' : '翻译接口地址';
    const preset = providerPreset(draft.service, draft.preset);
    field('model-list').replaceChildren();
    for (const model of preset?.models || []) { const option = document.createElement('option'); option.value = model; field('model-list').append(option); }
    field('service-help').textContent = !custom
      ? `${SERVICE_NAMES[draft.service]}无需密钥。可用性取决于当前网络，翻译内容会发送到此服务。`
      : ai ? `${preset?.help || '填写支持此协议的完整接口与模型 ID。'} 原文发送到所选服务，可能产生服务费用。`
        : '使用完整 /translate 接口地址。内容发送到此服务，密钥仅保存在本机。';
  }
  field('service').addEventListener('change', () => {
    const service = field('service').value;
    const protocol = service === 'deepseek' ? 'openai' : service;
    let preset = service === 'deepseek' ? 'deepseek' : store.lastPreset(protocol);
    if (service === 'openai' && preset === 'deepseek') preset = 'openai';
    render(store.get(protocol, preset));
    void persist();
  });
  field('provider').addEventListener('change', () => {
    const preset = field('provider').value;
    render(store.get(current.service, preset));
    void persist();
  });
  const fieldIds = { endpoint: 'endpoint', apiKey: 'api-key', model: 'model' };
  for (const [name, id] of Object.entries(fieldIds)) {
    const saveInput = () => { void persist([name]); };
    field(id).addEventListener('input', saveInput);
    field(id).addEventListener('change', saveInput);
    field(id).addEventListener('blur', () => { field(id).value = store.get(current.service, current.preset)[name]; });
  }
  const unsubscribe = store.subscribe((draft, fields) => {
    if (draft.service !== current.service || draft.preset !== current.preset) return;
    for (const name of fields) {
      const input = field(fieldIds[name]);
      if (input !== document.activeElement || !document.hasFocus()) input.value = draft[name];
    }
  });
  window.addEventListener('pagehide', () => { unsubscribe(); store.dispose(); }, { once: true });
  field('service-form').addEventListener('submit', async event => {
    event.preventDefault();
    const button = field('save-service'); button.disabled = true;
    try {
      await persist();
      const draft = await store.read(current.service, current.preset);
      if (!PUBLIC_SERVICES.has(draft.service)) draft.endpoint = validateEndpoint(draft.endpoint.trim());
      const saved = await saveSettings(draft);
      await store.save(saved);
      setStatus('服务已保存。下次翻译使用新服务。');
      await onSaved(saved);
    } catch (error) {
      const safe = new Set(['请输入完整的翻译接口 URL。', '接口须为 HTTPS（本机可用 HTTP），且不能包含账号、查询参数或片段。', '密钥不能包含换行，请重新粘贴。', '请填写有效的模型 ID（最长 256 字符，不能包含控制字符）。', '此服务需要 API 密钥，请填写后保存。', '请填写有效的 Gemini 模型 ID。']);
      setStatus((safe.has(error.message) ? error.message : '服务未保存，请检查配置或重新加载设置页。') + ' 草稿仍保留在本机。', true);
    }
    finally { button.disabled = false; }
  });
  render(current);
  controls.forEach(node => { node.disabled = false; });
  return { getDraft: snapshot };
}
