// Lyric layout belongs to the song text, independently of word timestamp granularity.
export function parseLyricLayout(text = '') {
  const lines = []; let boundary = true, section = '';
  for (const raw of text.split(/\r?\n/)) {
    const text = raw.trim();
    if (!text) { boundary = true; continue; }
    if (/^\[[^\]]+\]$/.test(text)) { section = text.slice(1, -1).trim().slice(0, 200); boundary = true; continue; }
    lines.push({ text, blockStart: boundary, section: boundary ? section : '' });
    boundary = false; section = '';
  }
  return lines;
}

// Without reference lyrics these are readable, estimated phrase/stanza breaks.
// Original word intervals are retained; no uniform word timing is fabricated.
export function groupTranscriptLines(segments = []) {
  const lines = []; let pending = [], nextSection = true;
  const finish = () => {
    if (!pending.length) return;
    const words = pending.map((word, i) => ({ text: word.text + (i < pending.length - 1 ? ' ' : ''), start: word.start, end: word.end }));
    const text = words.map(word => word.text).join('');
    lines.push({ text, words, start: pending[0].start, end: pending.at(-1).end, heard: text, agreement: null, review: true, timing: 'transcript', blockStart: nextSection, section: '' });
    pending = []; nextSection = false;
  };
  for (const segment of segments) {
    if (!segment || typeof segment.text !== 'string' || !segment.text.trim()) continue;
    const word = { text: segment.text.trim().replace(/\s+/g, ' '), start: segment.start, end: segment.end };
    const previous = pending.at(-1) || lines.at(-1);
    const gap = previous ? word.start - previous.end : 0;
    const count = pending.reduce((sum, row) => sum + row.text.split(/\s+/).length, 0);
    const length = pending.reduce((sum, row) => sum + row.text.length + 1, 0);
    if (pending.length && (gap >= 2.5 || (gap >= 1 && count >= 3) || count >= 12 || length + word.text.length > 70 || (count >= 4 && word.start - pending[0].start >= 7))) finish();
    if (gap >= 2.5) nextSection = true;
    pending.push(word);
    if (/[.!?]["'’”)]?$/.test(word.text) || (/[,;:]["'’”)]?$/.test(word.text) && count >= 5)) finish();
  }
  finish(); return lines;
}

export function lyricSections(lines) {
  const sections = [];
  for (let index = 0; index < lines.length; index++) {
    if (!sections.length || lines[index].blockStart) sections.push({ label: lines[index].section || '', indices: [] });
    sections.at(-1).indices.push(index);
  }
  return sections;
}
