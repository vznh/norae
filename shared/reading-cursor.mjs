export const READING_BAR_WIDTH = 3;
export const READING_BAR_OPACITY = .6;
export const CURSOR_FADE_SECONDS = .24;
export const LINE_APPROACH_GAP_SECONDS = CURSOR_FADE_SECONDS;
export const SUNG_TEXT_COLOR = '#3b82f6';
export const UPCOMING_TEXT_COLOR = '#e5e7eb';

const progressBetween = (time, start, end) => Math.max(0, Math.min(1, (time - start) / Math.max(end - start, .001)));
const interpolate = (start, end, progress) => start + (end - start) * progress;
const isTimed = word => Number.isFinite(word.start) && Number.isFinite(word.end) && word.end > word.start;
const startsVerse = words => words[0].verseStart ?? words[0].lineIndex === 0;
const approachesFromLeft = (previous, line) => startsVerse(line) || !previous || line[0].start - previous.at(-1).end >= LINE_APPROACH_GAP_SECONDS;

function transition(previous, next) {
  const last = previous.at(-1), first = next[0];
  // Center the handoff on EOL (or the next onset if the vocals overlap).
  // Short lines get shorter fades so consecutive handoffs cannot overlap.
  const duration = Math.min(CURSOR_FADE_SECONDS, (last.end - last.start) / 4, (first.end - first.start) / 4);
  const boundary = Math.min(last.end, first.start);
  return { start: boundary - duration / 2, end: boundary + duration / 2 };
}

function cursorWithinLine(words, time, approachStart, verse) {
  const first = words[0], last = words.at(-1);
  const active = words.find(word => time >= word.start && time < word.end);
  if (active) return { ...active, x: active.x + active.width * progressBetween(time, active.start, active.end), phase: 'singing' };
  if (time < first.start) {
    const progress = progressBetween(time, approachStart, first.start);
    return { ...first, x: verse ? interpolate(-READING_BAR_WIDTH, first.x, progress) : first.x, phase: verse ? 'approach' : 'waiting' };
  }
  const next = words.find(word => word.start > time);
  const previous = words.filter(word => word.end <= time).at(-1);
  if (next && previous) return { ...next, x: interpolate(previous.x + previous.width, next.x, progressBetween(time, previous.end, next.start)), phase: 'gap' };
  return { ...last, x: last.x + last.width, phase: 'leaving' };
}

// Pure motion model shared by preview/export: seeking produces the same result.
// Two cues coexist during a line handoff; neither changes word highlight timing.
export function getReadingCursors(words, time, leadInStart = 0) {
  const lines = [];
  for (const word of words.filter(isTimed)) {
    if (!lines.length || lines.at(-1)[0].lineIndex !== word.lineIndex) lines.push([]);
    lines.at(-1).push(word);
  }
  return lines.flatMap((line, index) => {
    const previous = lines[index - 1], next = lines[index + 1];
    const approach = approachesFromLeft(previous, line);
    const entrance = !approach && previous ? transition(previous, line) : null;
    const entryStart = entrance?.start ?? Math.max(line[0].leadInStart ?? leadInStart, previous?.at(-1).end ?? leadInStart);
    const exit = next && !approachesFromLeft(line, next) ? transition(line, next) : { start: line.at(-1).end, end: line.at(-1).end + CURSOR_FADE_SECONDS };
    if (time < entryStart || time >= exit.end) return [];
    const fadeIn = entrance ? progressBetween(time, entrance.start, entrance.end) : 1;
    const fadeOut = 1 - progressBetween(time, exit.start, exit.end);
    const cursor = cursorWithinLine(line, time, Math.max(entryStart, previous?.at(-1).end ?? entryStart), approach);
    const opacity = cursor.opacity * Math.min(fadeIn, fadeOut);
    return opacity > 0 ? [{ ...cursor, opacity }] : [];
  });
}
