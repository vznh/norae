import test from 'node:test';
import assert from 'node:assert/strict';
import { youtubeUrl, parseLrc, metadata, rankCandidates, parseWhisper, reconcile } from '../electron/core.mjs';

test('YouTube validation canonicalizes single video URLs and rejects hostile hosts', () => {
  for (const value of ['https://youtu.be/abcdefghijk?t=12', 'https://music.youtube.com/watch?v=abcdefghijk&list=abc', 'https://www.youtube.com/shorts/abcdefghijk']) assert.equal(youtubeUrl(value), 'https://www.youtube.com/watch?v=abcdefghijk');
  for (const value of ['file:///etc/passwd', 'https://youtube.com.attacker.test/watch?v=abcdefghijk', 'https://youtube.com@attacker.test/watch?v=abcdefghijk', 'http://youtube.com/watch?v=abcdefghijk', 'https://youtube.com/playlist?list=abcdef', 'https://youtube.com:4000/watch?v=abcdefghijk', '--exec touch /tmp/x']) assert.throws(() => youtubeUrl(value));
});
test('metadata prefers overrides and cleans common video title suffixes', () => {
  assert.deepEqual(metadata({ title: 'Artist - My song (Official Music Video)', uploader: 'Channel', duration: 123 }), { title: 'My song', artist: 'Artist', duration: 123 });
  assert.equal(metadata({ title: 'Wrong' }, { title: 'Correct' }).title, 'Correct');
});
test('LRC supports multiple stamps, offsets and instrumental gaps', () => {
  const rows = parseLrc('[offset:-500]\n[00:02.50][01:02.5]Hello\n[00:08.000]\n[00:12]Next', 70);
  assert.deepEqual(rows.map(row => row.start), [2, 11.5, 62]);
  assert.equal(rows[0].end, 7.5);
  assert.equal(rows[2].end, 70);
});
test('candidate selection requires matching metadata and recording duration', () => {
  const rows = rankCandidates([
    { id: 1, trackName: 'Home', artistName: 'A singer', duration: 185, plainLyrics: 'a' },
    { id: 2, trackName: 'Home', artistName: 'A singer', duration: 201, plainLyrics: 'a' },
    { id: 3, trackName: 'Home', artistName: 'Another singer', duration: 185, plainLyrics: 'a' },
  ], { title: 'Home', artist: 'A singer', duration: 186 });
  assert.equal(rows[0].id, 1); assert.equal(rows[0].exact, true); assert.equal(rows[1].exact, false); assert.equal(rows[2].exact, false);
});
test('Whisper offsets are milliseconds, with invalid segments rejected', () => {
  assert.deepEqual(parseWhisper({ transcription: [{ text: ' Hello ', offsets: { from: 1230, to: 3400 } }, { text: 'bad' }] }), [{ text: 'Hello', start: 1.23, end: 3.4 }]);
});
test('cross-check preserves database wording, even when transcript disagrees', () => {
  const result = reconcile({ syncedLyrics: '[00:01]Bring the sunshine home\n[00:05]Let us sing', plainLyrics: '' }, [{ text: 'Bring the sunrise home', start: 1, end: 4 }, { text: 'Let us sing', start: 5, end: 8 }], 10);
  assert.equal(result.lines[0].text, 'Bring the sunshine home'); assert.equal(result.lines[0].start, 1); assert.equal(result.lines[0].review, true);
  assert.equal(result.lines[1].review, false); assert.ok(result.agreement < 1); assert.equal(result.source, 'database');
});
test('plain lyrics get monotonic approximate timing; unmatched lines stay untimed', () => {
  const result = reconcile({ syncedLyrics: '', plainLyrics: 'Sing with me\nUnmatched mystery\nSing with me' }, [{ text: 'Sing with me', start: 2, end: 4 }, { text: 'Sing with me', start: 8, end: 10 }], 12);
  assert.deepEqual(result.lines.map(row => row.start), [2, null, 8]); assert.ok(result.lines.every(row => row.review));
});
test('database lyrics survive a failed transcription without invented confidence', () => {
  const result = reconcile({ syncedLyrics: '[00:01]Sing with me', plainLyrics: 'Sing with me' }, [], 10);
  assert.equal(result.lines[0].text, 'Sing with me'); assert.equal(result.agreement, null); assert.equal(result.lines[0].review, true);
});
test('transcript fallback is explicitly unverified', () => {
  const result = reconcile(null, [{ text: 'Local words', start: 3, end: 5 }], 10);
  assert.equal(result.source, 'transcript'); assert.equal(result.lines[0].review, true); assert.equal(result.agreement, null);
});
test('timing drift is flagged even when every word agrees', () => {
  const result = reconcile({ syncedLyrics: '[00:01]Sing with me', plainLyrics: '' }, [{ text: 'Sing with me', start: 10, end: 12 }], 15);
  assert.equal(result.agreement, 1); assert.equal(result.lines[0].review, true);
});
