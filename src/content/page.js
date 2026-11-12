const TARGET = '[data-aside-translation]';
const EXCLUDED = `script,style,noscript,template,svg,math,pre,input,textarea,select,option,button,[contenteditable]:not([contenteditable="false"]),[translate="no"],.notranslate,[data-lt-ignore],[data-aside-ignore],[aria-hidden="true"],#aside-floating,${TARGET},#movie_player,.html5-video-player,video`;
const INLINE_DISPLAYS = new Set(['inline', 'inline-block', 'inline-flex', 'inline-grid', 'inline-table', 'contents', 'ruby', 'ruby-base', 'ruby-text']);
const RICH_TAGS = new Set(['A', 'B', 'STRONG', 'EM', 'I', 'U', 'S', 'DEL', 'INS', 'SMALL', 'SUB', 'SUP', 'MARK', 'ABBR', 'CODE', 'KBD', 'SAMP', 'TT']);
const PROTECTED = new Set(['CODE', 'KBD', 'SAMP', 'TT']);
const STYLE_ID = 'aside-page-translation-style';

export function splitText(text, limit = 1800) {
  const parts = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + limit, text.length);
    if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end--;
    if (end < text.length) {
      const window = text.slice(start, end);
      const boundary = Math.max(window.lastIndexOf(' '), window.lastIndexOf('\n'));
      if (boundary >= limit / 2) end = start + boundary + 1;
    }
    parts.push(text.slice(start, end)); start = end;
  }
  return parts;
}

export function shouldTranslate(text) {
  const value = text.trim();
  return value.length > 1 && /\p{L}/u.test(value) && /[^\p{Script=Han}\p{P}\p{N}\p{Z}\p{S}\s]/u.test(value)
    && !/^https?:\/\//i.test(value);
}

export function isInlineTranslation(text, display = '') {
  return display.includes('flex') || (text.length <= 24 && text.trim().split(/\s+/).length <= 4 && !text.includes('\n'));
}

