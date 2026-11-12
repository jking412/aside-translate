/** Public caption wire formats, parsed inertly in the page world. XML is reduced
 * to timed text; no element or HTML from a response is inserted into the page. */
export function parseYoutubePayload(text) {
  if (typeof text !== 'string' || text.length > 4000000 || !text.trim()) throw new Error('字幕轨为空，请等待播放器原生字幕');
  if (!text.trimStart().startsWith('<')) {
    const data = JSON.parse(text);
    if (!Array.isArray(data?.events)) throw new Error('字幕格式不受支持');
    return { events: data.events.slice(0, 20000) };
  }
  const xml = new DOMParser().parseFromString(text, 'application/xml');
  if (xml.querySelector('parsererror')) throw new Error('字幕 XML 无法解析');
  const events = [];
  for (const element of [...xml.querySelectorAll('transcript > text, body > p')].slice(0, 20000)) {
    const legacy = element.tagName === 'text';
    const start = Number(element.getAttribute(legacy ? 'start' : 't')) * (legacy ? 1000 : 1);
    const duration = Number(element.getAttribute(legacy ? 'dur' : 'd')) * (legacy ? 1000 : 1);
    if (!Number.isFinite(start) || start < 0 || !Number.isFinite(duration) || duration <= 0) continue;
    const segs = [];
    for (const child of element.childNodes) {
      const utf8 = child.nodeType === 1 && child.nodeName.toLowerCase() === 'br' ? '\n' : child.textContent || '';
      if (!utf8) continue;
      const offset = child.nodeType === 1 ? Number(child.getAttribute('t')) : NaN;
      segs.push({ utf8, ...(Number.isFinite(offset) && child.nodeType === 1 && child.hasAttribute('t') ? { tOffsetMs: offset } : {}) });
    }
    if (segs.length) events.push({ tStartMs: start, dDurationMs: duration, segs });
  }
  if (!events.length) throw new Error('字幕 XML 没有可用时间轴');
  return { events };
}
