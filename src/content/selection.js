import { splitText } from './page.js';

export const MAX_SELECTION_LENGTH = 20000;
const EDITABLE = 'input,textarea,select,[contenteditable]:not([contenteditable="false"])';
const PRIVATE = 'input,textarea,select,[contenteditable]:not([contenteditable="false"]),[data-aside-ignore],[data-lt-ignore],#aside-floating,#aside-selection';
const css = `
:host{all:initial;position:fixed;z-index:2147483647;display:block;direction:ltr;font:14px/1.55 "Microsoft YaHei UI",system-ui,sans-serif;color:#203047;isolation:isolate}:host([hidden]){display:none!important}
*{box-sizing:border-box}[hidden]{display:none!important}button{font:inherit;cursor:pointer}button:focus-visible{outline:3px solid #7fb3ff;outline-offset:3px}
.trigger{display:block;padding:7px 14px;min-height:36px;border:0;border-radius:18px;background:#165dcc;color:#fff;box-shadow:0 3px 14px #153d7030;font-weight:600;white-space:nowrap}
.trigger:hover{background:#104da9}.card{width:360px;max-width:calc(100vw - 16px);max-height:calc(100vh - 16px);overflow:auto;padding:16px;background:#fff;border-radius:12px;box-shadow:0 5px 28px #153d7038;overscroll-behavior:contain}
.heading{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px}.heading strong{font-size:15px;font-weight:650}.close{display:grid;place-items:center;width:28px;height:28px;padding:5px;border:0;border-radius:6px;background:transparent;color:#627187}.close:hover{background:#edf3fc;color:#165dcc}
.caption{margin:0 0 5px;font-size:12px;color:#627187}.source{margin:0 0 14px;max-height:100px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;user-select:text}.translation{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;user-select:text;font-size:15px;line-height:1.65}
.status{margin:0;color:#627187;font-size:13px;white-space:pre-wrap;overflow-wrap:anywhere}.status[data-error=true]{color:#a23124}.retry{margin-top:12px;min-height:34px;padding:6px 13px;background:#edf3fc;color:#165dcc;border:0;border-radius:7px;font-weight:600}
@media(prefers-color-scheme:dark){:host{color:#f0f4fc}.card{background:#202a3a}.caption,.status,.close{color:#c0ccde}.retry,.close:hover{background:#314663;color:#e3edff}.status[data-error=true]{color:#ffb7a9}}
@media(forced-colors:active){.trigger,.card,.retry{border:1px solid ButtonText}.status[data-error=true]{color:CanvasText}}
`;

function elementOf(node) { return node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement; }
function matches(a, b) {
  return !!a && !!b && a.text === b.text && a.range.startContainer === b.range.startContainer && a.range.startOffset === b.range.startOffset
    && a.range.endContainer === b.range.endContainer && a.range.endOffset === b.range.endOffset;
}

/** Read only an explicit, noneditable text selection. No text is sent here. */
function selectionSnapshot() {
  let active = document.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  if (active?.closest?.(EDITABLE)) return null;
  const selection = document.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
  const range = selection.getRangeAt(0);
  const start = elementOf(range.startContainer), end = elementOf(range.endContainer);
  if (!start || !end || start.closest(PRIVATE) || end.closest(PRIVATE)) return null;
  // Shadow-root content can hold another extension's controls, including ours.
  if (start.getRootNode() !== document || end.getRootNode() !== document) return null;
  const ancestor = elementOf(range.commonAncestorContainer);
  if (ancestor?.querySelectorAll) for (const node of ancestor.querySelectorAll(PRIVATE)) {
    try { if (range.intersectsNode(node)) return null; } catch { return null; }
  }
  const text = selection.toString().trim();
  if (!text) return null;
  const rectangles = [...range.getClientRects()].filter(rect => rect.width > 0 || rect.height > 0);
  const rect = rectangles.at(-1) || range.getBoundingClientRect();
  if (!rect || !(rect.width || rect.height)) return null;
  return { text, range: range.cloneRange(), rect: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom } };
}

/** A local, manual selection UI. It never writes selected source text back. */
export class SelectionTranslator {
  constructor({ translate }) {
    this.translate = translate;
    this.enabled = false;
    this.revision = 0;
    this.snapshot = null;
    this.dismissed = null;
    this.cleanup = [];
  }

