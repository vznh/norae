import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchLyrics } from '../electron/lrclib.mjs';
const track = { title: 'Home', artist: 'Singer', duration: 10 };
const success = () => Response.json([{ id: 1, trackName: 'Home', artistName: 'Singer', duration: 10, plainLyrics: 'Fixture lyric' }]);
test('LRCLIB selects an exact recording without requiring credentials', async () => {
  let calls = 0;
  const result = await fetchLyrics(track, undefined, {}, { request: async (url, options) => { calls++; assert.match(url, /lrclib\.net\/api\/search/); assert.ok(options.signal); return success(); } });
  assert.equal(calls, 1); assert.equal(result.selected.id, 1);
});
test('provider errors leave the independent transcript available', async () => {
  await assert.rejects(fetchLyrics(track, undefined, {}, { request: async () => new Response('', { status: 503 }) }), /Transcription continues independently/);
});
