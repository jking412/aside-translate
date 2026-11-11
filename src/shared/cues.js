/** Parse the public JSON3 caption format. This deliberately keeps platform event
 * boundaries; it does not reproduce another extension's sentence rules. */
export function parseJson3(input) {
  const data = typeof input === 'string' ? JSON.parse(input) : input;
  if (!Array.isArray(data?.events)) throw new TypeError('字幕缺少 events 数组');
  const rows = [];
  const events = data.events.slice(0, 20000).filter((event) =>
    Number.isFinite(event?.tStartMs) && event.tStartMs >= 0,
  ).sort((a, b) => a.tStartMs - b.tStartMs);
  for (const event of events) {
    if (!Array.isArray(event.segs)) continue;
    const raw = event.segs.map((segment) => typeof segment?.utf8 === 'string' ? segment.utf8 : '').join('');
    const text = captionText(raw).slice(0, 2000);
    const start = event.tStartMs / 1000;
    const previous = rows.at(-1);
    if (!text) {
      if (previous && start > previous.start) previous.end = Math.min(previous.end, start);
      continue;
    }
    const duration = Number.isFinite(event.dDurationMs) && event.dDurationMs > 0
      ? Math.min(event.dDurationMs / 1000, 30) : 3;
    const end = start + duration;
    if (event.aAppend === 1 && previous && start <= previous.end + 0.15) {
      previous.text = captionText(previous.text + (/^\s/.test(raw) ? ' ' : '') + text).slice(0, 2000);
      previous.end = Math.max(previous.end, end);
    } else if (previous?.start === start) {
      if (previous.text !== text) previous.text += ' ' + text;
      previous.end = Math.max(previous.end, end);
    } else {
      if (previous) previous.end = Math.min(previous.end, start);
      rows.push({ start, end, text });
    }
  }
  return rows.filter((cue) => cue.end > cue.start);
}

export function captionText(value) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return String(value ?? '').replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (all, code) => {
    if (code[0] !== '#') return named[code.toLowerCase()] ?? all;
    const number = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1));
    return number > 0 && number <= 0x10ffff && !(number >= 0xd800 && number <= 0xdfff)
      ? String.fromCodePoint(number) : all;
  }).replace(/[\s\u200b]+/g, ' ').trim();
}

/** A half-open interval means a boundary never shows the previous caption. */
export function cueIndexAt(cues, time) {
  if (!Number.isFinite(time)) return -1;
  let low = 0;
  let high = cues.length - 1;
  let candidate = -1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    if (cues[middle].start <= time) { candidate = middle; low = middle + 1; }
    else high = middle - 1;
  }
  return candidate >= 0 && time < cues[candidate].end ? candidate : -1;
}

/** Only use a human target cue when its boundaries identify the same utterance. */
export function alignedTranslation(cue, targets) {
  const index = cueIndexAt(targets, cue.start + 0.01);
  for (const target of targets.slice(Math.max(0, index - 1), Math.max(0, index) + 3)) {
    if (Math.abs(target.start - cue.start) <= 0.4 && Math.abs(target.end - cue.end) <= 0.8) return target.text;
  }
  return '';
}

/** Translation completion stores data only. Rendering always reads the media
 * clock again, so an expired translation can never replay a caption. */
export class CueTimeline {
  constructor(translate, onError = () => {}) {
    this.translate = translate;
    this.onError = onError;
    this.cues = [];
    this.translations = new Map();
    this.pending = new Map();
    this.failed = new Set();
    this.generation = 0;
  }

  reset(cues = []) {
    this.invalidatePending();
    this.cues = cues;
    this.translations.clear();
    this.failed.clear();
  }

  invalidatePending() {
    this.generation++;
    for (const controller of this.pending.values()) controller.abort();
    this.pending.clear();
    this.failed.clear();
  }

