import { englishWordCues } from './youtube-asr.js';
/** Parse platform JSON3 into a stable utterance timeline. English ASR uses word
 * timings; human tracks retain their authored overlapping/multiline groups. */
export function parseJson3(input, options = {}) {
  const data = typeof input === 'string' ? JSON.parse(input) : input;
  if (!Array.isArray(data?.events)) throw new TypeError('字幕缺少 events 数组');
  if (options.kind === 'asr' && /^en(?:-|$)/i.test(options.language || '') && options.preTranslation !== false) {
    const segmented = englishWordCues(data.events.slice(0, 20000));
    if (segmented) return segmented;
  }
  const spoken = data.events.slice(0, 20000).filter(event => event?.aAppend !== 1 && Number.isFinite(event?.tStartMs) && event.tStartMs >= 0 && Number.isFinite(event.dDurationMs) && event.dDurationMs > 0 && Array.isArray(event.segs));
  const multi = spoken.filter(event => event.segs.some(segment => String(segment?.utf8 || '').includes('\n'))).length > spoken.length / 2
    && !spoken.some(event => event.segs.some(segment => Number.isFinite(segment?.tOffsetMs)));
  const authored = spoken.map(event => ({ start: event.tStartMs / 1000, end: (event.tStartMs + event.dDurationMs) / 1000,
    text: captionText(event.segs.map(segment => typeof segment?.utf8 === 'string' ? segment.utf8 : '').join('')).slice(0, 2000),
  })).filter(cue => cue.text && Number.isFinite(cue.end)).sort((left, right) => left.start - right.start);
  const nextStart = new Array(authored.length);
  for (let index = authored.length - 2; index >= 0; index--) nextStart[index] = authored[index + 1].start > authored[index].start ? authored[index + 1].start : nextStart[index + 1];
  const rows = [];
  for (let index = 0; index < authored.length; index++) {
    const cue = { ...authored[index] };
    if (multi || cue.end - cue.start > 60) {
      if (Number.isFinite(nextStart[index])) cue.end = Math.min(cue.end, nextStart[index]);
    }
    const previous = rows.at(-1);
    if (previous && previous.start === cue.start && previous.end === cue.end && previous.text === cue.text) continue;
    if (previous && cue.start < previous.end) previous.text += (/^ja(?:-|$)/i.test(options.language || '') ? '' : ' ') + cue.text;
    else rows.push(cue);
  }
  if (/^ja(?:-|$)/i.test(options.language || '')) for (let index = 0; index < rows.length - 1; index++) {
    rows[index].end = Math.max(rows[index].end, Math.min(rows[index + 1].start - 0.001, rows[index].start + Array.from(rows[index].text).length / 7));
  }
  return rows;
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

/** Human tracks often use different sentence boundaries. Join target cues that
 * meaningfully overlap this spoken interval, while excluding adjacent rows. */
export function alignedTranslation(cue, targets) {
  const margin = Math.min(0.5, Math.max(0, cue.end - cue.start) / 4);
  return targets.filter(target => target.end > cue.start + margin && target.start < cue.end - margin)
    .map(target => target.text).join(' ').trim();
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
    this.prefetchEnabled = true;
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
    const first = index >= 0 ? index : this.prefetchEnabled ? this.cues.findIndex((cue) => cue.start > time) : -1;
    if (first >= 0) {
      for (let next = first; next < Math.min(first + (this.prefetchEnabled ? 12 : 1), this.cues.length); next++) {
        if (this.pending.size >= 2) break;
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


/** CSS pixel sizing observed at 640/1280 and portrait players, implemented from
 * the measured layout contract rather than a copied renderer. */
export function captionFontPixels(width, height) {
  if (!(width > 0 && height > 0)) return 16;
  const horizontal = width / 45, vertical = height / 24;
  const portraitFloor = vertical > 14 && vertical > horizontal * 2 ? Math.max(14, vertical / 2.5) : 10;
  return Math.round(Math.max(portraitFloor, Math.min(horizontal, vertical)));
}
