import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { QueueEngine } from '../electron/engine.mjs';
import { fetchLyrics } from '../electron/lrclib.mjs';

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

test('title enrichment runs before lyric lookup without changing the artist or audio/transcription pipeline', async t => {
  let searched;
  const engine = await create({
    inspect: async () => ({ title: 'Singer - Home', artist: 'Singer', duration: 10 }),
    enrich: async track => { assert.equal(track.title, 'Singer - Home'); return { title: 'Home' }; },
    fetchLyrics: async track => { searched = { title: track.title, artist: track.artist }; return { candidates: [lyrics], selected: lyrics }; },
  });
  t.after(() => engine.close()); engine.add(input); await finish(engine);
  assert.deepEqual(searched, { title: 'Home', artist: 'Singer' });
  assert.equal(engine.snapshot()[0].steps.transcript.state, 'done');
});

test('SoundCloud links use the existing audio, lyrics and transcription pipeline', async t => {
  const inspected = [], extracted = [];
  const engine = await create({ inspect: async url => { inspected.push(url); return { title: 'Home', artist: 'Singer', duration: 10 }; }, extract: async (url, directory) => { extracted.push(url); const file = path.join(directory, 'audio.mp3'); await writeFile(file, 'audio'); return file; } });
  t.after(() => engine.close());
  const id = engine.add({ url: 'https://www.soundcloud.com/singer/home?utm_source=clipboard' });
  await finish(engine);
  assert.deepEqual(inspected, ['https://soundcloud.com/singer/home']); assert.deepEqual(extracted, inspected);
  const track = engine.snapshot().find(track => track.id === id);
  assert.equal(track.steps.transcript.state, 'done'); assert.equal(track.steps.lyrics.state, 'done'); assert.equal(track.result.source, 'database'); assert.ok(track.audioUrl);
});

