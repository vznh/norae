import test from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas } from '@napi-rs/canvas';
import { reconcile } from '../electron/core.mjs';
import { prepareLines, validateLines } from '../electron/timing.mjs';
import { groupTranscriptLines, reflowLyrics, lyricSections } from '../shared/lyrics.mjs';
import { drawKaraoke, displayLyricText } from '../shared/karaoke.mjs';

const wordTranscript = text => text.split(' ').map((text, i) => ({ text, start: 1 + i * .4, end: 1.3 + i * .4 }));
test('word-level transcription produces full lines without losing word times or inventing accuracy', () => {
  const words = wordTranscript('We leave the lights behind. And find a place to sing.');
  const result = reconcile(null, words, 15);
  assert.deepEqual(result.lines.map(line => line.text), ['We leave the lights behind.', 'And find a place to sing.']);
  assert.equal(result.lines[0].words[2].start, words[2].start);
  assert.equal(result.lines[1].words.at(-1).end, words.at(-1).end);
  assert.equal(result.agreement, null); assert.ok(result.lines.every(line => line.review));
  assert.match(result.notes[0], /estimated line and verse breaks/);
});
test('long pauses create estimated stanza breaks while short gaps retain phrases', () => {
  const words = wordTranscript('We sing together. We sing again.');
  words.slice(3).forEach(word => { word.start += 4; word.end += 4; });
  const lines = groupTranscriptLines(words);
  assert.equal(lines.length, 2); assert.equal(lines[1].blockStart, true); assert.equal(lyricSections(lines).length, 2);
  assert.equal(lines[1].section, '');
});
test('word-synced lyrics follow the reference verse and chorus lines, including repeats', () => {
  const lyrics = { plainLyrics: '[Verse 1]\nWe sing home\n\n[Chorus]\nWe sing home', syncedLyrics: '[00:01]We\n[00:02]sing\n[00:03]home\n[00:05]We\n[00:06]sing\n[00:07]home' };
  const result = prepareLines(reconcile(lyrics, [], 10), lyrics);
  assert.deepEqual(result.lines.map(line => line.text), ['We sing home', 'We sing home']);
  assert.deepEqual(result.lines.map(line => line.start), [1, 5]);
  assert.deepEqual(result.lines.map(line => line.section), ['Verse 1', 'Chorus']);
  assert.ok(result.lines.every(line => line.blockStart));
});
test('a phrase timestamp cannot invent distinct timing for multiple reference lines', () => {
  const result = reconcile({ plainLyrics: 'We sing\ntogether', syncedLyrics: '[00:01]We sing together' }, [], 10);
  assert.deepEqual(result.lines.map(line => line.start), [null, null]);
  assert.ok(result.lines.every(line => line.review && line.timing === 'untimed'));
});
test('verse reflow preserves timed syllables, keeps labels, and rejects changed words', () => {
  const lines = [{ text: 'away we sing', words: [{ text: 'a', start: 1, end: 1.2 }, { text: 'way ', start: 1.2, end: 4 }, { text: 'we ', start: 4.2, end: 4.5 }, { text: 'sing', start: 5, end: 6 }] }];
  const result = reflowLyrics(lines, '[Verse 1]\naway\n\n[Chorus]\nwe sing');
  assert.deepEqual(result.map(line => line.text), ['away', 'we sing']);
  assert.equal(result[0].words[1].end, 4); assert.equal(result[1].words[0].start, 4.2);
  assert.deepEqual(result.map(line => line.section), ['Verse 1', 'Chorus']);
  assert.equal(validateLines(result, 10)[0].section, 'Verse 1');
  assert.throws(() => reflowLyrics(lines, 'away we dance'), /change line breaks/);
});
test('a vertical reading bar crosses the word, leaves blue text, and creates no underline', () => {
  const canvas = createCanvas(1920, 1080), ctx = canvas.getContext('2d');
  const lines = [{ text: 'Hold', start: 1, end: 5, blockStart: true, words: [{ text: 'Hold', start: 1, end: 5 }] }];
  drawKaraoke(ctx, lines, 3, 8);
  ctx.font = '64px Arial'; const width = ctx.measureText('Hold').width, left = (1920 - width) / 2;
  const pixel = (x, y) => [...ctx.getImageData(Math.round(x), y, 1, 1).data].slice(0, 3);
  assert.deepEqual(pixel(960, 340), [153, 153, 153]);
  assert.deepEqual(pixel(left + width * .25, 403), [0, 0, 0]);
  const countBlue = () => { const image = ctx.getImageData(Math.floor(left), 320, Math.ceil(width / 2) - 4, 75).data; let pixels = 0; for (let i = 0; i < image.length; i += 4) if (image[i] === 59 && image[i + 1] === 130 && image[i + 2] === 246) pixels++; return pixels; };
  assert.ok(countBlue() > 0);
  drawKaraoke(ctx, lines, .8, 8);
  assert.equal(countBlue(), 0);
});
test('periods are hidden in rendered lyrics without mutating text or timing', () => {
  assert.equal(displayLyricText('Hold... on. Wait…'), 'Hold on Wait');
  const canvas = createCanvas(1920, 1080), ctx = canvas.getContext('2d');
  const lines = [{ text: 'Hold.', start: 1, end: 5, blockStart: true, words: [{ text: 'Hold.', start: 1, end: 5 }] }];
  const saved = structuredClone(lines);
  drawKaraoke(ctx, lines, 3, 8);
  const withPeriods = canvas.toBuffer('image/png');
  drawKaraoke(ctx, [{ ...lines[0], text: 'Hold', words: [{ ...lines[0].words[0], text: 'Hold' }] }], 3, 8);
  assert.deepEqual(canvas.toBuffer('image/png'), withPeriods);
  assert.deepEqual(lines, saved);
});
test('both bars are rendered during a line handoff without coloring the incoming line early', () => {
  const canvas = createCanvas(1920, 1080), ctx = canvas.getContext('2d');
  const lines = [
    { text: 'Hold', start: 1, end: 5, blockStart: true, words: [{ text: 'Hold', start: 1, end: 5 }] },
    { text: 'On', start: 5, end: 8, words: [{ text: 'On', start: 5, end: 8 }] },
  ];
  drawKaraoke(ctx, lines, 4.98, 10);
  ctx.font = '64px Arial';
  const outgoingX = (1920 - ctx.measureText('Hold').width) / 2 + ctx.measureText('Hold').width * .995;
  const incomingX = (1920 - ctx.measureText('On').width) / 2;
  const pixel = (x, y) => ctx.getImageData(Math.round(x), y, 1, 1).data[0];
  assert.ok(pixel(outgoingX, 327) > 0);
  assert.ok(pixel(incomingX, 447) > 0);
  const image = ctx.getImageData(800, 440, 320, 80).data;
  for (let i = 0; i < image.length; i += 4) assert.ok(!(image[i] === 59 && image[i + 1] === 130 && image[i + 2] === 246));
});