  start() {
    if (this.enabled) return;
    this.enabled = true;
    const listen = (target, name, fn, options) => {
      target.addEventListener(name, fn, options);
      this.cleanup.push(() => target.removeEventListener(name, fn, options));
    };
    listen(document, 'pointerdown', event => {
      if (this.owns(event)) { this.interactingWithView = !event.composedPath().includes(this.trigger); return; }
      this.interactingWithView = false;
      this.reset();
      this.pointer = { x: event.clientX, y: event.clientY, moved: false };
    }, true);
    listen(document, 'pointermove', event => {
      if (this.pointer && Math.hypot(event.clientX - this.pointer.x, event.clientY - this.pointer.y) > 3) this.pointer.moved = true;
    }, true);
    listen(document, 'pointerup', event => {
      if (this.owns(event)) return;
      if (this.pointer?.moved || event.detail > 1) this.dismissed = null;
      this.pointer = null;
      this.schedule();
    }, true);
    listen(document, 'dblclick', event => {
      if (this.owns(event)) return;
      this.pointer = null; this.dismissed = null; this.schedule();
    });
    listen(document, 'pointercancel', () => { this.pointer = null; this.reset(); }, true);
    listen(document, 'selectionchange', () => { if (!this.pointer) this.schedule(); });
    listen(document, 'focusin', event => {
      if (this.owns(event)) return;
      this.interactingWithView = false;
      if (event.composedPath().some(node => node instanceof Element && node.matches(EDITABLE))) this.reset();
    }, true);
    listen(document, 'keyup', event => {
      if (this.owns(event)) return;
      if (event.shiftKey && /^(?:Arrow|Home|End|Page)/.test(event.key)) this.dismissed = null;
      if (event.key !== 'Escape') this.schedule();
    });
    listen(document, 'keydown', event => { if (event.key === 'Escape' && this.snapshot) this.reset(); });
    listen(document, 'scroll', event => { if (!this.owns(event)) this.reset(); }, true);
    listen(window, 'resize', () => { this.pointer = null; this.reset(); });
    listen(window, 'blur', () => { this.pointer = null; this.reset(); });
    listen(window, 'pagehide', () => { this.pointer = null; this.reset(); });
  }

  owns(event) {
    return !!this.host && (event.composedPath?.().includes(this.host) || event.target?.getRootNode?.() === this.shadow);
  }

  schedule() {
    clearTimeout(this.selectionTimer);
    this.selectionTimer = setTimeout(() => this.refresh(), 25);
  }

  refresh() {
    if (!this.enabled || this.pointer) return;
    const selection = document.getSelection();
    // Selecting/copying inside the result must not replace it with a new request.
    if (elementOf(selection?.anchorNode)?.getRootNode() === this.shadow) return;
    const next = selectionSnapshot();
    // Chromium can retarget a shadow selection to the host. Keep result-copy
    // interactions open, but still accept a genuinely new external selection.
    if (this.interactingWithView) {
      if (!next || matches(next, this.snapshot)) return;
      this.interactingWithView = false;
    }
    if (!next) { this.reset(); return; }
    if (matches(next, this.snapshot) || matches(next, this.dismissed)) return;
    this.cancel(); this.snapshot = next; this.dismissed = null;
    this.ensureView();
    this.card.hidden = true; this.trigger.hidden = false;
    this.host.hidden = false;
    this.position();
  }

  ensureView() {
    if (this.host?.isConnected) return;
    const host = document.createElement('div');
    host.id = 'aside-selection'; host.setAttribute('data-aside-ignore', ''); host.setAttribute('data-lt-ignore', '');
    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style'); style.textContent = css;
    shadow.append(style);
    const trigger = document.createElement('button'); trigger.className = 'trigger'; trigger.type = 'button';
    trigger.dataset.role = 'trigger'; trigger.textContent = '翻译'; trigger.setAttribute('aria-label', '翻译选中文字');
    const card = document.createElement('section'); card.className = 'card'; card.dataset.role = 'card';
    card.setAttribute('role', 'region'); card.setAttribute('aria-label', '划词翻译'); card.hidden = true;
    const heading = document.createElement('div'); heading.className = 'heading';
    const title = document.createElement('strong'); title.textContent = '划词翻译';
    const close = document.createElement('button'); close.type = 'button'; close.className = 'close'; close.dataset.role = 'close';
    close.setAttribute('aria-label', '关闭划词翻译');
    close.innerHTML = '<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';
    heading.append(title, close);
    const sourceCaption = document.createElement('p'); sourceCaption.className = 'caption'; sourceCaption.textContent = '原文';
    const source = document.createElement('p'); source.className = 'source'; source.dataset.role = 'source'; source.dir = 'auto';
    const targetCaption = document.createElement('p'); targetCaption.className = 'caption'; targetCaption.textContent = '中文译文';
    const target = document.createElement('p'); target.className = 'translation'; target.dataset.role = 'target'; target.lang = 'zh-CN';
    const status = document.createElement('p'); status.className = 'status'; status.dataset.role = 'status';
    status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    const retry = document.createElement('button'); retry.className = 'retry'; retry.type = 'button'; retry.dataset.role = 'retry';
    retry.textContent = '重试翻译'; retry.hidden = true;
    card.append(heading, sourceCaption, source, targetCaption, target, status, retry);
    shadow.append(trigger, card); document.documentElement.append(host);
    this.host = host; this.shadow = shadow; this.trigger = trigger; this.card = card;
    this.source = source; this.target = target; this.status = status; this.retry = retry;
    // Prevent mouse activation from collapsing the source selection before click.
    for (const button of [trigger, close, retry]) button.addEventListener('pointerdown', event => { event.preventDefault(); });
    trigger.addEventListener('click', () => { void this.run(); });
    retry.addEventListener('click', () => { void this.run(); });
    close.addEventListener('click', () => this.reset());
  }

