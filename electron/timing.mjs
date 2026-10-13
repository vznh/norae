import { normalize, reconcile } from './core.mjs';
import { mapAlignmentUnits } from '../shared/alignment.mjs';
import { unitsFor } from '../shared/karaoke.mjs';
import { validateLines } from '../shared/timing-validation.mjs';
export { validateLines, validateFont } from '../shared/timing-validation.mjs';
import { parseLyricLayout } from '../shared/lyrics.mjs';

export function prepareLines(result, lyrics) {
  const layout = parseLyricLayout(lyrics?.plainLyrics || '');
  result.lines = result.lines.map((line, i) => {
    const reference = layout[i] && normalize(layout[i].text) === normalize(line.text) ? layout[i] : null;
    return { ...line, blockStart: Boolean(line.blockStart || reference?.blockStart || i === 0), section: line.section || reference?.section || '', words: line.words || unitsFor(line.text) };
  });
  return result;
}
export function applyAlignment(result, alignment, duration, lyrics, transcript = []) {
  const units = result.lines.flatMap(line => unitsFor(line.text));
  const mapped = mapAlignmentUnits(units, alignment, duration);
  if (!mapped.some(word => word.start !== null)) throw new Error('Aligned words do not match the supplied lyrics or have no usable timestamps. Correct the lyrics or set timing manually.');
  const nextStarts = new Array(mapped.length);
  let nextStart = duration;
  for (let i = mapped.length - 1; i >= 0; i--) { nextStarts[i] = nextStart; if (mapped[i].start !== null) nextStart = mapped[i].start; }
  let cursor = 0, previousEnd = 0, retained = 0;
  const lines = result.lines.map(line => {
    const offset = cursor;
    const fresh = mapped.slice(cursor, cursor + unitsFor(line.text).length);
    const words = fresh.map((unit, index) => {
      const old = line.words?.[index];
      const canRetain = unit.start === null && old?.text === unit.text && Number.isFinite(old.start) && Number.isFinite(old.end) && old.start >= previousEnd - .01 && old.end > old.start && old.end <= nextStarts[offset + index] + .01 && old.end <= duration;
      const word = canRetain ? { ...unit, start: old.start, end: old.end } : unit;
      if (canRetain) retained++;
      if (word.end !== null) previousEnd = word.end;
      return word;
    });
    cursor += words.length;
    const valid = words.every(word => word.start !== null && word.end !== null);
    const timed = words.filter(word => word.start !== null);
    const fullyAligned = fresh.every(word => word.start !== null);
    return { ...line, words, start: valid ? words[0].start : line.start ?? timed[0]?.start ?? null, end: valid ? words.at(-1).end : Math.max(line.end ?? 0, timed.at(-1)?.end ?? 0) || null, timing: fullyAligned ? 'aligned' : timed.length ? 'partial' : 'untimed', review: !fullyAligned || line.agreement === null || line.agreement < .85 };
  });
  validateLines(lines, duration, { requireTiming: false });
  const unmatched = mapped.filter(word => word.start === null).length;
  return { ...result, timing: unmatched ? 'partial' : 'aligned', lines, notes: [unmatched ? `Aligned ${mapped.length - unmatched} of ${mapped.length} units; retained existing timing for ${retained}. ${unmatched - retained} still need manual timing. Missing boundaries have not been guessed.` : 'ElevenLabs aligned the supplied lyrics. Word agreement is independent evidence, not a timing accuracy score. Review held vowels and slurred phrases.'] };
}
