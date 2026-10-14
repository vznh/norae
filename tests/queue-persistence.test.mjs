import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { QueueEngine } from '../electron/engine.mjs';
import { QueueStore } from '../electron/queue-store.mjs';

const input = { url: 'https://youtu.be/abcdefghijk' };
const lyrics = { id: 1, title: 'Home', artist: 'Original fixture', plainLyrics: 'Bring it home', syncedLyrics: '[00:01]Bring it home' };
async function fixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'norae-persistence-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const calls = { downloads: 0, lyrics: 0, transcripts: 0, alignments: 0 };
  const services = {
    inspect: async () => ({ title: 'Home', artist: 'Original fixture', duration: 10 }),
    extract: async (_url, directory) => { calls.downloads++; const file = path.join(directory, 'audio.mp3'); await writeFile(file, 'original audio fixture'); return file; },
    fetchLyrics: async () => { calls.lyrics++; return { candidates: [lyrics], selected: lyrics }; },
    transcribe: async () => { calls.transcripts++; return [{ text: 'Bring', start: 1, end: 2 }, { text: 'it', start: 2, end: 3 }, { text: 'home', start: 3, end: 5 }]; },
    align: async () => { calls.alignments++; return { words: [{ text: 'Bring', start: 1, end: 2 }, { text: 'it', start: 2, end: 3 }, { text: 'home', start: 3, end: 5 }] }; },
  };
  const options = { root: path.join(directory, 'audio'), persistencePath: path.join(directory, 'queue.json'), settings: { secretFixture: 'never-persist-this-setting' }, services };
  return { options, calls, services };
}
async function finish(engine) { while (engine.jobs.size) await Promise.all([...engine.jobs.values()].map(job => job.promise)); if (engine.store) await engine.store.flush(); }

test('saved title enrichment preserves reviewed timing and audio with no repeat provider requests', async t => {
  const { options, calls } = await fixture(t), engine = await QueueEngine.open(options);
  const id = engine.add(input); await finish(engine);
  engine.saveTiming(id, { lines: engine.tracks[0].result.lines, font: 'Verdana', reviewed: true });
  engine.tracks[0].title = 'Original fixture - Home';
  await engine.close();
  const reopened = await QueueEngine.open(options); t.after(() => reopened.close());
  const before = structuredClone(reopened.tracks[0]); let enriched = 0;
  reopened.services = { ...reopened.services, enrich: async track => {
    enriched++; return { title: 'Home', originalMetadata: { title: track.title, artist: track.artist }, metadataEnrichment: { version: 1, source: 'apple-intelligence', status: 'enriched' } };
  } };
  await reopened.enrichSavedMetadata(); await reopened.enrichSavedMetadata();
  assert.equal(enriched, 1); assert.equal(reopened.tracks[0].title, 'Home');
  for (const field of ['artist', 'audioPath', 'result', 'transcript', 'reviewed', 'font', 'status', 'lyrics']) assert.deepEqual(reopened.tracks[0][field], before[field]);
  await reopened.close();
  const restored = await QueueEngine.open(options); t.after(() => restored.close());
  assert.equal(restored.tracks[0].metadataEnrichment.source, 'apple-intelligence');
  assert.equal(restored.tracks[0].originalMetadata.title, 'Original fixture - Home');
  assert.deepEqual(calls, { downloads: 1, lyrics: 1, transcripts: 1, alignments: 1 });
});

