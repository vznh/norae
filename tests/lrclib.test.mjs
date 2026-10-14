import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { fetchLyrics } from '../electron/providers.mjs';

const track = { title: 'Home', artist: 'Singer', duration: 10 };
const success = () => Response.json([{ id: 1, trackName: 'Home', artistName: 'Singer', duration: 10, plainLyrics: 'Fixture lyric' }]);
const wait = async () => {};

test('LRCLIB retries twice with identical metadata, fresh request signals and bounded backoff', async () => {
  const requests = [], delays = [];
  const result = await fetchLyrics(track, undefined, {}, {
    request: async (url, options) => { requests.push({ url, signal: options.signal }); return requests.length < 3 ? new Response('', { status: 503 }) : success(); },
    wait: async delay => { delays.push(delay); },
  });
  assert.equal(result.selected.id, 1); assert.equal(requests.length, 3);
  assert.equal(new Set(requests.map(request => request.url)).size, 1);
  assert.equal(new Set(requests.map(request => request.signal)).size, 3);
  assert.deepEqual(delays, [1000, 2000]);
});
test('persistent transient failures stop after the third request', async () => {
  for (const status of [408, 429, 500, 502, 503, 504]) {
    let calls = 0;
    await assert.rejects(fetchLyrics(track, undefined, {}, { request: async () => { calls++; return new Response('', { status }); }, wait }), /Transcription continues independently/);
    assert.equal(calls, 3);
  }
});
test('network failures and request timeouts can recover, but never exceed two retries', async () => {
  let calls = 0;
  const result = await fetchLyrics(track, undefined, {}, {
    request: async () => { calls++; if (calls === 1) throw new TypeError('fetch failed'); if (calls === 2) throw new DOMException('timeout', 'TimeoutError'); return success(); }, wait,
  });
  assert.equal(calls, 3); assert.equal(result.selected.id, 1);
});
test('Retry-After supports seconds and HTTP dates without retrying early', async () => {
  const now = Date.parse('2026-10-14T12:00:00Z');
  for (const [header, expected] of [['4', 4000], ['Wed, 14 Oct 2026 12:00:08 GMT', 8000]]) {
    let calls = 0; const delays = [];
    await fetchLyrics(track, undefined, {}, { request: async () => ++calls === 1 ? new Response('', { status: 503, headers: { 'Retry-After': header } }) : success(), wait: async delay => { delays.push(delay); }, now: () => now });
    assert.deepEqual(delays, [expected]);
  }
  let calls = 0;
  await assert.rejects(fetchLyrics(track, undefined, {}, { request: async () => { calls++; return new Response('', { status: 429, headers: { 'Retry-After': '120' } }); }, wait }), /Try Retry lyrics later/);
  assert.equal(calls, 1);
});
test('permanent errors, empty results and malformed payloads never retry', async () => {
  const responses = [400, 401, 403, 404, 422, 501].map(status => () => new Response('', { status }));
  responses.push(() => new Response('{broken'), () => Response.json({ invalid: true }), () => Response.json([{ id: 1, trackName: null, artistName: 'Singer', plainLyrics: 'Fixture' }]));
  for (const response of responses) {
    let calls = 0;
    await assert.rejects(fetchLyrics(track, undefined, {}, { request: async () => { calls++; return response(); }, wait }));
    assert.equal(calls, 1);
  }
  let calls = 0;
  assert.deepEqual(await fetchLyrics(track, undefined, {}, { request: async () => { calls++; return Response.json([]); }, wait }), { candidates: [], selected: null });
  assert.equal(calls, 1);
});
test('cancellation interrupts retry backoff and prevents any further HTTP request', async () => {
  const controller = new AbortController(); let calls = 0, started;
  const waiting = new Promise(resolve => { started = resolve; });
  const lookup = fetchLyrics(track, controller.signal, {}, {
    request: async () => { calls++; return new Response('', { status: 503 }); },
    wait: async (delay, signal) => { started(); await sleep(delay, undefined, { signal }); },
  });
  const rejected = assert.rejects(lookup, { name: 'AbortError' });
  await waiting; controller.abort(); await rejected;
  assert.equal(calls, 1);
  await assert.rejects(fetchLyrics(track, controller.signal, {}, { request: async () => { calls++; return success(); }, wait }), { name: 'AbortError' });
  assert.equal(calls, 1);
});
