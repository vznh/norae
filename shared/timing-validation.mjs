import { fonts } from './karaoke.mjs';

export function validateLines(lines, duration, { requireTiming = false } = {}) {
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('The recording needs a valid duration before timing can be saved or exported.');
  if (!Array.isArray(lines) || !lines.length || lines.length > 500) throw new Error('Provide between 1 and 500 lyric lines.');
  let previousEnd = 0, count = 0;
  const clean = lines.map((line, i) => {
    if (typeof line.text !== 'string' || !line.text.trim() || line.text.length > 500 || /[\r\n\0]/.test(line.text)) throw new Error(`Line ${i + 1}: enter one nonempty line, up to 500 characters.`);
    if (!Array.isArray(line.words) || !line.words.length || line.words.length > 200) throw new Error(`Line ${i + 1}: add timing units.`);
    if (line.words.map(word => word.text).join('') !== line.text) throw new Error(`Line ${i + 1}: timing units must reproduce the lyric text exactly.`);
    let lineStart = null, lineEnd = null;
    const words = line.words.map((word, j) => {
      count++;
      if (typeof word.text !== 'string' || !word.text.trim() || word.text.length > 500 || /[\r\n\0]/.test(word.text)) throw new Error(`Line ${i + 1}, unit ${j + 1}: invalid text.`);
      const untimed = word.start === null && word.end === null;
      if (!untimed && (!Number.isFinite(word.start) || !Number.isFinite(word.end) || word.start < previousEnd - .01 || word.end <= word.start || word.end > duration + .01)) throw new Error(`Line ${i + 1}, unit ${j + 1}: times must increase, end after start, and stay within the song.`);
      if (untimed && requireTiming) throw new Error(`Line ${i + 1}, unit ${j + 1}: set both start and end before exporting.`);
      if (!untimed) { previousEnd = word.end; lineStart ??= word.start; lineEnd = word.end; }
      return { text: word.text, start: word.start, end: word.end };
    });
    const timed = words.every(word => word.start !== null);
    return { text: line.text, blockStart: Boolean(i === 0 || line.blockStart), section: typeof line.section === 'string' ? line.section.replace(/[\r\n\0]/g, ' ').slice(0, 200) : '', words, start: timed ? lineStart : null, end: timed ? lineEnd : null, timing: 'manual', heard: typeof line.heard === 'string' ? line.heard.slice(0, 2000) : '', agreement: Number.isFinite(line.agreement) ? line.agreement : null, review: !timed };
  });
  if (count > 6000) throw new Error('Limit the song to 6,000 timing units.');
  return clean;
}

export function validateFont(font) {
  if (!fonts.some(option => option.name === font)) throw new Error('Choose Arial, Verdana, or Trebuchet MS.');
  return font;
}

export function exportIssue(track) {
  if (!track?.audioUrl) return 'Prepare the song audio before exporting.';
  if (['queued', 'processing'].includes(track.status) || track.steps?.alignment?.state === 'running') return 'Wait for song preparation to finish.';
  if (track.export?.state === 'running') return 'An export is already running.';
  try { validateLines(track.result?.lines, track.duration, { requireTiming: true }); validateFont(track.font || 'Arial'); }
  catch (error) { return error.message; }
  return null;
}