test('relaunch restores audio, lyrics, transcript, font and reviewer timing with zero provider calls', async t => {
  const { options, calls } = await fixture(t), engine = await QueueEngine.open(options);
  const id = engine.add(input); await finish(engine);
  const lines = engine.snapshot()[0].result.lines; lines[0].words[0].start = 1.1;
  engine.saveTiming(id, { lines, font: 'Verdana', reviewed: true });
  const before = engine.snapshot(), audioPath = engine.tracks[0].audioPath;
  await engine.close(); await access(audioPath);
  const saved = await readFile(options.persistencePath, 'utf8');
  assert.equal(saved.includes(options.root), false); assert.equal(saved.includes('never-persist-this-setting'), false);
  const after = await QueueEngine.open(options); t.after(() => after.close());
  assert.deepEqual(after.snapshot(), before); assert.equal(after.tracks[0].audioPath, audioPath);
  assert.deepEqual(calls, { downloads: 1, lyrics: 1, transcripts: 1, alignments: 1 });
});
test('queue order survives and explicit removal deletes only the selected song', async t => {
  const { options, calls } = await fixture(t), engine = await QueueEngine.open(options);
  const first = engine.add(input), second = engine.add(input); await finish(engine);
  const firstAudio = engine.tracks[0].audioPath, secondAudio = engine.tracks[1].audioPath;
  engine.move(second, -1); await engine.close();
  const reopened = await QueueEngine.open(options);
  assert.deepEqual(reopened.snapshot().map(track => track.id), [second, first]);
  await reopened.remove(first); await assert.rejects(access(firstAudio)); await access(secondAudio);
  await reopened.close();
  const final = await QueueEngine.open(options); t.after(() => final.close());
  assert.deepEqual(final.snapshot().map(track => track.id), [second]);
  assert.deepEqual(calls, { downloads: 2, lyrics: 2, transcripts: 2, alignments: 2 });
});
test('interrupted transcription keeps downloaded audio and completed lyrics without automatically retrying', async t => {
  const { options, calls, services } = await fixture(t);
  let began; const started = new Promise(resolve => { began = resolve; });
  services.transcribe = async (_audio, _directory, _settings, signal) => { calls.transcripts++; began(); await new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('Cancelled.')), { once: true })); };
  const engine = await QueueEngine.open(options); engine.add(input); await started;
  const audio = engine.tracks[0].audioPath;
  await engine.close(); await access(audio);
  const reopened = await QueueEngine.open(options); t.after(() => reopened.close());
  const [track] = reopened.snapshot();
  assert.ok(track.audioUrl); assert.equal(track.steps.lyrics.state, 'done'); assert.equal(track.steps.transcript.state, 'error');
  assert.match(track.error, /no API requests were restarted/);
  assert.equal(reopened.jobs.size, 0); assert.equal(calls.transcripts, 1); assert.equal(calls.downloads, 1);
});
test('missing cached media retains the timing and never silently downloads or transcribes again', async t => {
  const { options, calls } = await fixture(t), engine = await QueueEngine.open(options);
  engine.add(input); await finish(engine); const result = engine.snapshot()[0].result, file = engine.tracks[0].audioPath;
  await engine.close(); await rm(file);
  const reopened = await QueueEngine.open(options); t.after(() => reopened.close());
  assert.equal(reopened.snapshot()[0].status, 'error'); assert.match(reopened.snapshot()[0].error, /audio is missing/);
  assert.deepEqual(reopened.snapshot()[0].result, result); assert.equal(calls.transcripts, 1);
});
test('saved audio paths cannot escape the library and malformed queues are left intact', async t => {
  const { options } = await fixture(t), engine = await QueueEngine.open(options);
  engine.add(input); await finish(engine); await engine.close();
  const saved = JSON.parse(await readFile(options.persistencePath, 'utf8')); saved.tracks[0].audioFile = '../../outside.mp3';
  const invalid = JSON.stringify(saved); await writeFile(options.persistencePath, invalid);
  await assert.rejects(QueueEngine.open(options), /Invalid saved track/);
  assert.equal(await readFile(options.persistencePath, 'utf8'), invalid);
});
test('overlapping saves restore the most recent state rather than an older progress update', async t => {
  const { options } = await fixture(t), engine = await QueueEngine.open(options);
  engine.add(input); await finish(engine); await engine.close();
  const store = new QueueStore({ file: options.persistencePath, audioRoot: options.root });
  const records = await store.load();
  const first = store.save(records); records[0].singer = 'Latest reviewer'; const second = store.save(records);
  await Promise.all([first, second]);
  assert.equal((await store.load())[0].singer, 'Latest reviewer');
});
