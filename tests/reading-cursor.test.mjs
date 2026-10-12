import test from 'node:test';
import assert from 'node:assert/strict';
import { getReadingCursors, READING_BAR_WIDTH } from '../shared/reading-cursor.mjs';

const getReadingCursor = (...args) => getReadingCursors(...args)[0] ?? null;
const word = (overrides = {}) => ({ text: 'Hold ', start: 20, end: 24, x: 500, y: 360, width: 200, lineIndex: 0, opacity: 1, fontSize: 64, ...overrides });
test('the 3px bar drifts in from the left and reaches the first word at its onset', () => {
  const words = [word()];
  assert.equal(READING_BAR_WIDTH, 3);
  assert.equal(getReadingCursor(words, 0).x, -3);
  assert.equal(getReadingCursor(words, 10).phase, 'approach');
  assert.ok(getReadingCursor(words, 10).x > 0 && getReadingCursor(words, 10).x < 500);
  assert.equal(getReadingCursor(words, 20).x, 500);
  assert.equal(getReadingCursor(words, 20).phase, 'singing');
});
