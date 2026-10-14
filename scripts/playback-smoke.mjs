import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { QueueEngine } from '../electron/engine.mjs';
import { run } from '../electron/process.mjs';

const userData = await mkdtemp(path.join(os.tmpdir(), 'norae-playback-desktop-'));
let app, page;
try {
  const root = path.join(userData, 'library/audio');
  const engine = await QueueEngine.open({ root, persistencePath: path.join(userData, 'library/queue.json'), settings: {} });
  await engine.demo();
  const original = engine.tracks[0];
  const id = randomUUID(), directory = path.join(root, id), audioPath = path.join(directory, 'audio.mp3');
  await mkdir(directory);
  await run('ffmpeg', ['-nostdin', '-loglevel', 'error', '-y', '-i', original.audioPath, '-t', '8', '-codec:a', 'libmp3lame', audioPath]);
  // Source metadata can differ from the downloaded recording. The range must
  // update from media events even before the reviewer presses Play.
  engine.tracks.push({ ...structuredClone(original), id, title: 'Short playback fixture', duration: 12, directory, audioPath, audioUrl: `norae-audio://track/${id}` });
  await engine.close();
  const env = { ...process.env, NORAE_TEST_DATA: userData, NORAE_DEV_URL: '' };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ args: ['.'], env });
  page = await app.firstWindow();
  page.setDefaultTimeout(10000);
  await app.evaluate(() => { globalThis.providerCalls = 0; globalThis.fetch = async () => { globalThis.providerCalls++; throw new Error('Playback must not call providers'); }; });
  const partial = await app.evaluate(async ({ net }, url) => {
    const response = await net.fetch(url, { headers: { Range: 'bytes=100-199' } });
    return { status: response.status, headers: Object.fromEntries(response.headers), bytes: (await response.arrayBuffer()).byteLength };
  }, `norae-audio://track/${id}`);
  assert.equal(partial.status, 206); assert.equal(partial.headers['content-length'], '100'); assert.equal(partial.bytes, 100);
  assert.match(partial.headers['content-range'], /^bytes 100-199\/\d+$/);
  const slider = page.getByRole('slider', { name: 'Playback position', exact: true });
  await slider.waitFor();
  await page.waitForFunction(() => document.querySelector('audio').readyState >= 1);
  await page.getByRole('button', { name: 'Select Short playback fixture', exact: true }).click();
  await page.waitForFunction(id => document.querySelector('audio').currentSrc.endsWith(id) && document.querySelector('audio').readyState >= 1, id);
  const duration = await page.locator('audio').evaluate(audio => audio.duration);
  assert.ok(duration >= 8 && duration < 8.2, `Expected the eight-second fixture; got ${duration}`);
  assert.ok(Math.abs(Number(await slider.getAttribute('max')) - duration) < .01, 'The slider must use loaded media duration while paused');
  const pausedBox = await slider.boundingBox();
  await slider.click({ position: { x: pausedBox.width * .75, y: pausedBox.height / 2 } });
  await page.waitForFunction(() => { const audio = document.querySelector('audio'); return Math.abs(audio.currentTime - 6) < .15 && !audio.seeking && audio.paused; });
  await slider.fill('4');
  await page.waitForFunction(() => Math.abs(document.querySelector('audio').currentTime - 4) < .1 && !document.querySelector('audio').seeking);
  await slider.focus();
  await slider.press('ArrowRight');
  await page.waitForFunction(() => Math.abs(document.querySelector('audio').currentTime - 4.1) < .1);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.waitForFunction(() => Number(document.querySelector('[aria-label="Playback position"]').value) > 4.3);
  const box = await slider.boundingBox();
  await page.mouse.move(box.x + box.width * .6, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * .25, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  await page.waitForFunction(() => { const audio = document.querySelector('audio'); return audio.currentTime > 1.8 && audio.currentTime < 3 && !audio.seeking && !audio.paused; });
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.getByRole('button', { name: 'Select A little louder', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('audio').duration === 30 && document.querySelector('audio').readyState >= 1);
  assert.equal(Number(await slider.getAttribute('max')), 30);
  await slider.fill('20');
  await page.waitForFunction(() => Math.abs(document.querySelector('audio').currentTime - 20) < .1);
  await page.getByRole('button', { name: 'Edit timing', exact: true }).click();
  const reviewer = page.getByRole('slider', { name: 'Reviewer playback position', exact: true });
  await reviewer.fill('5');
  await page.waitForFunction(() => Math.abs(document.querySelector('audio').currentTime - 5) < .1 && Number(document.querySelector('[aria-label="Playback position"]').value) === 5);
  assert.equal(await app.evaluate(() => globalThis.providerCalls), 0);
  console.log('Desktop playback passed: paused metadata, slider click, song switching, mouse drag while playing, keyboard seek, backward seek and reviewer seek; no provider calls or previews');
} catch (error) {
  if (page && !page.isClosed()) console.error('Playback failure state', await page.locator('audio').evaluate(audio => ({ position: audio.currentTime, duration: audio.duration, paused: audio.paused, seeking: audio.seeking, error: audio.error?.message, slider: document.querySelector('[aria-label="Playback position"]').value })));
  throw error;
} finally { if (app) await app.close(); await rm(userData, { recursive: true, force: true }); }
