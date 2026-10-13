import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, access, symlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { migrateLegacyQueue } from '../scripts/legacy-upgrade.mjs';
import { QueueStore } from '../electron/queue-store.mjs';

async function fixture(t) {
  const userData = await mkdtemp(path.join(os.tmpdir(), 'norae-legacy-upgrade-')); t.after(() => rm(userData, { recursive: true, force: true }));
  const id = randomUUID(), directory = path.join(userData, 'temporary-audio/session-fixture', id), audio = path.join(directory, 'audio.mp3');
  await mkdir(directory, { recursive: true }); await writeFile(audio, 'cached recording');
  const track = { id, url: 'https://youtu.be/abcdefghijk', title: 'Legacy original', artist: 'Fixture', singer: 'You', duration: 10, status: 'review', steps: { audio: { state: 'done' }, lyrics: { state: 'done' }, transcript: { state: 'done' }, alignment: { state: 'done' } }, candidates: [], transcript: [{ text: 'Home', start: 1, end: 3 }], lyrics: { plainLyrics: 'Home' }, result: { lines: [{ text: 'Home', words: [{ text: 'Ho', start: 1, end: 1.5 }, { text: 'me', start: 1.5, end: 3 }] }] }, font: 'Verdana', reviewed: true, audioUrl: `norae-audio://track/${id}`, export: { state: 'idle' } };
  const store = new QueueStore({ file: path.join(userData, 'library/queue.json'), audioRoot: path.join(userData, 'library/audio') });
  return { userData, track, audio, directory, store };
}
test('legacy migration retains IDs, reviewer syllables, transcript, font and audio after the old cache is deleted', async t => {
  const { userData, track, audio, store } = await fixture(t), before = structuredClone(track);
  assert.deepEqual(await migrateLegacyQueue([track], { userData }), { tracks: 1, recordings: 1 });
  assert.deepEqual(track, before); await access(audio);
  await rm(path.join(userData, 'temporary-audio'), { recursive: true });
  const [saved] = await store.load();
  assert.equal(await readFile(saved.audioPath, 'utf8'), 'cached recording');
  assert.equal(saved.id, track.id); assert.equal(saved.font, 'Verdana'); assert.deepEqual(saved.result, track.result); assert.deepEqual(saved.transcript, track.transcript);
});
test('migration refuses active paid work and leaves the existing saved queue intact', async t => {
  const { userData, track, store } = await fixture(t); await store.save([]);
  track.steps.transcript.state = 'running'; await assert.rejects(migrateLegacyQueue([track], { userData }), /Wait/);
  assert.deepEqual(await store.load(), []);
});
test('missing media and symlinked recordings fail before a queue file is committed', async t => {
  const { userData, track, audio, store } = await fixture(t); await rm(audio);
  await assert.rejects(migrateLegacyQueue([track], { userData }), /exactly one/); assert.deepEqual(await store.load(), []);
  const other = path.join(userData, 'other.mp3'); await writeFile(other, 'not an owned recording'); await symlink(other, audio);
  await assert.rejects(migrateLegacyQueue([track], { userData }), /exactly one/); assert.deepEqual(await store.load(), []);
});
test('migration rejects duplicate IDs and does not overwrite a different saved library', async t => {
  const { userData, track, store } = await fixture(t);
  await assert.rejects(migrateLegacyQueue([track, track], { userData }), /Duplicate/);
  await store.save([{ ...track, id: randomUUID(), audioUrl: null }]);
  await assert.rejects(migrateLegacyQueue([track], { userData }), /different saved library/);
  assert.equal((await store.load()).length, 1);
});
