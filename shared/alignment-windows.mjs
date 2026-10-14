const comparable = text => text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const timed = word => Number.isFinite(word.start) && Number.isFinite(word.end) && word.end > word.start;

// Reference line windows distinguish identical choruses. Global word order
// alone cannot prove that an occurrence belongs to this particular line.
export function guardReferenceTiming(result, reference, { transcript = [], duration = 0 } = {}) {
  let rejected = 0, recovered = 0, changed = false, previousEnd = 0;
  const lines = result.lines.map((line, index) => {
    const window = reference[index];
    if (line.timing === 'manual' || !window || window.timing !== 'database' || comparable(line.text) !== comparable(window.text) || !Number.isFinite(window.start) || !Number.isFinite(window.end)) {
      previousEnd = (line.words || []).filter(timed).at(-1)?.end ?? previousEnd;
      return line;
    }
    let words = (line.words || []).map(word => {
      if (!timed(word) || (word.start >= window.start - .5 && word.start < window.end && word.end <= window.end + .5)) return word;
      rejected++;
      return { ...word, start: null, end: null };
    });
    if (words.some(word => !timed(word)) && transcript.length) {
      const observed = transcript.filter(word => timed(word) && word.start >= window.start - .5 && word.start < window.end && word.end <= window.end);
      const local = mapAlignmentUnits(words, { words: observed }, duration);
      const nextLine = result.lines[index + 1], nextWindow = reference[index + 1];
      const nextWord = nextLine?.words?.find(word => timed(word) && (nextLine.timing === 'manual' || (nextWindow && word.start >= nextWindow.start - .5 && word.end <= nextWindow.end + .5)));
      words = words.map((word, i) => {
        const next = Math.min(words.slice(i + 1).find(timed)?.start ?? window.end, nextWord?.start ?? window.end);
        const candidate = local[i];
        if (!timed(word) && timed(candidate) && candidate.start >= previousEnd - .01 && candidate.end <= next + .01) { recovered++; previousEnd = candidate.end; return candidate; }
        if (timed(word)) previousEnd = word.end;
        return word;
      });
    } else previousEnd = words.filter(timed).at(-1)?.end ?? previousEnd;
    const complete = words.length > 0 && words.every(timed);
    // Partial alignment must not expand a line into a later repetition.
    const start = complete ? words[0].start : window.start;
    const end = complete ? words.at(-1).end : window.end;
    if (start === line.start && end === line.end && words.every((word, i) => word === line.words[i])) return line;
    changed = true;
    return { ...line, words, start, end, timing: complete ? line.timing === 'untimed' ? 'transcript' : line.timing : words.some(timed) ? 'partial' : 'untimed', review: true };
  });
  if (!changed) return result;
  return { ...result, lines, timing: 'partial', notes: [
    `Conflicting alignment was removed from ${rejected} words; recovered ${recovered} from the saved transcript within their lyric lines. Uncertain words need review. No word boundaries were guessed.`,
    ...(result.notes || []).filter(note => !note.startsWith('Conflicting alignment')),
  ] };
}
import { mapAlignmentUnits } from './alignment.mjs';
