import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { transcribeElevenLabs, alignElevenLabs } from '../electron/cloud.mjs';
import { fetchLyrics, defaultSettings } from '../electron/providers.mjs';

async function setup(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'norae-cloud-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const credentialsFile = path.join(root, '.env'); await writeFile(credentialsFile, 'ELEVENLABS_API_KEY=test-eleven\n');
  const audio = path.join(root, 'audio.mp3'); await writeFile(audio, 'fixture');
  return { settings: { credentialsFile }, audio };
}
const response = body => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
test('Scribe v2 uses English and no lyric prompt; forced alignment is a separate request', async t => {
  const { settings, audio } = await setup(t); const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => { requests.push({ url, form: options.body }); return response(url.endsWith('forced-alignment') ? { words: [{ text: 'Hello', start: 1, end: 2 }] } : { words: [{ type: 'word', text: 'Hello', start: 1, end: 2 }, { type: 'spacing', text: ' ', start: 2, end: 2 }] }); });
  const words = await transcribeElevenLabs(audio, settings); await alignElevenLabs(audio, 'Hello', settings);
  assert.equal(words.length, 1); assert.equal(requests[0].form.get('model_id'), 'scribe_v2'); assert.equal(requests[0].form.get('language_code'), 'eng');
  assert.equal(requests[0].form.has('text'), false); assert.equal(requests[0].form.has('transcript_edit'), false); assert.equal(requests[1].form.get('text'), 'Hello');
});
test('lyrics lookup is keyless LRCLIB even with an obsolete saved provider', async t => {
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const request = new URL(url); assert.equal(request.hostname, 'lrclib.net'); assert.equal(request.searchParams.has('apikey'), false); assert.equal('xi-api-key' in options.headers, false);
    return response([{ id: 1, trackName: 'Home', artistName: 'Singer', duration: 10, plainLyrics: 'Original fixture lyric', syncedLyrics: '' }]);
  });
  const result = await fetchLyrics({ title: 'Home', artist: 'Singer', duration: 10 }, new AbortController().signal, { lyricsProvider: 'obsolete' });
  assert.equal(defaultSettings.lyricsProvider, 'lrclib'); assert.equal(result.selected.id, 1);
});
test('LRCLIB provider errors preserve independent transcription', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('', { status: 503 }));
  await assert.rejects(fetchLyrics({ title: 'Home', artist: 'Singer', duration: 10 }, new AbortController().signal, undefined, { wait: async () => {} }), /Transcription continues independently/);
});
test('provider errors redact key-bearing request URLs', async t => {
  const { settings, audio } = await setup(t);
  t.mock.method(globalThis, 'fetch', async url => { throw new Error(`failure ${url}`); });
  await assert.rejects(transcribeElevenLabs(audio, settings), error => { assert.equal(error.message.includes('https:'), false); assert.match(error.message, /could not be reached/); return true; });
});
