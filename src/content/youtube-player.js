import { captionFontPixels } from '../shared/cues.js';

/** All player-owned UI, including an available off switch and draggable rows. */
export class YoutubePlayerView {
  constructor(player, { onToggle }) {
    this.player = player;
    this.onToggle = onToggle;
    this.positionKey = location.pathname.startsWith('/shorts/') ? 'shorts' : 'watch';
    this.button = document.createElement('button');
    this.button.className = 'lt-youtube-toggle ytp-button';
    this.button.dataset.ltIgnore = '';
    this.button.type = 'button'; this.button.textContent = '译';
    this.button.style.cssText = 'font:600 18px Arial,sans-serif;color:#fff;min-width:38px;height:100%;padding:0 8px;vertical-align:top;cursor:pointer;background:transparent;border:0;';
    this.button.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); this.onToggle(); });
    this.ensureButton();
    this.oldPosition = player.style.position;
    this.changedPosition = getComputedStyle(player).position === 'static';
    if (this.changedPosition) player.style.position = 'relative';
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(player);
  }
  ensureButton() {
    if (this.button.isConnected) return;
    const controls = this.player.querySelector('.ytp-right-controls');
    if (controls) controls.prepend(this.button);
    else {
      this.button.style.cssText += 'position:absolute;right:8px;bottom:8px;height:32px;background:#163b65;border-radius:5px;z-index:80;';
      this.player.append(this.button);
    }
  }
  enable(enabled) {
    this.enabled = enabled;
    this.button.setAttribute('aria-pressed', String(enabled));
    this.button.setAttribute('aria-label', enabled ? '关闭双语字幕' : '开启双语字幕');
    this.button.title = enabled ? '双语字幕已开启，点击关闭' : '双语字幕已关闭，点击开启';
    this.button.style.opacity = enabled ? '1' : '.65';
    if (!enabled) {
      this.host?.remove(); this.nativeStyle?.remove(); this.player.removeAttribute('data-lt-caption-owner');
      this.host = null; return;
    }
    if (this.host) return;
    this.host = document.createElement('div'); this.host.className = 'lt-youtube-overlay'; this.host.dataset.ltIgnore = '';
    this.host.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:40;';
    this.host.setAttribute('aria-hidden', 'true');
    const shadow = this.host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = ':host{all:initial;position:absolute;inset:0;pointer-events:none;z-index:40;font-family:Arial,"Microsoft YaHei",sans-serif}.captions{position:absolute;bottom:2%;left:5%;width:90%;display:flex;justify-content:center;line-height:1.5;text-align:center;pointer-events:none}.box{max-width:100%;display:flex;flex-direction:column;align-items:center;padding:0 4px;background:rgba(8,8,8,.75);pointer-events:auto;cursor:grab;touch-action:none}.box:empty{display:none}.row{display:block;max-width:100%;font-size:1em;font-weight:400;white-space:pre-wrap;overflow-wrap:anywhere;color:#fff;text-shadow:1px 1px 2px #222}.row:empty{display:none}.status{font-size:.75em;color:#fff}.status:empty{display:none}';
    this.container = document.createElement('div'); this.container.className = 'captions';
    this.box = document.createElement('div'); this.box.className = 'box';
    this.source = document.createElement('span'); this.source.className = 'row source';
    this.target = document.createElement('span'); this.target.className = 'row translation';
    this.status = document.createElement('span'); this.status.className = 'status';
    this.box.append(this.source, this.target, this.status); this.container.append(this.box); shadow.append(style, this.container);
    this.player.append(this.host);
    this.nativeStyle = document.createElement('style'); this.nativeStyle.dataset.ltIgnore = '';
    this.nativeStyle.textContent = '[data-lt-caption-owner] .ytp-caption-window-container{visibility:hidden!important}'; this.player.append(this.nativeStyle);
    this.player.removeAttribute('data-lt-caption-owner');
    this.installDrag(); this.resize();
    try { chrome.storage.local.get('youtubeCaptionPositions').then(result => {
      const position = result.youtubeCaptionPositions?.[this.positionKey];
      if (this.host?.isConnected && Number.isFinite(position)) { this.position = Math.max(0, Math.min(.95, position)); this.resize(); }
    }).catch(() => {}); } catch { /* Standalone test contexts do not have extension storage. */ }
  }
  resize() {
    if (!this.host) return;
    const bounds = this.player.getBoundingClientRect();
    this.host.style.fontSize = captionFontPixels(bounds.width, bounds.height) + 'px';
    if (Number.isFinite(this.position)) {
      this.container.style.top = Math.min(this.position * bounds.height, Math.max(0, bounds.height - this.container.getBoundingClientRect().height)) + 'px';
      this.container.style.bottom = 'unset';
    } else if (this.positionKey === 'shorts') {
      this.container.style.top = '2%'; this.container.style.bottom = 'unset';
    } else { this.container.style.top = ''; this.container.style.bottom = this.player.classList.contains('ytp-autohide') ? '2%' : '60px'; }
  }
  installDrag() {
    let drag;
    this.box.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      event.stopPropagation();
      const player = this.player.getBoundingClientRect(), box = this.container.getBoundingClientRect();
      drag = { offset: event.clientY - box.top, player };
      this.box.setPointerCapture(event.pointerId);
    });
    this.box.addEventListener('pointermove', event => {
      if (!drag) return;
      const top = Math.max(0, Math.min(drag.player.height - this.container.getBoundingClientRect().height, event.clientY - drag.player.top - drag.offset));
      this.position = top / drag.player.height; this.resize();
    });
    const finish = () => {
      if (!drag) return; drag = null;
      try { chrome.storage.local.get('youtubeCaptionPositions').then(result => chrome.storage.local.set({ youtubeCaptionPositions: { ...result.youtubeCaptionPositions, [this.positionKey]: this.position } })).catch(() => {}); } catch { /* Optional position persistence. */ }
    };
    this.box.addEventListener('pointerup', finish); this.box.addEventListener('pointercancel', finish);
  }
  render(source, target, status = '') {
    if (!this.host) return;
    if (source) this.player.setAttribute('data-lt-caption-owner', ''); else this.player.removeAttribute('data-lt-caption-owner');
    if (this.source.textContent !== source) this.source.textContent = source;
    if (this.target.textContent !== target) this.target.textContent = target;
    if (this.status.textContent !== status) this.status.textContent = status;
    this.box.style.display = source || target || status ? 'flex' : 'none';
    this.resize();
  }
  destroy() {
    this.resizeObserver.disconnect(); this.enable(false); this.button.remove();
    if (this.changedPosition) this.player.style.position = this.oldPosition;
  }
}