test('automatic LRCLIB retries leave independent transcription and audio extraction at one call', async t => {
  const base = services(); let requests = 0, downloads = 0, transcripts = 0;
  const engine = await create({
    extract: async (...args) => { downloads++; return base.extract(...args); },
    transcribe: async (...args) => { transcripts++; return base.transcribe(...args); },
    fetchLyrics: (track, signal) => fetchLyrics(track, signal, {}, {
      request: async () => ++requests < 3 ? new Response('', { status: 503 }) : Response.json([{ id: 1, trackName: 'Home', artistName: 'Singer', duration: 10, plainLyrics: lyrics.plainLyrics, syncedLyrics: lyrics.syncedLyrics }]),
      wait: async () => { assert.equal(transcripts, 1); },
    }),
  });
  t.after(() => engine.close()); engine.add(input); await finish(engine);
  assert.deepEqual({ requests, downloads, transcripts }, { requests: 3, downloads: 1, transcripts: 1 });
  assert.equal(engine.snapshot()[0].steps.lyrics.state, 'done');
});

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
test('reorder moves tracks to absolute queue positions and ignores unchanged or unknown tracks', async t => {
  const engine = await create(); t.after(() => engine.close());
  const first = engine.add(input), second = engine.add(input), third = engine.add(input);
  await finish(engine);
  let changes = 0; engine.on('change', () => changes++);
  engine.reorder(third, 0); assert.deepEqual(engine.tracks.map(track => track.id), [third, first, second]);
  engine.reorder(third, 2); assert.deepEqual(engine.tracks.map(track => track.id), [first, second, third]);
  const beforeNoop = changes; engine.reorder(second, 1); engine.reorder('missing', 0);
  assert.equal(changes, beforeNoop);
  assert.throws(() => engine.reorder(first, 1.5), /Invalid queue position/);
  assert.throws(() => engine.reorder(first, NaN), /Invalid queue position/);
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

test('forced alignment waits for independent branches and manual correction survives export validation', async t => {
  const order = [];
  const engine = await create({
    fetchLyrics: async () => { order.push('lyrics'); return { candidates: [lyrics], selected: lyrics }; },
    transcribe: async () => { order.push('transcript'); return [{ text: 'Bring the sunshine home', start: 1, end: 5 }]; },
    align: async (_audio, text) => { assert.ok(order.includes('lyrics') && order.includes('transcript')); assert.equal(text, lyrics.plainLyrics); order.push('alignment'); return { words: [{ text: 'Bring', start: 1, end: 2 }, { text: 'the', start: 2, end: 2.5 }, { text: 'sunshine', start: 2.5, end: 4 }, { text: 'home', start: 4, end: 5 }] }; },
  });
  t.after(() => engine.close()); const id = engine.add(input); await finish(engine);
  assert.equal(order.at(-1), 'alignment'); assert.equal(engine.snapshot()[0].steps.alignment.state, 'done');
  const lines = engine.snapshot()[0].result.lines; lines[0].words[0].start = 1.1;
  engine.saveTiming(id, { lines, font: 'Arial', reviewed: true });
  assert.equal(engine.snapshot()[0].result.lines[0].start, 1.1); assert.equal(engine.snapshot()[0].reviewed, true);
  assert.equal(engine.snapshot()[0].result.timing, 'manual');
});
test('failed alignment preserves independent evidence and leaves manual review available', async t => {
  const engine = await create({ align: async () => { throw new Error('alignment quota'); } });
  t.after(() => engine.close()); engine.add(input); await finish(engine);
  const track = engine.snapshot()[0];
  assert.equal(track.steps.alignment.state, 'error'); assert.equal(track.result.lines[0].text, lyrics.plainLyrics);
  assert.equal(track.transcript.length, 1); assert.equal(track.status, 'review'); assert.ok(track.audioUrl);
});

test('reflowing unverified transcript timing never promotes its wording to verified lyrics', async t => {
  const engine = await create({ fetchLyrics: async () => ({ candidates: [], selected: null }), transcribe: async () => [{ text: 'We', start: 1, end: 1.2 }, { text: 'sing', start: 1.3, end: 2 }] });
  t.after(() => engine.close()); const id = engine.add(input); await finish(engine);
  const lines = engine.snapshot()[0].result.lines;
  assert.equal(lines[0].text, 'We sing');
  engine.saveTiming(id, { lines, font: 'Arial', reviewed: false });
  const track = engine.snapshot()[0]; assert.equal(track.result.source, 'transcript'); assert.equal(track.status, 'review'); assert.match(track.result.notes[0], /remain unverified/);
});

test('lyrics-only retry refreshes candidates without repeating paid work or replacing manual timing', async t => {
  const calls = { inspect: 0, extract: 0, transcript: 0, alignment: 0, lyrics: 0 };
  const base = services();
  const engine = await create({
    inspect: async (...args) => { calls.inspect++; return base.inspect(...args); },
    extract: async (...args) => { calls.extract++; return base.extract(...args); },
    transcribe: async (...args) => { calls.transcript++; return base.transcribe(...args); },
    align: async () => { calls.alignment++; throw new Error('Unexpected paid alignment'); },
    fetchLyrics: async () => { if (++calls.lyrics === 1) throw new Error('LRCLIB returned 503'); return { candidates: [lyrics], selected: lyrics }; },
  });
  t.after(() => engine.close()); const id = engine.add(input); await finish(engine);
  engine.saveTiming(id, { lines: engine.snapshot()[0].result.lines, font: 'Verdana', reviewed: true });
  const before = engine.snapshot()[0], audioPath = engine.tracks[0].audioPath;
  await engine.retryLyrics(id);
  const after = engine.snapshot()[0];
  assert.deepEqual(calls, { inspect: 1, extract: 1, transcript: 1, alignment: 0, lyrics: 2 });
  assert.deepEqual(after.candidates, [lyrics]); assert.equal(after.steps.lyrics.state, 'review');
  for (const field of ['result', 'transcript', 'lyrics', 'audioUrl', 'font', 'reviewed', 'status']) assert.deepEqual(after[field], before[field]);
  assert.equal(engine.tracks[0].audioPath, audioPath);
});
test('a failed lyrics retry remains retryable and never loses the fallback', async t => {
  let calls = 0;
  const engine = await create({ fetchLyrics: async () => { if (++calls < 3) throw new Error('LRCLIB returned 503'); return { candidates: [], selected: null }; } });
  t.after(() => engine.close()); const id = engine.add(input); await finish(engine);
  const result = engine.snapshot()[0].result;
  await assert.rejects(engine.retryLyrics(id), /503/);
  assert.equal(engine.snapshot()[0].steps.lyrics.state, 'error'); assert.equal(engine.lyricsRetries.size, 0);
  await engine.retryLyrics(id);
  assert.equal(engine.snapshot()[0].steps.lyrics.state, 'review'); assert.equal(engine.snapshot()[0].candidates.length, 0);
  assert.deepEqual(engine.snapshot()[0].result, result);
});
test('lyrics can be retried while independent transcription is still running; duplicate clicks share one search', async t => {
  let releaseTranscript, releaseRetry, foundError;
  const transcriptGate = new Promise(resolve => { releaseTranscript = resolve; });
  const retryGate = new Promise(resolve => { releaseRetry = resolve; });
  const failed = new Promise(resolve => { foundError = resolve; });
  let calls = 0;
  const engine = await create({
    fetchLyrics: async () => { if (++calls === 1) throw new Error('503'); await retryGate; return { candidates: [lyrics], selected: lyrics }; },
    transcribe: async () => { await transcriptGate; return [{ text: 'Bring the sunshine home', start: 1, end: 5 }]; },
  });
  t.after(() => engine.close()); engine.on('change', tracks => { if (tracks[0]?.steps.lyrics.state === 'error') foundError(); });
  const id = engine.add(input); await failed;
  const retry = engine.retryLyrics(id), duplicate = engine.retryLyrics(id);
  assert.equal(engine.snapshot()[0].steps.lyrics.state, 'running');
  releaseRetry(); await Promise.all([retry, duplicate]); assert.equal(calls, 2);
  assert.equal(engine.snapshot()[0].steps.transcript.state, 'running');
  releaseTranscript(); await finish(engine);
  assert.deepEqual(engine.snapshot()[0].candidates, [lyrics]); assert.equal(engine.snapshot()[0].lyrics, null);
  engine.selectLyrics(id, lyrics.id); assert.equal(engine.snapshot()[0].result.source, 'database');
});
test('removing a track aborts its lyrics retry and cannot resurrect it', async t => {
  let calls = 0, began;
  const started = new Promise(resolve => { began = resolve; });
  const engine = await create({ fetchLyrics: async (_track, signal) => {
    if (++calls === 1) throw new Error('503');
    began(); await new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('Cancelled')), { once: true }));
  } });
  t.after(() => engine.close()); const id = engine.add(input); await finish(engine);
  const retry = engine.retryLyrics(id); const rejected = assert.rejects(retry, /Cancelled/);
  await started; await assert.rejects(engine.retry(id), /lyrics search/);
  await engine.remove(id); await rejected;
  assert.equal(engine.lyricsRetries.size, 0); assert.deepEqual(engine.snapshot(), []);
});

