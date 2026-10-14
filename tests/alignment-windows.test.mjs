import test from 'node:test';
import assert from 'node:assert/strict';
import { guardReferenceTiming } from '../shared/alignment-windows.mjs';
test('alignment outside a repeated lyric occurrence is cleared locally', () => {
  const result = { timing: 'database', notes: [], lines: [{ text: 'repeat', timing: 'database', start: 9, end: 10, words: [{ text: 'repeat', start: 9, end: 10 }] }] };
  const reference = [{ text: 'repeat', timing: 'database', start: 1, end: 2 }];
  const repaired = guardReferenceTiming(result, reference, { duration: 20 });
  assert.equal(repaired.lines[0].start, 1); assert.equal(repaired.lines[0].end, 2);
  assert.equal(repaired.lines[0].words[0].start, null);
});