function escapeText(text) {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function topChild(node, container) {
  let current = node;
  while (current.parentNode && current.parentNode !== container) current = current.parentNode;
  return current;
}

function paragraphSnapshot(container, entries) {
  const roots = [];
  for (const entry of entries) {
    const root = topChild(entry.node, container);
    if (!roots.includes(root)) roots.push(root);
  }
  const markers = new Map();
  const included = new Set(entries.map(entry => entry.node));
  const serialize = node => {
    if (node.nodeType === Node.TEXT_NODE) return included.has(node) ? escapeText(node.data) : '';
    if (!(node instanceof Element) || node.matches(EXCLUDED)) return '';
    if (PROTECTED.has(node.tagName)) {
      const id = markers.size + 1;
      markers.set(id, node);
      return `<i${id}>ASIDE_KEEP_${id}</i${id}>`;
    }
    const children = [...node.childNodes].map(serialize).join('');
    if (!children || !RICH_TAGS.has(node.tagName)) return children;
    const id = markers.size + 1;
    markers.set(id, node);
    return `<i${id}>${children}</i${id}>`;
  };
  const html = roots.map(serialize).join('').trim();
  const plain = entries.map(entry => entry.value).join('').replace(/\s+/g, ' ').trim();
  const translatableText = entries.filter(entry => !(entry.node instanceof Element && PROTECTED.has(entry.node.tagName))).map(entry => entry.value).join('').trim();
  const plainRequest = entries.map(entry => {
    if (!(entry.node instanceof Element && PROTECTED.has(entry.node.tagName))) return entry.value;
    const id = [...markers].find(([, node]) => node === entry.node)?.[0];
    return id ? 'ASIDE_KEEP_' + id : '';
  }).join('').replace(/\s+/g, ' ').trim();
  const markerIds = new Map([...markers].map(([id, node]) => [node, id]));
  const markerParents = new Map([...markers].map(([id, node]) => {
    let parent = node.parentElement;
    while (parent && !markerIds.has(parent)) parent = parent.parentElement;
    return [id, parent ? markerIds.get(parent) : null];
  }));
  const attributes = [...markers].map(([id, node]) => [id, node.getAttribute('href'), node.getAttribute('target'), node.getAttribute('title')]);
  return { container, entries, roots, markers, markerParents, attributes, plain, translatableText, plainRequest, text: markers.size ? html : plain, display: getComputedStyle(container).display };
}

/** A paragraph is a contiguous run of inline content within a visible block. */
export function collectParagraphs(root = document.body) {
  if (!root) return [];
  const result = [];
  let entries = [];
  let scope = root;
  const flush = () => {
    if (entries.length) {
      const snapshot = paragraphSnapshot(scope, entries);
      if (shouldTranslate(snapshot.translatableText)) result.push(snapshot);
    }
    entries = [];
  };
  const append = (node, block) => {
    if (entries.length && scope !== block) flush();
    scope = block;
    entries.push({ node, value: node.textContent || '', parent: node.parentNode });
  };
  const walk = (node, block) => {
    if (node.nodeType === Node.TEXT_NODE) { append(node, block); return; }
    if (!(node instanceof Element) || node.matches(EXCLUDED)) return;
    const style = getComputedStyle(node);
    if (node.hidden || style.display === 'none' || ['hidden', 'collapse'].includes(style.visibility)) return;
    if (node.tagName === 'BR') { flush(); return; }
    if (PROTECTED.has(node.tagName)) { append(node, block); return; }
    const isBlock = node !== root && !INLINE_DISPLAYS.has(style.display);
    const navigationLink = node.tagName === 'A' && !!node.closest('nav,[role="navigation"],[role="menu"],[role="menubar"]');
    if (isBlock || navigationLink) flush();
    const childBlock = navigationLink ? node.parentElement : isBlock ? node : block;
    for (const child of node.childNodes) walk(child, childBlock);
    if (isBlock || navigationLink) flush();
  };
  walk(root, root);
  flush();
  return result;
}

function sameSnapshot(a, b) {
  return a.container === b.container && a.text === b.text && a.entries.length === b.entries.length
    && a.entries.every((entry, index) => entry.node === b.entries[index].node && entry.value === b.entries[index].value && entry.parent === b.entries[index].parent)
    && JSON.stringify(a.attributes) === JSON.stringify(b.attributes)
    && [...a.markers].every(([id, node]) => b.markers.get(id) === node);
}

function sourceStillMatches(snapshot) {
  if (!snapshot.container.isConnected) return false;
  const current = collectParagraphs(snapshot.container).find(item => item.entries[0]?.node === snapshot.entries[0]?.node);
  return !!current && sameSnapshot(snapshot, current);
}

function bounds(snapshot) {
  const first = snapshot.entries[0]?.node;
  const last = snapshot.entries.at(-1)?.node;
  if (!first?.isConnected || !last?.isConnected) return null;
  try {
    const range = document.createRange(); range.setStartBefore(first); range.setEndAfter(last);
    const rect = range.getBoundingClientRect(); range.detach(); return rect;
  } catch { return null; }
}

function safeInline(source, document) {
  const tag = source.tagName.toLowerCase();
  const node = document.createElement(tag === 'tt' ? 'code' : tag);
  if (tag === 'a') {
    const href = source.getAttribute('href');
    if (href?.startsWith('#')) node.setAttribute('href', href);
    else if (href) try {
      const url = new URL(href, source.baseURI);
      if (['http:', 'https:', 'mailto:', 'tel:'].includes(url.protocol)) node.setAttribute('href', href);
    } catch { /* Keep readable link text when the source URL is not usable. */ }
    if (source.getAttribute('target') === '_blank') { node.target = '_blank'; node.rel = 'noopener noreferrer'; }
  }
  if (source.title) node.title = source.title;
  return node;
}

function decodeEntities(text) {
  return text.replace(/&(#(?:x[\da-f]+|\d+)|amp|lt|gt|quot|apos|nbsp);/gi, (match, entity) => {
    const names = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' };
    if (entity[0] !== '#') return names[entity.toLowerCase()] || match;
    const value = entity[1].toLowerCase() === 'x' ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10);
    return value > 0 && value <= 0x10ffff && !(value >= 0xd800 && value <= 0xdfff) ? String.fromCodePoint(value) : '\ufffd';
  });
}

