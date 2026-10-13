import test from 'node:test';
import assert from 'node:assert/strict';
import { frameState, unitProgress, lyricPairs } from '../shared/karaoke.mjs';
import { applyAlignment, prepareLines, validateLines, validateFont } from '../electron/timing.mjs';

const line = (text, start, end, extra = {}) => ({ text, start, end, words: [{ text, start, end }], agreement: 1, heard: text, review: false, ...extra });
test('first pair fades at line three without shifting the remaining lines', () => {
  const lines = [line('one', 2, 3), line('two', 4, 5), line('three', 6, 7), line('four', 8, 9), line('next', 12, 13)];
  assert.equal(frameState(lines, 5.9, 20)[0].opacity, 1);
  const halfway = frameState(lines, 6.225, 20);
  assert.ok(Math.abs(halfway[0].opacity - .5) < .001);
  assert.equal(halfway[2].opacity, 1); assert.equal(halfway[2].slot, 2);
  assert.deepEqual(frameState(lines, 6.5, 20).map(row => row.index), [4, 2, 3]);
  assert.equal(frameState(lines, 6.5, 20).find(row => row.index === 2).slot, 2);
  assert.deepEqual(frameState(lines, 10.6, 20).map(row => row.index), [4, 2, 3]);
});
test('stanza boundaries are respected, including a short chorus and final partial block', () => {
  const lines = Array.from({ length: 9 }, (_, i) => line(String(i), i * 2 + 2, i * 2 + 3, { blockStart: i === 3 }));
  assert.deepEqual(lyricPairs(lines), [[0, 1], [2], [3, 4], [5, 6], [7, 8]]);
  const prepared = prepareLines({ lines: [line('Verse', null, null), line('Chorus', null, null)] }, { plainLyrics: 'Verse\n\n[Chorus]\nChorus', syncedLyrics: '' });
  assert.equal(prepared.lines[1].blockStart, true);
});
test('a held syllable sweeps for its full duration and pauses through silence', () => {
  const vowel = { start: 2, end: 5 };
  assert.equal(unitProgress(vowel, 1), 0); assert.equal(unitProgress(vowel, 3.5), .5); assert.equal(unitProgress(vowel, 6), 1);
  assert.equal(unitProgress({ start: 7, end: 8 }, 6), 0);
  assert.equal(unitProgress({ start: null, end: null }, 6), 0);
});
