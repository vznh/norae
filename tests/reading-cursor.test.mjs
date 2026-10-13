import test from 'node:test';
import assert from 'node:assert/strict';
import { getReadingCursors, READING_BAR_WIDTH } from '../shared/reading-cursor.mjs';
import { frameState } from '../shared/karaoke.mjs';

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
test('verse approaches have constant speed instead of easing toward the first word', () => {
  const words = [word()];
  assert.equal(getReadingCursor(words, 5).x, 122.75);
  assert.equal(getReadingCursor(words, 10).x, 248.5);
  assert.equal(getReadingCursor(words, 15).x, 374.25);
  const laterVerse = [word({ start: 30, end: 34, lineIndex: 4, verseStart: true, leadInStart: 26 })];
  assert.equal(getReadingCursor(laterVerse, 27).x, 122.75);
  assert.equal(getReadingCursor(laterVerse, 28).x, 248.5);
  assert.equal(getReadingCursor(laterVerse, 29).x, 374.25);
});
test('held syllables control the speed; word gaps move the cursor without starting the next word', () => {
  const words = [word(), word({ text: 'on', start: 26, end: 27, x: 750, width: 100 })];
  assert.equal(getReadingCursor(words, 22).x, 600);
  assert.equal(getReadingCursor(words, 25).x, 725);
  assert.equal(getReadingCursor(words, 25).phase, 'gap');
  assert.equal(getReadingCursor(words, 26).x, 750);
});
test('ordinary lines crossfade simultaneously at EOL, including contiguous onsets', () => {
  const words = [word(), word({ start: 24, end: 28, lineIndex: 1, x: 600, y: 480 })];
  const cursors = getReadingCursors(words, 24);
  assert.equal(cursors.length, 2);
  assert.equal(cursors[0].x, 700); assert.equal(cursors[1].x, 600);
  assert.ok(Math.abs(cursors[0].opacity - .5) < .001);
  assert.ok(Math.abs(cursors[1].opacity - .5) < .001);
  assert.deepEqual(getReadingCursors(words, 24), cursors);
  assert.equal(getReadingCursors(words, 24.2).length, 1);
  assert.equal(getReadingCursors(words, 24.2)[0].phase, 'singing');
});
test('tight line transitions crossfade at the first glyph without crossing the canvas', () => {
  const words = [word(), word({ start: 24.1, end: 25.1, lineIndex: 1, x: 600, y: 480 })];
  const cursor = getReadingCursors(words, 24.08).find(cursor => cursor.lineIndex === 1);
  assert.equal(cursor.phase, 'waiting'); assert.equal(cursor.y, 480); assert.equal(cursor.x, 600);
});
test('a pause within a normal verse approaches linearly instead of parking at the first word', () => {
  const words = [word(), word({ start: 30, end: 31, lineIndex: 1, x: 600, y: 480 })];
  const cursor = getReadingCursor(words, 27);
  assert.equal(cursor.phase, 'approach'); assert.equal(cursor.y, 480); assert.equal(cursor.x, 298.5);
  assert.equal(getReadingCursor(words, 30).x, 600);
  assert.deepEqual(getReadingCursor(words, 27), cursor);
});
test('explicit verse boundaries retain a left approach even with a brief gap', () => {
  const words = [word({ lineIndex: 3 }), word({ start: 24.1, end: 25.1, lineIndex: 4, verseStart: true, leadInStart: 23.9, x: 600 })];
  const cursor = getReadingCursors(words, 24.05).find(cursor => cursor.lineIndex === 4);
  assert.equal(cursor.phase, 'approach'); assert.ok(Math.abs(cursor.x - 298.5) < .001);
});
test('brief single-word lines keep a fully visible bar through the middle of their sung duration', () => {
  const words = [word({ start: 1, end: 1.1 }), word({ text: 'Yes', start: 1.1, end: 1.2, lineIndex: 1, x: 600, width: 60 }), word({ start: 1.2, end: 2, lineIndex: 2 })];
  for (const time of [1.13, 1.15, 1.17]) {
    const cursor = getReadingCursors(words, time).find(cursor => cursor.lineIndex === 1);
    assert.equal(cursor.phase, 'singing'); assert.equal(cursor.opacity, 1);
    assert.ok(cursor.x > 600 && cursor.x < 660);
  }
});
test('the final bar fades out after the last word', () => {
  assert.ok(Math.abs(getReadingCursor([word()], 24.12).opacity - .5) < .001);
  assert.equal(getReadingCursor([word()], 24.3), null);
});
test('untimed words never fabricate a reading cue', () => {
  assert.equal(getReadingCursor([word({ start: null, end: null })], 1), null);
});
test('upcoming lyrics stay visible for the whole instrumental lead-in', () => {
  const lines = Array.from({ length: 5 }, (_, index) => ({ text: 'Fixture', start: index < 4 ? 20 + index * 2 : 40, end: index < 4 ? 21 + index * 2 : 41, blockStart: index === 0 }));
  assert.deepEqual(frameState(lines, 0, 50).map(row => row.index), [0, 1, 2, 3]);
  const nextBlock = frameState(lines, 30, 50);
  assert.deepEqual(nextBlock.map(row => row.index), [4, 2, 3]);
  assert.ok(nextBlock[0].leadInStart < 30);
});
