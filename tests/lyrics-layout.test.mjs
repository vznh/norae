import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLyricLayout, groupTranscriptLines, lyricSections } from '../shared/lyrics.mjs';
test('plain lyric layout preserves blank-line and heading boundaries', () => {
  assert.deepEqual(parseLyricLayout('Verse one\nline two\n\n[Chorus]\nSing it'), [
    { text: 'Verse one', blockStart: true, section: '' }, { text: 'line two', blockStart: false, section: '' }, { text: 'Sing it', blockStart: true, section: 'Chorus' },
  ]);
});
test('transcript words are grouped into readable timed phrases', () => {
  const words = 'We leave the lights behind. And find a place to sing.'.split(' ').map((text, i) => ({ text, start: i, end: i + .5 }));
  const lines = groupTranscriptLines(words);
  assert.equal(lines.length, 2); assert.equal(lines[0].words[2].start, 2); assert.equal(lyricSections(lines).length, 1);
});
