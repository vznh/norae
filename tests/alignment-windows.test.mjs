import test from 'node:test';
import assert from 'node:assert/strict';
import { guardReferenceTiming } from '../shared/alignment-windows.mjs';
import { applyAlignment, prepareLines, repairReferenceTiming } from '../electron/timing.mjs';
import { reconcile } from '../electron/core.mjs';
import { pairWindows, frameState } from '../shared/lyric-sequence.mjs';

const lyrics = { plainLyrics: 'Sing home\nSing home\nSing home\nFinish', syncedLyrics: '[00:01]Sing home\n[00:06]Sing home\n[00:11]Sing home\n[00:16]Finish' };
const badWords = [
  { text: 'Sing', start: 1, end: 1.2 }, { text: 'home', start: 6, end: 6.4 },
  { text: 'Sing', start: 11, end: 11.2 }, { text: 'home', start: 11.3, end: 11.6 },
  { text: 'Sing', start: 12, end: 12.2 }, { text: 'home', start: 12.3, end: 12.6 },
  { text: 'Finish', start: 16, end: 17 },
];
test('monotonic word timestamps cannot steal a later repetition from its reference line', () => {
  const result = prepareLines(reconcile(lyrics, [], 20), lyrics);
  const guarded = applyAlignment(result, { words: badWords }, 20, lyrics);
  assert.deepEqual(guarded.lines.map(line => line.words.map(word => word.start)), [[1, null], [null, null], [12, 12.3], [16]]);
  assert.deepEqual(guarded.lines.slice(0, 2).map(line => [line.start, line.end]), [[1, 6], [6, 11]]);
  assert.equal(guarded.timing, 'partial'); assert.match(guarded.notes[0], /3 words/);
});
test('saved bad alignment repairs locally and pair order stays stable when seeking', () => {
  const result = prepareLines(reconcile(lyrics, [], 20), lyrics);
  const saved = applyAlignment(result, { words: badWords }, 20);
  const guarded = repairReferenceTiming(saved, lyrics, 20);
  const windows = pairWindows(guarded.lines, 20);
  assert.ok(windows.every((window, i) => !i || window.first >= windows[i - 1].first));
  const before = frameState(guarded.lines, 7, 20);
  frameState(guarded.lines, 18, 20);
  assert.deepEqual(frameState(guarded.lines, 7, 20), before);
  assert.equal(repairReferenceTiming(guarded, lyrics, 20), guarded);
});
test('manual timing and lyrics without reliable reference windows remain unchanged', () => {
  const result = prepareLines(reconcile(lyrics, [], 20), lyrics);
  result.lines[0] = { ...result.lines[0], timing: 'manual', words: [{ text: 'Sing ', start: 8, end: 8.2 }, { text: 'home', start: 8.3, end: 8.5 }], start: 8, end: 8.5 };
  assert.equal(guardReferenceTiming(result, reconcile(lyrics, [], 20).lines).lines[0], result.lines[0]);
  assert.equal(repairReferenceTiming(result, { plainLyrics: lyrics.plainLyrics }, 20), result);
});
test('saved transcript recovers repeated words only within this occurrence without inventing missing units', () => {
  const result = prepareLines(reconcile(lyrics, [], 20), lyrics);
  const saved = applyAlignment(result, { words: badWords }, 20);
  const transcript = [{ text: 'Sing', start: 6.1, end: 6.3 }, { text: 'home', start: 6.4, end: 6.8 }];
  const repaired = repairReferenceTiming(saved, lyrics, 20, transcript);
  assert.deepEqual(repaired.lines[1].words.map(word => word.start), [6.1, 6.4]);
  assert.equal(repaired.lines[0].words[1].start, null);
  assert.equal(repaired.lines[2].words[0].start, 12);
  assert.equal(repairReferenceTiming(repaired, lyrics, 20, transcript), repaired);
});
test('transcript recovery cannot overlap a retained word on the next lyric line', () => {
  const reference = reconcile(lyrics, [], 20).lines;
  const result = prepareLines(reconcile(lyrics, [], 20), lyrics);
  result.lines[1].words = [{ text: 'Sing ', start: 5.8, end: 6.1 }, { text: 'home', start: 6.2, end: 6.5 }];
  const repaired = guardReferenceTiming(result, reference, { transcript: [{ text: 'home', start: 5.5, end: 5.9 }], duration: 20 });
  assert.equal(repaired.lines[0].words[1].start, null);
  assert.equal(repaired.lines[1].words[0].start, 5.8);
});
