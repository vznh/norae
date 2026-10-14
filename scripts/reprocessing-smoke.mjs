import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// Isolated providers exercise real queue/reprocessing code without downloading
// recordings, calling paid APIs, or touching the user's running room.
const userData = await mkdtemp(path.join(os.tmpdir(), 'norae-reprocessing-'));
let app, page;
const mainErrors = [];
try {
  const env = { ...process.env, NORAE_TEST_DATA: userData, NORAE_DEV_URL: '' };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ args: ['.'], env });
  app.process().stderr.on('data', data => mainErrors.push(data.toString()));
  page = await app.firstWindow(); const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.getByRole('heading', { name: 'norae', exact: true }).waitFor();
  await app.evaluate(async ({ ipcMain, BrowserWindow, protocol }, { enginePath, demoPath, audioPath, root }) => {
    const require = process.getBuiltinModule('node:module').createRequire(enginePath);
    const { QueueEngine } = require(enginePath), { writeDemo } = require(demoPath), { audioResponse } = require(audioPath);
    const texts = Array.from({ length: 47 }, (_, index) => ["Can't re-enter now (say what?)", 'Go on, sing again', 'Hold this sound', 'Bring it back now'][index] || `Original fixture line ${index + 1}`);
    const lyrics = { id: 1, title: 'Reprocessing fixture with a long song title', artist: 'Original fixture', duration: 30, plainLyrics: texts.join('\n'), syncedLyrics: texts.map((text, index) => `[00:${(.5 + index * .55).toFixed(2).padStart(5, '0')}]${text}`).join('\n') };
    const characters = [], words = [];
    for (const [lineIndex, text] of texts.entries()) {
      let start = .5 + lineIndex * .55;
      for (const token of text.match(/\S+\s*/g)) {
        const letters = [...token.trimEnd()], end = start + .02 + letters.length * .006;
        words.push({ text: token.trimEnd(), start, end });
        letters.forEach((text, index) => characters.push({ text, start: start + index * (end - start) / letters.length, end: start + (index + 1) * (end - start) / letters.length }));
        characters.push({ text: ' ', start: end, end });
        start = end + .012;
      }
      characters.push({ text: '\n', start, end: start });
    }
    const counts = { downloads: 0, transcriptions: 0, alignments: 0 };
    const engine = new QueueEngine({ root, settings: {}, services: {
      inspect: async () => ({ title: lyrics.title, artist: lyrics.artist, duration: 30 }),
      extract: async (_url, directory) => { counts.downloads++; const audio = `${directory}/audio.wav`; await writeDemo(audio); return audio; },
      fetchLyrics: async () => ({ candidates: [lyrics], selected: lyrics }),
      transcribe: async () => { counts.transcriptions++; return [{ text: 'Different acoustic evidence', start: .5, end: 2 }]; },
      align: async () => {
        if (++counts.alignments === 1) throw new Error('Aligned words do not match the supplied lyrics. Correct the lyrics and realign. Review held vowels, repeated ad-libs, contractions, and the selected recording before continuing.');
        // Characters reproduce the supplied text; word tokenization disagrees.
        return { characters, words: [{ ...words[0], text: 'Cannot' }, ...words.slice(1)] };
      },
    } });
    for (const [channel, handler] of [
      ['room:snapshot', () => engine.snapshot()], ['room:retry', id => engine.retry(id)],
      ['room:align', id => engine.align(id)], ['room:timing', (id, input) => engine.saveTiming(id, input)],
    ]) { ipcMain.removeHandler(channel); ipcMain.handle(channel, (_event, ...args) => handler(...args)); }
    protocol.unhandle('norae-audio');
    protocol.handle('norae-audio', request => { const id = new URL(request.url).pathname.slice(1), track = engine.tracks.find(track => track.id === id); return audioResponse(request, track?.audioPath); });
    engine.on('change', tracks => BrowserWindow.getAllWindows()[0].webContents.send('room:changed', tracks));
    globalThis.reprocessingTest = { engine, counts };
    engine.add({ url: 'https://youtu.be/abcdefghijk' });
  }, { enginePath: path.resolve('electron/engine.mjs'), demoPath: path.resolve('electron/demo.mjs'), audioPath: path.resolve('electron/audio.mjs'), root: path.join(userData, 'fixture-room') });
  // Replacing a protocol after window creation leaves that renderer's loader
  // bound to the original empty engine. Recreate the fixture document so media
  // requests use the new handler rather than masking a failed load with UI seeks.
  await page.reload();
  await page.getByText('Reading bar needs word timing for lines 1, 2, 3, 4 and 43 more', { exact: true }).waitFor();

  async function verifyFit() {
    await page.waitForTimeout(100);
    const rects = await page.locator('.song-panel .karaoke-preview').evaluate(canvas => {
      const frame = canvas.getBoundingClientRect(), viewport = canvas.parentElement.getBoundingClientRect(), panel = canvas.closest('.song-panel').getBoundingClientRect(), player = document.querySelector('.player').getBoundingClientRect();
      return { width: frame.width, height: frame.height, top: frame.top, bottom: frame.bottom, viewportBottom: viewport.bottom, panelBottom: panel.bottom, playerTop: player.top };
    });
    assert.ok(rects.width > 0 && rects.height > 0, `Frame collapsed: ${JSON.stringify(rects)}`);
    assert.ok(Math.abs(rects.width / rects.height - 16 / 9) < .001, 'Frame aspect ratio changed');
    assert.ok(rects.bottom <= rects.viewportBottom + 1 && rects.bottom <= rects.panelBottom + 1 && rects.bottom <= rects.playerTop + 1, `Video overlaps playback controls: ${JSON.stringify(rects)}`);
  }
  for (const size of [{ width: 1280, height: 720 }, { width: 1920, height: 1080 }, { width: 1000, height: 700 }, { width: 1600, height: 650 }]) {
    await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(size.width, size.height), size);
    await verifyFit();
  }
  await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; window.setContentSize(1280, 800); window.webContents.setZoomFactor(1.25); });
  await verifyFit();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1));
  await page.getByRole('button', { name: 'Align words', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.reading-timing'));
  assert.equal((await page.evaluate(() => window.norae.snapshot()))[0].steps.alignment.state, 'done');
  const hasBar = () => page.waitForFunction(() => {
    const canvas = document.querySelector('.karaoke-preview'), data = canvas.getContext('2d').getImageData(0, 300, 1920, 500).data;
    // Incoming bars may be fading with a replacement pair. White over black
    // stays neutral; lyric text is blue or pale gray with unequal RGB channels.
    for (let i = 0; i < data.length; i += 4) if (data[i] > 100 && data[i] === data[i + 1] && data[i] === data[i + 2]) return true;
    return false;
  });
  await page.getByRole('slider', { name: 'Playback position' }).fill('1.8'); await hasBar(); await verifyFit();
  await page.getByRole('button', { name: 'Cross-check', exact: false }).click();
  await page.getByRole('button', { name: 'Retry processing', exact: true }).click();
  const alignmentDeadline = Date.now() + 30000;
  while (true) {
    const track = (await page.evaluate(() => window.norae.snapshot()))[0];
    if (track.steps.alignment.state === 'done' && track.status !== 'processing') break;
    if (Date.now() > alignmentDeadline) throw new Error('Reprocessing alignment did not complete');
    await page.waitForTimeout(100);
  }
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('slider', { name: 'Playback position' }).fill('2.4'); await hasBar(); await verifyFit();
  const stats = await app.evaluate(() => ({ ...globalThis.reprocessingTest.counts }));
  assert.deepEqual(stats, { downloads: 2, transcriptions: 2, alignments: 3 });
  assert.deepEqual(errors, []);
  console.log('Reprocessing desktop passed: 47-line warnings, footer containment, 16:9 at four sizes and zoom, character alignment, visible bars after full retry; no previews or API charges');
} catch (error) {
  if (page && !page.isClosed()) console.error('Fixture audio state', await page.locator('audio').evaluate(audio => ({ duration: audio.duration, readyState: audio.readyState, networkState: audio.networkState, error: audio.error?.message, currentSrc: audio.currentSrc })));
  if (mainErrors.length) console.error('Fixture main errors', mainErrors.join('').slice(-6000));
  if (app) console.error('Fixture audio response', await app.evaluate(async ({ net }) => {
    const track = globalThis.reprocessingTest.engine.tracks[0], response = await net.fetch(track.audioUrl, { headers: { Range: 'bytes=0-99' } });
    return { status: response.status, headers: Object.fromEntries(response.headers), bytes: (await response.arrayBuffer()).byteLength };
  }).catch(error => ({ error: error.message })));
  throw error;
} finally {
  if (app) {
    await app.evaluate(async () => { await globalThis.reprocessingTest?.engine.close(); delete globalThis.reprocessingTest; }).catch(() => {});
    await app.close();
  }
  await rm(userData, { recursive: true, force: true });
}
