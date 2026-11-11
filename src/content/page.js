const EXCLUDED = 'script,style,noscript,template,svg,math,code,pre,kbd,samp,input,textarea,select,option,button,[contenteditable]:not([contenteditable="false"]),[translate="no"],.notranslate,[data-lt-ignore],#movie_player,.html5-video-player,video';

// Keep each request below provider limits without splitting Unicode surrogate pairs.
export function splitText(text, limit = 1800) {
  const parts = [];
  let part = '';
  for (const char of text) {
    if (part.length + char.length > limit) { parts.push(part); part = ''; }
    part += char;
  }
  if (part) parts.push(part);
  return parts;
}

export function shouldTranslate(text) {
  const value = text.trim();
  return value.length > 1 && /\p{L}/u.test(value) && /[^\p{Script=Han}\p{P}\p{N}\p{Z}\p{S}\s]/u.test(value)
    && !/^https?:\/\//i.test(value);
}

export class PageTranslator {
  constructor({ translate, onChange = () => {} }) {
    this.translate = translate;
    this.onChange = onChange;
    this.records = new Map();
    this.queued = new WeakSet();
    this.failed = new WeakMap();
    this.queue = [];
    this.enabled = false;
    this.generation = 0;
    this.active = 0;
    this.error = '';
  }

  get status() {
    return { translated: this.enabled, busy: this.enabled && (this.active > 0 || this.queue.length > 0), error: this.error };
  }

  start() {
    if (this.enabled) return;
    this.enabled = true;
    this.error = '';
    this.generation++;
    this.controller = new AbortController();
    this.observer = new MutationObserver(() => {
      clearTimeout(this.scanTimer);
      this.scanTimer = setTimeout(() => this.scan(), 250);
    });
    this.observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    this.scan();
    this.onChange(this.status);
  }

  scan() {
    if (!this.enabled || document.hidden) return;
    for (const [node] of this.records) if (!node.isConnected) this.records.delete(node);
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: node => {
        const parent = node.parentElement;
        if (!parent || this.queued.has(node) || this.failed.get(node) === node.data || parent.closest(EXCLUDED) || !shouldTranslate(node.data)) return NodeFilter.FILTER_REJECT;
        const record = this.records.get(node);
        if (record && node.data === record.translated) return NodeFilter.FILTER_REJECT;
        if (!parent.getClientRects().length || getComputedStyle(parent).visibility === 'hidden') return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    let node;
    while ((node = walker.nextNode())) {
      this.queued.add(node);
      this.queue.push({ node, original: node.data, generation: this.generation });
    }
    this.pump();
  }

  pump() {
    while (this.enabled && this.active < 3 && this.queue.length) {
      const job = this.queue.shift();
      const signal = this.controller.signal;
      const queued = this.queued;
      this.active++;
      this.run(job, signal).finally(() => {
        // A restart owns a new queue and active count. Late work may only clean
        // the node markers captured for its own generation.
        queued.delete(job.node);
        if (job.generation !== this.generation) return;
        this.active--;
        const record = this.records.get(job.node);
        if (job.node.isConnected && job.node.data !== job.original && job.node.data !== record?.translated) {
          // The observer may have seen this edit while its old text was queued.
          // Retry the changed text after releasing that marker, not unchanged errors.
          this.scan();
        } else {
          this.pump();
        }
        this.onChange(this.status);
      });
    }
  }

  async run({ node, original, generation }, signal) {
    try {
      if (signal.aborted || !node.isConnected || node.data !== original) return;
      const leading = original.match(/^\s*/)[0];
      const trailing = original.match(/\s*$/)[0];
      const parts = splitText(original.trim());
      let translated = '';
      for (const part of parts) {
        if (signal.aborted) return;
        translated += await this.translate(part, { signal });
      }
      if (signal.aborted || generation !== this.generation || !node.isConnected || node.data !== original) return;
      const result = leading + translated + trailing;
      this.failed.delete(node);
      this.records.set(node, { original, translated: result });
      node.data = result;
    } catch (error) {
      if (!signal.aborted && generation === this.generation) {
        this.failed.set(node, original);
        this.error = error.message || '翻译失败，请检查服务设置。';
      }
    }
  }

  restore() {
    this.enabled = false;
    this.generation++;
    this.controller?.abort();
    this.observer?.disconnect();
    clearTimeout(this.scanTimer);
    this.queue = [];
    this.queued = new WeakSet();
    this.failed = new WeakMap();
    this.active = 0;
    for (const [node, record] of this.records) {
      // A live application may have replaced the text since we translated it.
      if (node.isConnected && node.data === record.translated) node.data = record.original;
    }
    this.records.clear();
    this.error = '';
    this.onChange(this.status);
  }
}
