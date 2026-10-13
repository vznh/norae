import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { QueueStore } from '../electron/queue-store.mjs';
test('queue records save in order without settings or private audio paths', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'norae-store-')); t.after(() => rm(root, { recursive: true, force: true }));
  const store = new QueueStore({ file: path.join(root, 'queue.json'), audioRoot: path.join(root, 'audio') });
  const track = { id: '00000000-0000-4000-8000-000000000001', url: 'https://youtu.be/abcdefghijk', title: 'Home', artist: 'Singer', singer: 'You', duration: 10, status: 'review', steps: {}, candidates: [], transcript: [], result: { lines: [] }, settings: { key: 'private' } };
  await store.save([track]); const saved = await readFile(path.join(root, 'queue.json'), 'utf8');
  assert.equal(saved.includes('private'), false); assert.equal(saved.includes('audioRoot'), false);
  assert.deepEqual(await store.load(), [{ ...Object.fromEntries(Object.entries(track).filter(([key]) => key !== 'settings')), directory: path.join(root, 'audio', track.id), audioPath: null, audioUrl: null }]);
});