/** Reconstruct the reserved marker grammar; no remote HTML is parsed or inserted. */
function translatedContent(text, snapshot, format) {
  let decoded = decodeEntities(text);
  if (format === 'html' && /&lt;\/?i\d+&gt;/i.test(decoded)) decoded = decodeEntities(decoded);
  const fragment = document.createDocumentFragment();
  const stack = [{ id: null, element: fragment, protected: false }];
  const seen = new Set();
  let valid = true;
  let cursor = 0;
  const appendText = value => {
    // Non-marker angle brackets can be mathematical comparisons, generic types
    // or literal HTML examples. They are always constructed as text, never HTML.
    if (/<\/?i\d+\b/i.test(value)) valid = false;
    if (!stack.at(-1).protected) stack.at(-1).element.append(document.createTextNode(value));
  };
  if (format === 'html' && snapshot.markers.size) {
    for (const match of decoded.matchAll(/<(\/?)[iI](\d+)>/g)) {
      appendText(decoded.slice(cursor, match.index));
      cursor = match.index + match[0].length;
      const id = Number(match[2]);
      if (match[1]) {
        if (stack.length === 1 || stack.at(-1).id !== id) { valid = false; break; }
        stack.pop();
      } else {
        const original = snapshot.markers.get(id);
        if (!original || seen.has(id) || snapshot.markerParents.get(id) !== stack.at(-1).id) { valid = false; break; }
        seen.add(id);
        const element = safeInline(original, document);
        const protectedText = PROTECTED.has(original.tagName);
        if (protectedText) element.textContent = original.textContent;
        stack.at(-1).element.append(element);
        stack.push({ id, element, protected: protectedText });
      }
    }
    appendText(decoded.slice(cursor));
    if (valid && stack.length === 1 && seen.size === snapshot.markers.size) return fragment;
  }
  // Remove only this request's reserved control syntax. A plain response is
  // already safe as a text node; stripping HTML-shaped prose would lose content.
  let plain = format === 'html' ? decoded.replace(/<\/?i\d+(?:\s[^<>]*?)?\s*\/?>/gi, '') : decoded;
  plain = plain.replace(/\bASIDE_KEEP_(\d+)\b/g, (token, id) => {
    const original = snapshot.markers.get(Number(id));
    return original && PROTECTED.has(original.tagName) ? original.textContent || '' : token;
  });
  return document.createTextNode(plain.trim());
}

function ensureStyle() {
  let style = document.getElementById(STYLE_ID);
  if (style) return style;
  style = document.createElement('style'); style.id = STYLE_ID;
  style.textContent = `${TARGET}{font-family:inherit;font-size:inherit;line-height:inherit;color:inherit;letter-spacing:normal;word-break:normal;overflow-wrap:anywhere;user-select:text;white-space:pre-wrap}${TARGET}[data-aside-layout="block"]{display:block;margin-block:8px}${TARGET}[data-aside-layout="inline"]{display:inline}${TARGET}[data-aside-layout="inline"]::before{content:"\\00a0\\00a0"}`;
  (document.head || document.documentElement).append(style);
  return style;
}

export class PageTranslator {
  constructor({ translate, onChange = () => {} }) {
    this.translate = translate; this.onChange = onChange;
    this.records = new Map(); this.queued = new WeakMap(); this.queue = [];
    this.enabled = false; this.generation = 0; this.active = 0; this.error = '';
  }

  get status() {
    return { translated: this.enabled, busy: this.enabled && (this.active > 0 || this.queue.length > 0), error: this.error };
  }

