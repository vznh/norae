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

// Apply new line/verse breaks without changing words or discarding syllable timing.
export function reflowLyrics(lines, text) {
  const layout = parseLyricLayout(text);
  if (!layout.length || layout.length > 500) throw new Error('Use between 1 and 500 lyric lines.');
  const compact = text => text.replace(/\s+/g, '');
  const original = lines.flatMap(line => line.words?.length ? line.words : [{ text: line.text, start: line.start, end: line.end }]);
  if (compact(original.map(word => word.text).join('')) !== compact(layout.map(line => line.text).join(''))) throw new Error('Verse layout can change line breaks and section headings only. Use Replace lyrics to change the words.');
  let cursor = 0;
  return layout.map(row => {
    const target = compact(row.text); let matched = '', words = [];
    while (cursor < original.length && matched.length < target.length) {
      const word = original[cursor++]; matched += compact(word.text); words.push({ ...word });
    }
    if (matched !== target) throw new Error('Place line breaks between timing units. Split the word into syllables first if needed.');
    // Reproduce the requested spacing while retaining boundaries of timed syllables.
    let character = 0;
    words = words.map(word => {
      const length = compact(word.text).length;
      const start = character; let seen = 0;
      while (character < row.text.length && seen < length) { if (!/\s/.test(row.text[character])) seen++; character++; }
      while (character < row.text.length && /\s/.test(row.text[character])) character++;
      return { ...word, text: row.text.slice(start, character) };
    });
    const timed = words.every(word => word.start !== null && word.end !== null);
    return { ...row, words, start: timed ? words[0].start : null, end: timed ? words.at(-1).end : null, heard: '', agreement: null, review: true, timing: 'manual' };
  });
}
