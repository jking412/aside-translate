/** Independent English word-timing segmentation. The constants describe reading
 * chunks, not another extension's word lists or implementation. */
export function englishWordCues(events) {
  const spoken = events.filter(event => event?.aAppend !== 1 && Array.isArray(event?.segs));
  if (!spoken.some(event => event.segs.some(segment => Number.isFinite(segment?.tOffsetMs)))) return null;
  if (spoken.slice(0, 20).some(event => event.segs.some(segment => String(segment?.utf8 || '').trim().split(/\s+/).length >= 3))) return null;
  const pieces = [];
  const uppercase = spoken.flatMap(event => event.segs).filter(segment => /[a-z]/.test(segment?.utf8 || '')).length <= spoken.length * 0.1;
  let pendingSpace = false;
  for (const event of spoken) {
    for (const segment of event.segs) {
      let value = String(segment?.utf8 || '').replace(/\n/g, ' ');
      if (!value.trim()) { pendingSpace = true; continue; }
      if (pendingSpace && !/^\s/.test(value)) value = ' ' + value;
      pendingSpace = false;
      const at = (event.tStartMs + Math.max(0, Number(segment.tOffsetMs) || 0)) / 1000;
      if (!Number.isFinite(at) || at < 0) continue;
      const previous = pieces.at(-1);
      const tailEnd = (event.tStartMs + (event.dDurationMs || 0)) / 1000;
      if (uppercase && previous && !/^\s/.test(value)) {
        previous.value += value.toLowerCase();
        previous.tailEnd = Math.max(previous.tailEnd || 0, tailEnd);
        continue;
      }
      pieces.push({ at, value: value.toLowerCase(), tailEnd, eventEnd: uppercase ? undefined : (event.tStartMs + (event.dDurationMs || 0)) / 1000 });
    }
  }
  if (!pieces.length) return null;
  // The trailing event end only belongs to its final token.
  if (!uppercase) for (let index = 0; index < pieces.length - 1; index++) {
    if (pieces[index].eventEnd === pieces[index + 1].eventEnd) pieces[index].eventEnd = undefined;
  }
  const tokens = pieces.filter(piece => piece.value.trim() !== 'uh');
  const densePunctuation = tokens.filter(piece => /[.!?。？！]$/.test(piece.value.trim())).length >= 10;
  const groups = [];
  let current = [];
  const flush = () => { if (current.length) groups.push(current); current = []; };
  for (const token of tokens) {
    const previous = current.at(-1);
    const gap = previous ? token.at - previous.at : 0;
    const clause = /^(?:and|but|because|so|which|where|what|how|or|after)$/i.test(token.value.trim()) && gap > 0.3;
    if (previous && !densePunctuation && (gap > 1 || clause)) {
      flush(); token.strongBreak = clause;
    }
    current.push(token);
    if (densePunctuation && /[.!?。？！]$/.test(token.value.trim()) && !/(?:\d+\.|\b(?:mr|mrs|ms|dr|prof|etc)\.)$/i.test(token.value.trim())) flush();
  }
  flush();
  if (!densePunctuation) {
    // Avoid a long rolling line during very dense speech. Anchor small chunks
    // from the end so the final chunk does not become an orphan word.
    const divided = groups.flatMap(group => {
      if (group.length <= 17) return [group];
      const chunks = [];
      let size = group.length % 4 || 4;
      for (let index = 0; index < group.length; index += size, size = 4) chunks.push(group.slice(index, index + size));
      return chunks;
    });
    groups.splice(0, groups.length, ...divided);
    for (let index = groups.length - 1; index > 0; index--) {
      const tail = groups[index], head = groups[index - 1];
      const incompletePhrase = /\b(?:a|an|the|some|any|each|every|of|to|in|with|for)\s*$/i.test(head.at(-1).value);
      const closeEnough = tail[0].at - head.at(-1).at <= (incompletePhrase ? 1.5 : 1);
      if (tail.length <= 3 && head.length + tail.length < 20 && !tail[0].strongBreak && closeEnough) {
        head.push(...tail); groups.splice(index, 1);
      }
    }
  }
  return groups.map((group, index) => {
    const last = group.at(-1);
    const following = groups[index + 1]?.[0]?.at;
    // Intentionally repair a release defect: its terminal chunk stops at the
    // last word's start (a single word becomes zero length). Honor the valid
    // platform event end instead, with a bounded fallback for malformed data.
    const terminal = Number.isFinite(last.tailEnd) && last.tailEnd > last.at ? Math.min(last.tailEnd, last.at + 8) : last.at + 0.8;
    const end = following === undefined ? terminal : Number.isFinite(last.eventEnd) && last.eventEnd > last.at ? Math.min(last.eventEnd, following) : following;
    return { start: group[0].at, end: Math.max(group[0].at, end), text: group.map(piece => piece.value).join('').replace(/\s+/g, ' ') };
  });
}