  start() {
    if (this.enabled) return;
    this.enabled = true; this.error = ''; this.generation++;
    this.style = ensureStyle();
    this.observer = new MutationObserver(mutations => {
      const meaningful = mutations.some(mutation => {
        const element = mutation.target.nodeType === Node.ELEMENT_NODE ? mutation.target : mutation.target.parentElement;
        if (element?.closest(`${TARGET},#aside-floating`)) return false;
        if (mutation.type !== 'childList') return true;
        return [...mutation.addedNodes, ...mutation.removedNodes].some(node => !(node instanceof Element && node.matches(TARGET)));
      });
      if (meaningful) { clearTimeout(this.scanTimer); this.scanTimer = setTimeout(() => this.scan(), 120); }
    });
    this.observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'aria-hidden', 'href', 'translate'] });
    this.visibleObserver = new IntersectionObserver(() => this.scheduleVisible(), { rootMargin: `0px 0px ${innerHeight * 2}px 0px` });
    this.viewportHandler = () => {
      if (!this.viewportFrame) this.viewportFrame = requestAnimationFrame(() => { this.viewportFrame = 0; this.scheduleVisible(); });
    };
    addEventListener('scroll', this.viewportHandler, { capture: true, passive: true });
    addEventListener('resize', this.viewportHandler, { passive: true });
    this.scan(); this.onChange(this.status);
  }

  scan() {
    if (!this.enabled || document.hidden) return;
    const seen = new Set();
    for (const snapshot of collectParagraphs()) {
      const key = snapshot.entries[0].node;
      seen.add(key);
      let record = this.records.get(key);
      if (!record) {
        record = { snapshot, version: 0, state: 'idle', target: null, controller: null };
        this.records.set(key, record); this.visibleObserver.observe(snapshot.container);
      } else if (!sameSnapshot(record.snapshot, snapshot)) {
        record.controller?.abort(); record.target?.remove(); record.target = null;
        record.version++; record.snapshot = snapshot; record.state = 'idle';
      } else if (record.state === 'done' && !record.target?.isConnected) {
        record.state = 'idle'; record.version++;
      }
    }
    for (const [key, record] of this.records) if (!seen.has(key)) {
      record.controller?.abort(); record.target?.remove(); record.version++;
      this.visibleObserver.unobserve(record.snapshot.container); this.records.delete(key);
    }
    this.scheduleVisible();
  }

  scheduleVisible() {
    if (!this.enabled || document.hidden) return;
    const margin = innerHeight * 2;
    const waiting = [...this.records.values()].filter(record => {
      if (record.state !== 'idle') return false;
      const rect = bounds(record.snapshot);
      return rect && rect.width >= 0 && rect.height > 0 && rect.bottom >= 0 && rect.top <= innerHeight + margin;
    }).sort((a, b) => Math.abs(bounds(a.snapshot).top) - Math.abs(bounds(b.snapshot).top));
    for (const record of waiting) {
      const job = { record, snapshot: record.snapshot, version: record.version, generation: this.generation, token: {} };
      record.state = 'queued';
      for (const entry of job.snapshot.entries) this.queued.set(entry.node, job.token);
      this.queue.push(job);
    }
    this.pump();
  }

  pump() {
    while (this.enabled && this.active < 3 && this.queue.length) {
      const job = this.queue.shift();
      if (job.record.version !== job.version || job.record.state !== 'queued') continue;
      const queued = this.queued;
      this.active++; job.record.state = 'loading'; job.record.controller = new AbortController();
      this.run(job, job.record.controller.signal).finally(() => {
        for (const entry of job.snapshot.entries) if (queued.get(entry.node) === job.token) queued.delete(entry.node);
        if (job.generation !== this.generation) return;
        this.active--; this.pump(); this.onChange(this.status);
      });
    }
  }

  async run(job, signal) {
    const { record, snapshot, generation, version } = job;
    try {
      if (signal.aborted || !sourceStillMatches(snapshot)) { record.state = 'idle'; return; }
      const rich = snapshot.markers.size > 0;
      // Keep one rich paragraph intact; splitting nested markers would corrupt it.
      const parts = rich && snapshot.text.length <= 4000 ? [snapshot.text] : splitText(rich ? snapshot.plainRequest : snapshot.text);
      const format = rich && snapshot.text.length <= 4000 ? 'html' : 'text';
      let translated = '';
      for (const part of parts) {
        if (signal.aborted) return;
        translated += await this.translate(part, { signal, format });
      }
      if (signal.aborted || generation !== this.generation || record.version !== version) return;
      if (!sourceStillMatches(snapshot)) { record.state = 'idle'; this.scan(); return; }
      const target = document.createElement('span');
      target.className = 'aside-translation'; target.setAttribute('data-aside-translation', ''); target.setAttribute('data-aside-ignore', '');
      target.setAttribute('translate', 'no'); target.lang = 'zh-CN'; target.dir = 'auto';
      target.dataset.asideLayout = isInlineTranslation(snapshot.plain, snapshot.display) ? 'inline' : 'block';
      target.append(translatedContent(translated, snapshot, format));
      if (!target.textContent.trim()) throw new Error('翻译服务没有返回有效译文，请检查接口。');
      const anchor = snapshot.roots.at(-1);
      if (!anchor?.parentNode) { record.state = 'idle'; return; }
      anchor.after(target); record.target = target; record.state = 'done';
    } catch (error) {
      if (!signal.aborted && generation === this.generation && record.version === version) {
        record.state = 'failed'; this.error = error.message || '翻译失败，请检查服务设置。';
      }
    }
  }

  restore() {
    this.enabled = false; this.generation++;
    this.observer?.disconnect(); this.visibleObserver?.disconnect();
    clearTimeout(this.scanTimer); cancelAnimationFrame(this.viewportFrame || 0); this.viewportFrame = 0;
    if (this.viewportHandler) { removeEventListener('scroll', this.viewportHandler, true); removeEventListener('resize', this.viewportHandler); }
    for (const record of this.records.values()) { record.controller?.abort(); record.target?.remove(); }
    this.records.clear(); this.queue = []; this.queued = new WeakMap(); this.active = 0;
    this.style?.remove(); this.error = ''; this.onChange(this.status);
  }
}
