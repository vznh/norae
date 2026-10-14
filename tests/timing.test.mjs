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
test('alignment preserves lyric spelling, handles contractions, and cannot skip a repeated chorus', () => {
  const result = prepareLines({ lines: [line("Can't go", null, null), line('go', null, null)] });
  const aligned = applyAlignment(result, { words: [{ text: 'Can', start: 1, end: 1.2 }, { text: 't', start: 1.2, end: 1.4 }, { text: 'go', start: 2, end: 4 }, { text: 'go', start: 6, end: 7 }] }, 10);
  assert.equal(aligned.lines[0].words[0].text, "Can't "); assert.equal(aligned.lines[0].words[0].end, 1.4);
  assert.equal(aligned.lines[1].start, 6);
  assert.throws(() => applyAlignment(result, { words: [{ text: 'Wrong', start: 1, end: 2 }] }, 10), /do not match/);
});
test('reviewer timing rejects overlaps, incomplete exports, text mismatches, and unsupported fonts', () => {
  assert.throws(() => validateLines([line('a', 1, 3), line('b', 2, 4)], 10), /times must increase/);
  assert.throws(() => validateLines([line('a', null, null)], 10, { requireTiming: true }), /set both start and end/);
  assert.throws(() => validateLines([line('a', 1, 11)], 10), /stay within/);
  assert.throws(() => validateLines([{ ...line('a', 1, 2), words: [{ text: 'b', start: 1, end: 2 }] }], 10), /reproduce/);
  assert.throws(() => validateFont('injected font'), /Choose Arial/);
  assert.equal(validateLines([line('a', 1, 2)], 10)[0].timing, 'manual');
});

test('page timing follows held words on lines three and four instead of stale line timestamps', () => {
  const lines = [
    line('one', 1, 2), line('two', 3, 4),
    line('three', 5, 6, { words: [{ text: 'three', start: 5, end: 10 }] }),
    line('four', 11, 12, { words: [{ text: 'four', start: 11, end: 16 }] }),
    line('next', 13, 14, { words: [{ text: 'next', start: 18, end: 19 }] }),
  ];
  assert.deepEqual(frameState(lines, 9, 25).map(row => row.index), [4, 2, 3]);
  const fourth = frameState(lines, 15.9, 25);
  assert.deepEqual(fourth.map(row => row.index), [4, 2, 3]);
  assert.equal(fourth.find(row => row.index === 3).opacity, 1);
  assert.deepEqual(frameState(lines, 18.5, 25).map(row => row.index), [4]);
});
test('an untimed fourth line cannot hide the valid cue on line three', () => {
  const lines = [line('one', 1, 2), line('two', 3, 4), line('three', 5, 9), line('four', null, null)];
  assert.deepEqual(frameState(lines, 7, 12).map(row => row.index), [2, 3]);
});
test('an untimed first line cannot hide timed lower lines in the same page', () => {
  const lines = [line('one', null, null), line('two', 3, 4), line('three', 5, 9), line('four', 10, 11)];
  assert.deepEqual(frameState(lines, 7, 15).map(row => row.index), [2, 3]);
});

test('character alignment restores all lyric words despite incompatible word tokenization', () => {
  const result = prepareLines({ lines: [line("Can't re-enter", null, null)] });
  const text = "Can't re-enter";
  const characters = [...text].map((text, index) => ({ text, start: 1 + index * .1, end: 1.1 + index * .1 }));
  const aligned = applyAlignment(result, { characters, words: [{ text: 'Cannot', start: 1, end: 1.4 }, { text: 'reenter', start: 1.6, end: 2.3 }] }, 10);
  assert.equal(aligned.timing, 'aligned');
  assert.equal(aligned.lines[0].words[0].text, "Can't ");
  assert.equal(aligned.lines[0].words[0].start, 1);
  assert.ok(Math.abs(aligned.lines[0].words[0].end - 1.5) < .001);
  assert.equal(aligned.lines[0].words[1].start, 1.6);
});
test('one mismatched word keeps valid timing on this line and all following lines', () => {
  const result = prepareLines({ lines: [line('Sing bright now', 1, 4), line('Bring it home', 5, 9)] });
  const words = ['Sing', 'wrong', 'now', 'Bring', 'it', 'home'].map((text, index) => ({ text, start: index + 1, end: index + 1.5 }));
  const aligned = applyAlignment(result, { words }, 10);
  assert.equal(aligned.timing, 'partial');
  assert.deepEqual(aligned.lines[0].words.map(word => word.start), [1, null, 3]);
  assert.deepEqual(aligned.lines[1].words.map(word => word.start), [4, 5, 6]);
  assert.equal(aligned.lines[0].review, true);
  assert.doesNotThrow(() => validateLines(aligned.lines, 10));
  assert.throws(() => validateLines(aligned.lines, 10, { requireTiming: true }), /set both start and end/);
});
test('a returned phrase never fabricates its internal word boundaries without characters', () => {
  const result = prepareLines({ lines: [line('We sing together', 1, 8)] });
  const aligned = applyAlignment(result, { words: [{ text: 'We sing', start: 1, end: 4 }, { text: 'together', start: 5, end: 7 }] }, 10);
  assert.deepEqual(aligned.lines[0].words.map(word => word.start), [null, null, 5]);
});
test('an invalid interval stays local and valid later words remain usable', () => {
  const result = prepareLines({ lines: [line('Sing it now', null, null)] });
  const aligned = applyAlignment(result, { words: [{ text: 'Sing', start: 1, end: 2 }, { text: 'it', start: 2, end: 2 }, { text: 'now', start: 3, end: 4 }] }, 10);
  assert.deepEqual(aligned.lines[0].words.map(word => word.start), [1, null, 3]);
});
test('a missing repeated chorus stays ambiguous rather than borrowing a later occurrence', () => {
  const result = prepareLines({ lines: [line('We sing', 1, 2), line('We sing', 5, 6), line('Finish', 7, 8)] });
  const aligned = applyAlignment(result, { words: [{ text: 'We', start: 5, end: 5.4 }, { text: 'sing', start: 5.4, end: 6 }, { text: 'Finish', start: 7, end: 8 }] }, 10);
  assert.ok(aligned.lines.slice(0, 2).every(line => line.words.every(word => word.start === null)));
  assert.equal(aligned.lines[2].words[0].start, 7);
});

test('a missing alignment word retains compatible existing timing without claiming it was newly aligned', () => {
  const result = prepareLines({ lines: [{ ...line('Sing bright now', 1, 5), words: [{ text: 'Sing ', start: 1, end: 2 }, { text: 'bright ', start: 2.1, end: 3 }, { text: 'now', start: 4, end: 5 }] }] });
  const aligned = applyAlignment(result, { words: [{ text: 'Sing', start: 1, end: 2 }, { text: 'wrong', start: 2.1, end: 3 }, { text: 'now', start: 4, end: 5 }] }, 10);
  assert.deepEqual(aligned.lines[0].words.map(word => word.start), [1, 2.1, 4]);
  assert.equal(aligned.timing, 'partial'); assert.equal(aligned.lines[0].review, true);
  assert.match(aligned.notes[0], /retained existing timing for 1/);
});
