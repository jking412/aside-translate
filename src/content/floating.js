const POSITION_KEY = 'asideFloatingPosition';
const css = `
:host{all:initial;position:fixed;z-index:2147483646;font:13px "Microsoft YaHei UI",system-ui,sans-serif;color:#203047;line-height:1.5;direction:ltr}*{box-sizing:border-box}button{font:inherit;cursor:pointer;border:0}button:focus-visible{outline:3px solid #7fb3ff;outline-offset:3px}.entry{display:flex;align-items:center;gap:3px;padding:4px;background:#fff;border:1px solid #d5e1f1;border-radius:24px;box-shadow:0 3px 18px #153d7030;touch-action:none}.ball{display:flex;align-items:center;gap:8px;min-height:36px;max-width:150px;padding:4px 9px 4px 4px;border-radius:19px;background:#165dcc;color:#fff;touch-action:none;user-select:none}.ball[aria-busy=true]{background:#386ba8}.logo{position:relative;display:block;flex:none;width:28px;height:28px;background:#165dcc;border-radius:7px}.logo:before,.logo:after{content:"";position:absolute;height:6px;border-radius:2px}.logo:before{width:18px;left:3px;top:6px;background:white}.logo:after{width:16px;left:8px;top:16px;background:#8ee5da}.label{white-space:nowrap;font-size:12px}.expand{background:transparent;color:#435e82;border-radius:50%;height:32px;width:24px;font-size:17px}.panel{position:absolute;top:52px;right:0;width:280px;max-width:calc(100vw - 24px);padding:17px;background:white;border:1px solid #d5e1f1;border-radius:12px;box-shadow:0 8px 30px #153d7030}.left .panel{right:auto;left:0}.heading{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}.heading strong{font-size:15px}.close{background:transparent;color:#627187;padding:2px 5px;font-size:19px}.status{font-size:12px;color:#627187;margin:0 0 12px;white-space:normal;overflow-wrap:anywhere}.status[data-error=true]{color:#a23124}.settings{width:100%;background:#edf3fc;color:#165dcc;border-radius:7px;padding:10px}.help{font-size:11px;color:#627187;margin:11px 0 0;white-space:normal}.dragging{opacity:.85}.dragging button{cursor:grabbing}[hidden]{display:none!important}@media(prefers-color-scheme:dark){.entry,.panel{background:#202a3a;border-color:#485a75;color:#f0f4fc}.expand,.close,.status,.help{color:#c0ccde}.settings{background:#314663;color:#e3edff}}
`;