test('full retry retains actual transcript word timing when LRCLIB recovers but alignment fails', async t => {
  let attempts = 0;
  const transcript = [{ text: 'Bring', start: 1, end: 1.5 }, { text: 'the', start: 1.6, end: 2 }, { text: 'sunshine', start: 2.1, end: 4 }, { text: 'home', start: 4.1, end: 5 }];
  const engine = await create({
    fetchLyrics: async () => { if (++attempts === 1) throw new Error('LRCLIB 503'); return { candidates: [lyrics], selected: lyrics }; },
    transcribe: async () => transcript,
    align: async () => { throw new Error('Alignment unavailable'); },
  });
  t.after(() => engine.close()); const id = engine.add(input); await finish(engine);
  assert.equal(engine.snapshot()[0].result.source, 'transcript');
  await engine.retry(id); await finish(engine);
  const track = engine.snapshot()[0];
  assert.equal(track.steps.lyrics.state, 'done'); assert.equal(track.steps.alignment.state, 'error');
  assert.equal(track.result.source, 'database'); assert.equal(track.result.lines[0].timing, 'transcript');
  assert.deepEqual(track.result.lines[0].words.map(({ start, end }) => ({ start, end })), transcript.map(({ start, end }) => ({ start, end })));
  assert.equal(track.result.lines[0].review, true); assert.equal(track.status, 'review');
});

test('partial forced alignment is reviewable and retains valid reading timing instead of rejecting the song', async t => {
  const engine = await create({ align: async () => ({ words: [{ text: 'Bring', start: 1, end: 1.5 }, { text: 'wrong', start: 1.6, end: 2 }, { text: 'sunshine', start: 2.1, end: 4 }, { text: 'home', start: 4.1, end: 5 }] }) });
  t.after(() => engine.close()); engine.add(input); await finish(engine);
  const track = engine.snapshot()[0];
  assert.equal(track.steps.alignment.state, 'review'); assert.equal(track.result.timing, 'partial');
  assert.deepEqual(track.result.lines[0].words.map(word => word.start), [1, null, 2.1, 4.1]);
  assert.equal(track.status, 'review'); assert.match(track.steps.alignment.message, /3 of 4/);
});
