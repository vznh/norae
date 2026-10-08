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