/** Original implementation of the reference's click/expand/drag/snap interactions. No page text or keys enter this UI. */
export class FloatingControls {
  constructor({ getStatus, onToggle, onOpenSettings }) {
    this.getStatus = getStatus;
    this.onToggle = onToggle;
    this.onOpenSettings = onOpenSettings;
    this.host = null;
    this.open = false;
    this.position = { side: 'right', top: 335 };
    this.cleanup = [];
  }
  async start() {
    if (this.host || document.getElementById('aside-floating')) return;
    const host = document.createElement('div'); host.id = 'aside-floating';
    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style'); style.textContent = css; shadow.append(style);
    const root = document.createElement('div'); root.className = 'right';
    root.innerHTML = `<div class="entry"><button class="ball" type="button" data-drag-handle aria-label="翻译此页" title="点击翻译或恢复；拖动调整位置"><span class="logo" aria-hidden="true"></span><span class="label">翻译</span></button><button class="expand" type="button" aria-label="展开翻译面板" aria-expanded="false" title="展开翻译面板">‹</button></div><section class="panel" role="region" aria-label="旁译快捷面板" hidden><div class="heading"><strong>旁译 Aside</strong><button class="close" type="button" aria-label="收起翻译面板">×</button></div><p class="status" role="status"></p><button class="settings" type="button">翻译与服务设置</button><p class="help">点击主按钮翻译或恢复。按住拖动可贴靠左右边缘。</p></section>`;
    shadow.append(root); document.documentElement.append(host);
    this.host = host; this.root = root;
    this.ball = root.querySelector('.ball'); this.label = root.querySelector('.label');
    this.expand = root.querySelector('.expand'); this.panel = root.querySelector('.panel');
    const listen = (target, name, fn, options) => { target.addEventListener(name, fn, options); this.cleanup.push(() => target.removeEventListener(name, fn, options)); };
    listen(this.expand, 'click', () => this.setOpen(!this.open));
    listen(root.querySelector('.close'), 'click', () => { this.setOpen(false); this.expand.focus(); });
    listen(root.querySelector('.settings'), 'click', () => { this.setOpen(false); void this.onOpenSettings?.(); });
    listen(document, 'pointerdown', event => { if (this.open && !event.composedPath().includes(host)) this.setOpen(false); }, true);
    listen(document, 'keydown', event => { if (event.key === 'Escape' && this.open) { this.setOpen(false); this.expand.focus(); } });
    listen(window, 'resize', () => this.place());
    let pointer = null, moved = false, suppressClick = false;
    listen(this.ball, 'pointerdown', event => {
      if (event.button !== 0) return;
      const rect = host.getBoundingClientRect();
      pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top };
      moved = false; this.ball.setPointerCapture(event.pointerId);
    });
    listen(this.ball, 'pointermove', event => {
      if (!pointer || pointer.id !== event.pointerId) return;
      const dx = event.clientX - pointer.x, dy = event.clientY - pointer.y;
      if (!moved && Math.abs(dx) <= 6 && Math.abs(dy) <= 6) return;
      moved = true; this.setOpen(false); root.classList.add('dragging');
      host.style.right = 'auto';
      host.style.left = `${Math.max(0, Math.min(innerWidth - host.offsetWidth, pointer.left + dx))}px`;
      host.style.top = `${this.clampTop(pointer.top + dy)}px`;
    });
    const finish = event => {
      if (!pointer || event.pointerId !== pointer.id) return;
      root.classList.remove('dragging');
      if (moved) {
        const rect = host.getBoundingClientRect();
        this.position = { side: rect.left + rect.width / 2 > innerWidth / 2 ? 'right' : 'left', top: rect.top };
        this.place();
        void chrome.storage.local.set({ [POSITION_KEY]: { ...this.position } }).catch(() => {});
        suppressClick = true; setTimeout(() => { suppressClick = false; }, 0);
      }
      pointer = null;
    };
    listen(this.ball, 'pointerup', finish); listen(this.ball, 'pointercancel', finish);
    listen(this.ball, 'click', async event => {
      if (suppressClick) { event.preventDefault(); return; }
      try { await this.onToggle(); this.update(); }
      catch { const node = root.querySelector('.status'); node.textContent = '翻译未能启动，请刷新网页后重试。'; node.dataset.error = 'true'; this.setOpen(true); }
    });
    this.place(); this.update();
    this.timer = setInterval(() => this.update(), 500);
    try {
      const values = await chrome.storage.local.get(POSITION_KEY);
      if (!this.host) return;
      const saved = values[POSITION_KEY];
      if (saved && ['left', 'right'].includes(saved.side) && Number.isFinite(saved.top)) this.position = { side: saved.side, top: saved.top };
      this.place();
    } catch { /* Default position remains available if storage is unavailable. */ }
  }
  clampTop(value) { return Math.max(8, Math.min(value, innerHeight - 56)); }
  place() {
    if (!this.host) return;
    this.position.top = this.clampTop(this.position.top);
    this.host.style.top = `${this.position.top}px`;
    this.host.style.left = this.position.side === 'left' ? '8px' : 'auto';
    this.host.style.right = this.position.side === 'right' ? '8px' : 'auto';
    this.root.classList.toggle('left', this.position.side === 'left');
    this.root.classList.toggle('right', this.position.side === 'right');
    this.expand.textContent = this.position.side === 'left' ? '›' : '‹';
    this.positionPanel();
  }
  positionPanel() {
    if (!this.host || !this.open) return;
    this.panel.style.top = this.position.top + this.panel.offsetHeight + 62 > innerHeight ? 'auto' : '52px';
    this.panel.style.bottom = this.panel.style.top === 'auto' ? '52px' : 'auto';
  }
  setOpen(open) {
    this.open = open; if (!this.host) return;
    this.panel.hidden = !open; this.expand.setAttribute('aria-expanded', String(open));
    this.expand.setAttribute('aria-label', open ? '收起翻译面板' : '展开翻译面板');
    this.expand.title = open ? '收起翻译面板' : '展开翻译面板';
    this.positionPanel();
  }
  update() {
    if (!this.host) return;
    const status = this.getStatus() || {};
    const restore = Boolean(status.translated || status.busy);
    this.ball.setAttribute('aria-label', restore ? '恢复原文' : '翻译此页');
    this.ball.setAttribute('aria-busy', String(Boolean(status.busy)));
    this.label.textContent = status.busy ? '恢复原文' : restore ? '原文' : '翻译';
    const node = this.root.querySelector('.status');
    node.textContent = status.error || status.youtubeStatus || (status.busy ? '正在翻译…可随时恢复原文。' : restore ? '已显示中文译文。' : '翻译成中文，保留原文。');
    node.dataset.error = String(Boolean(status.error));
  }
  stop() {
    clearInterval(this.timer); this.cleanup.splice(0).forEach(dispose => dispose());
    this.host?.remove(); this.host = null; this.open = false;
  }
}
