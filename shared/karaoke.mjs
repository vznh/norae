import { getReadingCursors, READING_BAR_OPACITY, READING_BAR_WIDTH, SUNG_TEXT_COLOR, UPCOMING_TEXT_COLOR } from './reading-cursor.mjs';
import { pairWindows, pairOpacity, sequenceState, clamp } from './lyric-sequence.mjs';
export { FADE_SECONDS, clamp, hasCompleteWordTiming, lineTiming, lyricPairs, frameState } from './lyric-sequence.mjs';

export const fonts = [
  { name: 'Arial', description: 'Neutral, familiar letterforms' },
  { name: 'Verdana', description: 'Wide letters and generous spacing' },
  { name: 'Trebuchet MS', description: 'Rounded letters with distinct shapes' },
];
export const unitsFor = text => (text.match(/\S+\s*/g) || []).map(text => ({ text, start: null, end: null }));
// Presentation only: reference lyrics and their alignment tokens stay intact.
export const displayLyricText = text => text.replace(/[.\u2026]/g, '');
export function unitProgress(unit, position) {
  return unit.start === null || unit.end === null || unit.end <= unit.start ? 0 : clamp((position - unit.start) / (unit.end - unit.start));
}

function layoutPair(ctx, lines, window, font, size) {
  ctx.font = `${size}px "${font}"`;
  return window.indices.flatMap((index, lineOffset) => {
    const line = lines[index];
    const units = (line.words?.length ? line.words : unitsFor(line.text)).map(unit => ({ ...unit, text: displayLyricText(unit.text) }));
    const widths = units.map(unit => ctx.measureText(unit.text).width);
    let x = (1920 - widths.reduce((sum, width) => sum + width, 0)) / 2;
    return units.map((unit, unitIndex) => {
      const positioned = { ...unit, x, y: 360 + (window.bank * 2 + lineOffset) * 120, width: ctx.measureText(unit.text.trimEnd()).width, fontSize: size, lineIndex: index, verseStart: index === 0 || !!line.blockStart, leadInStart: window.start };
      x += widths[unitIndex];
      return positioned;
    });
  });
}

// Identical layout, gaps, highlight and pair fades in desktop preview and MP4.
export function drawKaraoke(ctx, lines, position, duration, { font = 'Arial', copyright = '', readingBarWidth = READING_BAR_WIDTH } = {}) {
  ctx.save(); ctx.globalAlpha = 1; ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 1920, 1080);
  const windows = pairWindows(lines, duration);
  const state = sequenceState(windows, position);
  const activePair = windows.filter(window => window.first !== null && window.first <= position).at(-1) || windows[0];
  const section = activePair ? lines.slice(0, activePair.indices[0] + 1).reverse().find(line => line.blockStart)?.section : '';
  if (section && state.length) { ctx.fillStyle = '#aaa'; ctx.font = '26px Arial'; ctx.textAlign = 'center'; ctx.fillText(section, 960, 215, 1660); }
  // Stable font geometry across replacement keeps the untouched bank in place.
  ctx.font = `64px "${font}"`;
  const widest = Math.max(1, ...lines.map(line => ctx.measureText(displayLyricText(line.text)).width));
  const size = 64 * Math.min(1, 1660 / widest);
  const visiblePairs = new Set(state.map(row => row.pairIndex));
  const layouts = windows.filter(window => visiblePairs.has(window.pairIndex)).map(window => ({ window, units: layoutPair(ctx, lines, window, font, size) }));
  const rowOpacity = new Map(state.map(row => [row.index, row.opacity]));
  ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  for (const { units } of layouts) for (const unit of units) {
    const { x, y, width, fontSize } = unit;
    ctx.font = `${fontSize}px "${font}"`;
    ctx.globalAlpha = rowOpacity.get(unit.lineIndex) ?? 0;
    ctx.fillStyle = UPCOMING_TEXT_COLOR; ctx.fillText(unit.text, x, y);
    const progress = unitProgress(unit, position);
    if (progress > 0) {
      ctx.save(); ctx.beginPath(); ctx.rect(x - 1, y - fontSize, Math.max(0, width * progress + 1), fontSize * 2); ctx.clip();
      ctx.fillStyle = SUNG_TEXT_COLOR; ctx.fillText(unit.text, x, y); ctx.restore();
    }
  }
  const cursorWords = layouts.flatMap(({ window, units }) => units.map(unit => ({ ...unit, opacity: pairOpacity(window, position) })));
  for (const cursor of getReadingCursors(cursorWords, position)) {
    ctx.globalAlpha = cursor.opacity * READING_BAR_OPACITY; ctx.fillStyle = '#fff'; ctx.beginPath();
    ctx.roundRect(cursor.x - readingBarWidth / 2, cursor.y - cursor.fontSize * .58, readingBarWidth, cursor.fontSize * 1.16, readingBarWidth / 4);
    ctx.fill();
  }
  if (copyright) {
    ctx.globalAlpha = 1; ctx.fillStyle = '#aaa'; ctx.font = '18px Arial'; ctx.textAlign = 'center';
    ctx.fillText(copyright.replace(/\s+/g, ' ').slice(0, 1000), 960, 1035, 1740);
  }
  ctx.restore();
}
