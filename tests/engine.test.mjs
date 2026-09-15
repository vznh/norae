import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { QueueEngine } from '../electron/engine.mjs';

const input = { url: 'https://youtu.be/abcdefghijk', singer: 'Alex' };
const lyrics = { id: 1, title: 'Home', artist: 'Singer', syncedLyrics: '[00:01]Bring the sunshine home', plainLyrics: 'Bring the sunshine home' };
function services(overrides = {}) { return {
  inspect: async () => ({ title: 'Home', artist: 'Singer', duration: 10 }),
  extract: async (_url, directory) => { const file = path.join(directory, 'audio.mp3'); await writeFile(file, 'audio'); return file; },
  fetchLyrics: async () => ({ candidates: [lyrics], selected: lyrics }),
  transcribe: async () => [{ text: 'Bring the sunshine home', start: 1, end: 5 }], ...overrides,
}; }
async function create(overrides = {}) { const root = await mkdtemp(path.join(os.tmpdir(), 'norae-test-')); return new QueueEngine({ root, settings: {}, services: services(overrides) }); }
async function finish(engine) { while (engine.jobs.size) await Promise.all([...engine.jobs.values()].map(job => job.promise)); }

test('lyrics and transcription begin independently and one failure cannot cancel the other', async t => {
  let releaseLyrics, transcriptionStarted = false;
  const gate = new Promise(resolve => { releaseLyrics = resolve; });
  const engine = await create({ fetchLyrics: async () => { await gate; throw new Error('offline'); }, transcribe: async () => { transcriptionStarted = true; releaseLyrics(); return [{ text: 'Independent words', start: 1, end: 4 }]; } });
  t.after(() => engine.close()); engine.add(input); await finish(engine);
  const [track] = engine.snapshot(); assert.equal(transcriptionStarted, true); assert.equal(track.steps.lyrics.state, 'error'); assert.equal(track.steps.transcript.state, 'done'); assert.equal(track.result.source, 'transcript'); assert.equal(track.status, 'review'); assert.ok(track.audioUrl);
});
test('database remains primary when local transcription fails', async t => {
  const engine = await create({ transcribe: async () => { throw new Error('missing model'); } }); t.after(() => engine.close());
  engine.add(input); await finish(engine); const [track] = engine.snapshot();
  assert.equal(track.result.source, 'database'); assert.equal(track.result.lines[0].text, lyrics.plainLyrics); assert.equal(track.steps.transcript.state, 'error'); assert.equal(track.status, 'review');
});
test('ambiguous recording requires explicit selection; transcript cannot decide it', async t => {
  const engine = await create({ fetchLyrics: async () => ({ candidates: [lyrics], selected: null }) }); t.after(() => engine.close());
  const id = engine.add(input); await finish(engine); assert.equal(engine.snapshot()[0].result.source, 'transcript');
  engine.selectLyrics(id, 1); assert.equal(engine.snapshot()[0].result.source, 'database'); assert.equal(engine.snapshot()[0].status, 'ready');
});
test('one track processes at a time and queue order is respected', async t => {
  const starts = []; let release; const gate = new Promise(resolve => { release = resolve; });
  const engine = await create({ inspect: async (_url, _settings, _signal, overrides) => { starts.push(overrides.singer); if (starts.length === 1) await gate; return { title: 'Home', artist: 'Singer', duration: 10 }; } }); t.after(() => engine.close());
  engine.add({ ...input, singer: 'First' }); engine.add({ ...input, singer: 'Second' }); const last = engine.add({ ...input, singer: 'Third' }); engine.move(last, -1);
  assert.deepEqual(starts, ['First']); release(); await finish(engine); assert.deepEqual(starts, ['First', 'Third', 'Second']);
});
test('remove cancels running work and deletes temporary files', async t => {
  let began; const started = new Promise(resolve => { began = resolve; });
  const engine = await create({ transcribe: async (_audio, _directory, _settings, signal) => { began(); await new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })); } }); t.after(() => engine.close());
  const id = engine.add(input); await started; const directory = engine.tracks[0].directory;
  await engine.remove(id); assert.equal(engine.snapshot().length, 0); assert.equal(engine.jobs.size, 0); await assert.rejects(access(directory));
});
test('retry recovers a failed track and clears prior errors', async t => {
  let fail = true;
  const engine = await create({ inspect: async () => { if (fail) throw new Error('temporary network failure'); return { title: 'Home', artist: 'Singer', duration: 10 }; } }); t.after(() => engine.close());
  const id = engine.add(input); await finish(engine); assert.equal(engine.snapshot()[0].status, 'error');
  fail = false; await engine.retry(id); await finish(engine); assert.equal(engine.snapshot()[0].status, 'ready'); assert.equal(engine.snapshot()[0].error, '');
});
test('snapshot never exposes filesystem audio paths, and close deletes all session data', async () => {
  const engine = await create(); engine.add(input); await finish(engine);
  assert.equal('audioPath' in engine.snapshot()[0], false); assert.equal('directory' in engine.snapshot()[0], false);
  await engine.close(); await assert.rejects(access(engine.root));
});

test('database lyrics become available while independent transcription is still running', async t => {
  let releaseTranscript, lyricsFound;
  const gate = new Promise(resolve => { releaseTranscript = resolve; });
  const found = new Promise(resolve => { lyricsFound = resolve; });
  const engine = await create({ fetchLyrics: async () => ({ candidates: [lyrics], selected: lyrics }), transcribe: async () => { await gate; return [{ text: 'Bring the sunshine home', start: 1, end: 5 }]; } });
  t.after(() => engine.close());
  engine.on('change', tracks => { if (tracks[0]?.result?.source === 'database') lyricsFound(); });
  const id = engine.add(input); await found;
  assert.equal(engine.snapshot()[0].status, 'processing');
  assert.equal(engine.snapshot()[0].result.lines[0].text, lyrics.plainLyrics);
  engine.selectLyrics(id, 1); assert.equal(engine.snapshot()[0].status, 'processing');
  releaseTranscript(); await finish(engine); assert.equal(engine.snapshot()[0].status, 'ready');
});