  frame(time) {
    const index = cueIndexAt(this.cues, time);
    const first = index >= 0 ? index : this.cues.findIndex((cue) => cue.start > time);
    if (first >= 0) {
      for (let next = first; next < Math.min(first + 4, this.cues.length); next++) {
        if (this.cues[next].start > time + 12 || this.pending.size >= 2) break;
        this.request(next);
      }
    }
    if (index < 0) return null;
    return { ...this.cues[index], index, translation: this.translations.get(index) ?? '' };
  }

  request(index) {
    if (this.pending.has(index) || this.translations.has(index) || this.failed.has(index)) return;
    const cue = this.cues[index];
    if (!cue) return;
    const generation = this.generation;
    const controller = new AbortController();
    this.pending.set(index, controller);
    Promise.resolve().then(() => this.translate(cue.text, { signal: controller.signal, cue, index })).then((result) => {
      if (generation === this.generation && !controller.signal.aborted) {
        this.translations.set(index, captionText(result));
      }
    }).catch((error) => {
      if (generation === this.generation && !controller.signal.aborted) {
        this.failed.add(index);
        this.onError(error);
      }
    }).finally(() => {
      if (this.pending.get(index) === controller) this.pending.delete(index);
    });
  }
}


/** Prefer the video's original audio language over the server's language-sorted
 * list. Human captions in that language outrank ASR; English is only a fallback. */
export function selectCaptionTracks(input, sourceLanguage = '') {
  const tracks = Array.isArray(input) ? input.filter(track => track && Number.isInteger(track.index) && track.index >= 0 && typeof track.languageCode === 'string') : [];
  const language = String(sourceLanguage).toLowerCase().split(/[-_]/)[0];
  const sameLanguage = track => track.languageCode.toLowerCase().split(/[-_]/)[0] === language;
  const english = track => /^en(?:-|$)/i.test(track.languageCode);
  const chinese = track => /^zh(?:-|$)/i.test(track.languageCode);
  const source = (language && (tracks.find(track => sameLanguage(track) && track.kind !== 'asr') || tracks.find(sameLanguage)))
    || tracks.find(track => english(track) && track.kind !== 'asr') || tracks.find(english)
    || tracks.find(track => !chinese(track) && track.kind !== 'asr') || tracks.find(track => !chinese(track)) || tracks[0];
  const target = tracks.find(track => /^zh-(?:Hans|CN)(?:-|$)/i.test(track.languageCode) && track.kind !== 'asr')
    || tracks.find(track => chinese(track) && track.kind !== 'asr');
  return { source, target };
}

/** Read the spoken audio language, never the preferred subtitle index. A user
 * can prefer Chinese captions for an English audio track, so those settings
 * must not participate in source-language inference. */
export function sourceAudioLanguage(response) {
  const renderer = response?.captions?.playerCaptionsTracklistRenderer;
  const audioTracks = Array.isArray(renderer?.audioTracks) ? renderer.audioTracks : [];
  const streams = Array.isArray(response?.streamingData?.adaptiveFormats)
    ? response.streamingData.adaptiveFormats.map(format => format?.audioTrack).filter(Boolean) : [];
  const languageOf = (audio) => {
    const value = typeof audio?.languageCode === 'string' ? audio.languageCode
      : typeof audio?.audioTrackId === 'string' ? audio.audioTrackId
        : typeof audio?.id === 'string' ? audio.id : '';
    // Accept only a language tag optionally followed by a numeric track suffix.
    // Opaque player IDs are not guessed or decoded.
    return value.match(/^([a-z]{2,3}(?:-[a-z0-9]{2,8})*)(?:\.\d+)?$/i)?.[1] || '';
  };
  const original = [...audioTracks, ...streams].find(audio => audio?.isOriginal === true || audio?.audioIsOriginal === true);
  if (original && languageOf(original)) return languageOf(original);
  const index = renderer?.defaultAudioTrackIndex;
  const defaultAudio = Number.isInteger(index) && index >= 0 ? audioTracks[index] : undefined;
  return languageOf(defaultAudio) || languageOf(streams.find(audio => audio?.audioIsDefault === true)) || '';
}
