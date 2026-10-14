import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { writeDemo } from '../electron/demo.mjs';
import { run } from '../electron/process.mjs';
import { sourceUrl } from '../shared/source-url.mjs';

const soundcloud = process.argv.includes('--soundcloud');
const inputUrl = soundcloud ? 'https://www.soundcloud.com/norae-fixture/original-song?utm_source=clipboard' : 'https://youtu.be/abcdefghijk';

const userData = await mkdtemp(path.join(os.tmpdir(), 'norae-persistence-desktop-'));
let app, page;
try {
  const wav = path.join(userData, 'source.wav'), mp3 = path.join(userData, 'source.mp3');
  await writeDemo(wav);
  await run('ffmpeg', ['-nostdin', '-loglevel', 'error', '-y', '-i', wav, '-codec:a', 'libmp3lame', mp3]);
  const downloader = path.join(userData, 'fixture-downloader.mjs'), downloads = path.join(userData, 'download-calls.log');
  await writeFile(downloader, `#!/usr/bin/env node\nimport { appendFileSync, copyFileSync } from 'node:fs';\nconst args = process.argv.slice(2);\nif (args.includes('--dump-single-json')) { if(args.at(-1)!==${JSON.stringify(sourceUrl(inputUrl))})throw new Error('Unexpected source URL'); appendFileSync(${JSON.stringify(downloads)}, 'inspect\\n'); console.log(JSON.stringify({ track: 'Original persistence fixture', artists: ['Norae fixture'], uploader: 'Label account', duration: 30 })); }\nelse if (args.includes('-o')) { if(args.at(-1)!==${JSON.stringify(sourceUrl(inputUrl))})throw new Error('Unexpected source URL'); appendFileSync(${JSON.stringify(downloads)}, 'download\\n'); copyFileSync(${JSON.stringify(mp3)}, args[args.indexOf('-o') + 1].replace('%(ext)s', 'mp3')); }\nelse console.log('Fixture downloader');\n`, { mode: 0o700 });
  const credentials = path.join(userData, 'fixture.env');
  await writeFile(credentials, 'ELEVENLABS_API_KEY=fixture-key\n', { mode: 0o600 });
  await writeFile(path.join(userData, 'settings.json'), JSON.stringify({ ytDlp: downloader, credentialsFile: credentials }));
  const launch = async () => {
    const env = { ...process.env, NORAE_TEST_DATA: userData, NORAE_DEV_URL: '', ELEVENLABS_API_KEY: 'fixture-key' };
    delete env.ELECTRON_RUN_AS_NODE;
    app = await electron.launch({ args: ['.'], env });
    const page = await app.firstWindow();
    await page.getByRole('heading', { name: 'norae', exact: true }).waitFor();
    return page;
  };
  page = await launch();
  async function waitForAlignment() {
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      const track = (await page.evaluate(() => window.norae.snapshot()))[0];
      if (track?.steps.alignment.state === 'done' && track.result && track.status !== 'processing') return track;
      if (track?.status === 'error') throw new Error(track.error);
      await page.waitForTimeout(100);
    }
    throw new Error('Fixture alignment did not complete');
  }
  await app.evaluate(() => {
    globalThis.fixtureCalls = { lyrics: 0, transcript: 0, alignment: 0 };
    globalThis.fetch = async url => {
      const words = [{ text: 'Hold', start: 1, end: 5 }, { text: 'on', start: 5.2, end: 6 }];
      if (String(url).startsWith('https://lrclib.net/')) { globalThis.fixtureCalls.lyrics++; return Response.json([{ id: 1, trackName: 'Original persistence fixture', artistName: 'Norae fixture', duration: 30, plainLyrics: 'Hold on', syncedLyrics: '[00:01]Hold on' }]); }
      if (String(url).endsWith('speech-to-text')) { globalThis.fixtureCalls.transcript++; return Response.json({ words: words.map(word => ({ ...word, type: 'word' })) }); }
      if (String(url).endsWith('forced-alignment')) { globalThis.fixtureCalls.alignment++; return Response.json({ words }); }
      throw new Error('Unexpected fixture network request');
    };
  });
  await page.getByRole('textbox', { name: 'Song URL', exact: true }).fill(inputUrl);
  await page.getByRole('button', { name: 'Add to queue', exact: true }).click();
  await waitForAlignment();
  const before = (await page.evaluate(() => window.norae.snapshot()))[0];
  assert.equal(before.url, sourceUrl(inputUrl)); assert.equal(before.artist, 'Norae fixture');
  before.result.lines[0].words[0].start = 1.1;
  await page.evaluate(({ id, lines }) => window.norae.saveTiming(id, { lines, font: 'Verdana', reviewed: true }), { id: before.id, lines: before.result.lines });
  const saved = await page.evaluate(() => window.norae.snapshot());
  assert.deepEqual(await app.evaluate(() => globalThis.fixtureCalls), { lyrics: 1, transcript: 1, alignment: 1 });
  // Use the production quit handler so it must flush the real queue store.
  const closed = app.waitForEvent('close');
  await app.evaluate(({ app }) => { setTimeout(() => app.quit(), 0); });
  await closed; app = null;
  const previousDownloads = await readFile(downloads, 'utf8');
  page = await launch();
  await page.getByRole('heading', { name: 'Original persistence fixture', exact: true }).waitFor();
  await app.evaluate(() => { globalThis.restoreCalls = 0; globalThis.fetch = async () => { globalThis.restoreCalls++; throw new Error('Restoring must never call a provider'); }; });
  assert.deepEqual(await page.evaluate(() => window.norae.snapshot()), saved);
  await page.waitForFunction(() => document.querySelector('audio').readyState >= 2);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('audio').currentTime > .2);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.getByRole('slider', { name: 'Playback position' }).fill('3');
  await page.waitForFunction(() => {
    const canvas = document.querySelector('.karaoke-preview'), data = canvas.getContext('2d').getImageData(0, 300, 1920, 100).data;
    for (let i = 0; i < data.length; i += 4) if (data[i] > 100 && data[i] === data[i + 1] && data[i] === data[i + 2]) return true;
    return false;
  });
  assert.equal(await app.evaluate(() => globalThis.restoreCalls), 0);
  assert.equal(await readFile(downloads, 'utf8'), previousDownloads);
  console.log(`${soundcloud ? 'SoundCloud' : 'YouTube'} desktop persistence passed: correct source URL and artist, actual quit/reopen retains songs, playable MP3, reviewer timing and reading bar; zero repeated downloads or provider calls; no previews`);
} catch (error) {
  if (page && !page.isClosed()) console.error('Fixture playback state', await page.locator('audio').evaluate(audio => ({ position: audio.currentTime, readyState: audio.readyState, paused: audio.paused, duration: audio.duration, error: audio.error?.message, alert: document.querySelector('[role="alert"]')?.textContent })));
  throw error;
} finally { if (app) await app.close(); await rm(userData, { recursive: true, force: true }); }
