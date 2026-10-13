export const FADE_SECONDS = .45;
export const clamp = value => Math.max(0, Math.min(1, value));
const isTimedUnit = unit => Number.isFinite(unit.start) && Number.isFinite(unit.end) && unit.end > unit.start;
export const hasCompleteWordTiming = line => !!line.words?.length && line.words.every(isTimedUnit);

export function lineTiming(line) {
  const timed = (line.words || []).filter(isTimedUnit);
  const starts = timed.map(unit => unit.start), ends = timed.map(unit => unit.end);
  if (!hasCompleteWordTiming(line)) {
    if (Number.isFinite(line.start)) starts.push(line.start);
    if (Number.isFinite(line.end)) ends.push(line.end);
  }
  return { start: starts.length ? Math.min(...starts) : null, end: ends.length ? Math.max(...ends) : null };
}

// Two alternating banks hold two lines each. A stanza boundary starts a fresh
// pair, including odd-length verses, without mixing their lyric lines.
export function lyricPairs(lines) {
  const pairs = [];
  for (let index = 0; index < lines.length; index++) {
    if (!pairs.length || lines[index].blockStart || pairs.at(-1).length === 2) pairs.push([]);
    pairs.at(-1).push(index);
  }
  return pairs;
}

export function pairWindows(lines, duration) {
  const timings = lines.map(lineTiming);
  const pairs = lyricPairs(lines).map((indices, pairIndex) => {
    const starts = indices.map(index => timings[index].start).filter(Number.isFinite);
    const ends = indices.map(index => timings[index].end).filter(Number.isFinite);
    return { indices, pairIndex, bank: pairIndex % 2, first: starts.length ? Math.min(...starts) : null, lastEnd: ends.length ? Math.max(...ends) : null };
  });
  const windows = pairs.map((pair, index) => {
    const next = pairs.slice(index + 1).find(pair => pair.first !== null);
    const replacement = pairs[index + 2];
    // Retire a consumed pair only after the other bank starts singing. Held
    // words delay retirement; absent timing never shortens known word spans.
    const trigger = next?.first ?? pair.lastEnd ?? duration;
    const fadeStart = Math.max(pair.lastEnd ?? trigger, trigger);
    // Fast phrases compress the fade so replacement lyrics are ready at onset.
    const end = Math.min(duration, fadeStart + FADE_SECONDS, replacement?.first !== null && replacement?.first !== undefined ? Math.max(fadeStart, replacement.first) : duration);
    return { ...pair, fadeStart, end };
  });
  return windows.map((window, index) => {
    const start = index < 2 ? 0 : windows[index - 2].end;
    const fadeInEnd = index < 2 ? start : Math.min(start + FADE_SECONDS, Math.max(start, window.first ?? start + FADE_SECONDS));
    return { ...window, start, fadeInEnd };
  });
}

export function pairOpacity(window, position) {
  if (position < window.start || position >= window.end) return 0;
  const incoming = window.fadeInEnd === window.start ? 1 : clamp((position - window.start) / (window.fadeInEnd - window.start));
  const outgoing = window.end === window.fadeStart ? 1 : 1 - clamp((position - window.fadeStart) / (window.end - window.fadeStart));
  return Math.min(incoming, outgoing);
}

// Stateless sequencing makes playback, backward seeking, and MP4 frames agree.
export function sequenceState(windows, position) {
  return windows.filter(window => position >= window.start && position < window.end).flatMap(window => window.indices.map((index, line) => ({
    index, pairIndex: window.pairIndex, slot: window.bank * 2 + line,
    leadInStart: window.start, opacity: pairOpacity(window, position),
  }))).sort((left, right) => left.slot - right.slot);
}
export function frameState(lines, position, duration) {
  return sequenceState(pairWindows(lines, duration), position);
}
