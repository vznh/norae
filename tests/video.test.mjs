import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, access, readdir, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { exportVideo, saveTimingProject } from '../electron/video.mjs';
import { writeDemo } from '../electron/demo.mjs';

test('cancelled rendering preserves an existing destination and removes the temporary render', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'norae-video-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const audioPath = path.join(directory, 'demo.wav'); await writeDemo(audioPath);
  const output = path.join(directory, 'existing.mp4'); await writeFile(output, 'existing export');
  const controller = new AbortController();
  const track = { directory, audioPath, duration: 2, font: 'Arial', result: { lines: [{ text: 'Original', start: .1, end: 1, words: [{ text: 'Original', start: .1, end: 1 }] }] } };
  await assert.rejects(exportVideo(track, output, { ffmpeg: 'ffmpeg' }, controller.signal, progress => { if (progress > 0) controller.abort(); }, { width: 320, height: 180, fps: 10 }), /abort/i);
  assert.equal(await readFile(output, 'utf8'), 'existing export');
  await assert.rejects(access(path.join(directory, 'render.mp4')));
  assert.equal((await readdir(directory)).some(file => file.startsWith('.norae-export-')), false);
});
test('a failed destination commit preserves existing files and clears staged output', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'norae-video-commit-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const audioPath = path.join(directory, 'demo.wav'); await writeDemo(audioPath);
  const output = path.join(directory, 'existing.mp4');
  await mkdir(output); await writeFile(path.join(output, 'keep.txt'), 'keep this');
  const track = { directory, audioPath, duration: .5, font: 'Arial', result: { lines: [{ text: 'Original', words: [{ text: 'Original', start: .1, end: .4 }] }] } };
  await assert.rejects(exportVideo(track, output, { ffmpeg: 'ffmpeg' }, new AbortController().signal, () => {}, { width: 320, height: 180, fps: 10 }));
  assert.equal(await readFile(path.join(output, 'keep.txt'), 'utf8'), 'keep this');
  assert.equal((await readdir(directory)).some(file => file.startsWith('.norae-export-') || file === 'render.mp4'), false);
});
test('timing project persists reviewer units and recording identity without private paths', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'norae-project-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'project.json');
  const track = { url: 'https://www.youtube.com/watch?v=abcdefghijk', title: 'Original fixture', artist: 'Fixture singer', duration: 10, font: 'Arial', audioPath: '/private/path', directory: '/private/directory', lyrics: { copyright: 'Fixture copyright' }, result: { source: 'database', lines: [{ text: 'away', words: [{ text: 'a', start: 1, end: 1.2 }, { text: 'way', start: 1.2, end: 4 }] }] } };
  await saveTimingProject(track, file); const saved = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(saved.version, 1); assert.equal(saved.url, track.url); assert.equal(saved.lines[0].words[1].end, 4); assert.equal(saved.copyright, 'Fixture copyright');
  assert.equal('audioPath' in saved, false); assert.equal('directory' in saved, false);
});
