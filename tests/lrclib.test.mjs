import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchLyrics } from '../electron/lrclib.mjs';
const track = { title: 'Home', artist: 'Singer', duration: 10 };
test('transient LRCLIB failures get two bounded retries', async () => {
  const delays = []; let calls = 0;
  const result = await fetchLyrics(track, undefined, {}, {
    request: async () => ++calls < 3 ? new Response('', { status: 503 }) : Response.json([{ id: 1, trackName: 'Home', artistName: 'Singer', duration: 10, plainLyrics: 'Fixture lyric' }]),
    wait: async delay => delays.push(delay),
  });
  assert.equal(calls, 3); assert.deepEqual(delays, [1000, 2000]); assert.equal(result.selected.id, 1);
});
test('retry delay over one minute leaves a manual retry available', async () => {
  await assert.rejects(fetchLyrics(track, undefined, {}, { request: async () => new Response('', { status: 503, headers: { 'retry-after': '120' } }), wait: async () => {} }), /longer wait/);
});