test('line-synced lyrics with matching Scribe words render the bar even before forced alignment', () => {
  const transcript = [{ text: 'Hold', start: 1, end: 5 }, { text: 'on.', start: 5.2, end: 6 }];
  const lyrics = { plainLyrics: 'Hold on.', syncedLyrics: '[00:01]Hold on.' };
  const result = prepareLines(reconcile(lyrics, transcript, 8), lyrics);
  assert.deepEqual(result.lines[0].words.map(({ start, end }) => ({ start, end })), [{ start: 1, end: 5 }, { start: 5.2, end: 6 }]);
  const canvas = createCanvas(1920, 1080), ctx = canvas.getContext('2d');
  drawKaraoke(ctx, result.lines, 3, 8);
  ctx.font = '64px Arial';
  const x = (1920 - ctx.measureText('Hold on').width) / 2 + ctx.measureText('Hold').width / 2;
  assert.deepEqual([...ctx.getImageData(Math.round(x), 327, 1, 1).data].slice(0, 3), [153, 153, 153]);
});
test('phrase timestamps, incomplete word matches, and out-of-window words never invent word timing', () => {
  const lyrics = { plainLyrics: 'Hold on', syncedLyrics: '[00:01]Hold on' };
  for (const transcript of [
    [{ text: 'Hold on', start: 1, end: 5 }],
    [{ text: 'Hold', start: 1, end: 5 }],
    [{ text: 'Hold', start: 10, end: 11 }, { text: 'on', start: 11, end: 12 }],
  ]) {
    const result = prepareLines(reconcile(lyrics, transcript, 8), lyrics);
    assert.ok(result.lines[0].words.every(word => word.start === null && word.end === null));
  }
});

test('the bar traverses held third and fourth lines and crossfades without a premature page turn', () => {
  const canvas = createCanvas(1920, 1080), ctx = canvas.getContext('2d');
  const row = (text, start, end, wordStart = start, wordEnd = end) => ({ text, start, end, words: [{ text, start: wordStart, end: wordEnd }] });
  const lines = [row('one', 1, 2), row('two', 3, 4), row('three', 5, 6, 5, 10), row('four', 11, 12, 10, 16), row('next', 13, 14, 18, 19)];
  const barPixel = (text, progress, slot) => {
    ctx.font = '64px Arial'; const width = ctx.measureText(text).width;
    return ctx.getImageData(Math.round((1920 - width) / 2 + width * progress), 327 + slot * 120, 1, 1).data[0];
  };
  drawKaraoke(ctx, lines, 9, 25);
  assert.equal(barPixel('three', .8, 2), 153);
  drawKaraoke(ctx, lines, 10, 25);
  assert.ok(barPixel('three', 1, 2) > 60 && barPixel('three', 1, 2) < 93);
  assert.ok(barPixel('four', 0, 3) > 60 && barPixel('four', 0, 3) < 93);
  drawKaraoke(ctx, lines, 15.9, 25);
  // The intended 240ms EOL handoff has just begun; the cue is still visible.
  assert.ok(barPixel('four', 5.9 / 6, 3) > 132);
  drawKaraoke(ctx, lines, 18.5, 25);
  assert.equal(barPixel('next', .5, 0), 153);
});
test('a third-line bar remains visible when the fourth line has no timing', () => {
  const canvas = createCanvas(1920, 1080), ctx = canvas.getContext('2d');
  const lines = ['one', 'two', 'three', 'four'].map((text, index) => ({ text, start: index === 3 ? null : index * 2 + 1, end: index === 3 ? null : index === 2 ? 9 : index * 2 + 2, words: [{ text, start: index === 3 ? null : index * 2 + 1, end: index === 3 ? null : index === 2 ? 9 : index * 2 + 2 }] }));
  drawKaraoke(ctx, lines, 7, 12);
  assert.deepEqual([...ctx.getImageData(960, 567, 1, 1).data].slice(0, 3), [153, 153, 153]);
});