  position() {
    if (!this.host || !this.snapshot) return;
    const margin = 8, gap = 7;
    const viewport = window.visualViewport;
    const left = viewport?.offsetLeft || 0, top = viewport?.offsetTop || 0;
    const width = viewport?.width || innerWidth, height = viewport?.height || innerHeight;
    const rect = this.snapshot.rect;
    this.host.style.left = '0px'; this.host.style.top = '0px';
    const size = this.host.getBoundingClientRect();
    const x = Math.max(left + margin, Math.min(rect.right, left + width - size.width - margin));
    const below = rect.bottom + gap;
    const y = below + size.height <= top + height - margin ? below : rect.top - gap - size.height;
    this.host.style.left = `${x}px`;
    this.host.style.top = `${Math.max(top + margin, Math.min(y, top + height - size.height - margin))}px`;
  }

  cancel() {
    this.revision++;
    this.controller?.abort(); this.controller = null;
  }

  async run() {
    if (!this.enabled || !this.snapshot) return;
    this.cancel();
    const snapshot = this.snapshot, revision = this.revision;
    this.trigger.hidden = true; this.card.hidden = false; this.host.hidden = false;
    this.source.textContent = snapshot.text; this.target.textContent = '';
    this.status.dataset.error = 'false'; this.retry.hidden = true;
    this.card.setAttribute('aria-busy', 'false');
    if (snapshot.text.length > MAX_SELECTION_LENGTH) {
      this.status.textContent = `选中文字超过 ${MAX_SELECTION_LENGTH.toLocaleString('zh-CN')} 字，请缩小选区后再翻译。`;
      this.status.dataset.error = 'true'; this.position(); return;
    }
    const controller = new AbortController(); this.controller = controller;
    this.card.setAttribute('aria-busy', 'true');
    this.status.textContent = '正在翻译…'; this.position();
    try {
      let result = '';
      for (const part of splitText(snapshot.text)) {
        if (controller.signal.aborted) return;
        const leading = part.match(/^\s*/)[0], trailing = part.match(/\s*$/)[0];
        const text = part.trim();
        result += text ? leading + await this.translate(text, { signal: controller.signal }) + trailing : part;
      }
      if (controller.signal.aborted || revision !== this.revision || snapshot !== this.snapshot || !this.enabled) return;
      this.target.textContent = result;
      this.status.textContent = ''; this.position();
    } catch (error) {
      if (controller.signal.aborted || revision !== this.revision || snapshot !== this.snapshot || !this.enabled) return;
      this.status.textContent = error?.message || '翻译失败，请检查当前翻译服务后重试。';
      this.status.dataset.error = 'true'; this.retry.hidden = false; this.position();
    } finally {
      if (revision === this.revision) this.card?.setAttribute('aria-busy', 'false');
    }
  }

  reset() {
    this.dismissed = this.snapshot || this.dismissed;
    this.cancel(); this.snapshot = null; this.interactingWithView = false;
    clearTimeout(this.selectionTimer);
    if (this.host) this.host.hidden = true;
  }

  stop() {
    this.enabled = false; this.pointer = null; this.reset();
    this.cleanup.splice(0).forEach(dispose => dispose());
    this.host?.remove(); this.host = null; this.shadow = null;
    this.dismissed = null;
  }
}
