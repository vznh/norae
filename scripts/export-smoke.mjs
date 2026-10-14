import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import { QueueEngine } from '../electron/engine.mjs';
import { drawKaraoke } from '../shared/karaoke.mjs';
import { READING_BAR_OPACITY } from '../shared/reading-cursor.mjs';
import { run } from '../electron/process.mjs';

const userData = await mkdtemp(path.join(os.tmpdir(), 'norae-export-desktop-'));
let app;
const line = (text, start, end, words = [{ text, start, end }]) => ({ text, start, end, words, blockStart: false, timing: 'manual', review: false, heard: '', agreement: null });
const lines = [
  line('Hold on', 1, 1.8, [{ text: 'Hold ', start: 1, end: 1.6 }, { text: 'on', start: 1.6, end: 1.8 }]),
  line('Yes', 1.85, 1.95), line('Sing', 2, 2.4), line('Here', 2.5, 3),
  { ...line('Go away', 3.1, 4, [{ text: 'Go ', start: 3.1, end: 3.3 }, { text: 'a', start: 3.3, end: 3.55 }, { text: 'way', start: 3.55, end: 4 }]), blockStart: true, section: 'Chorus' },
  line('Again', 4.3, 4.8),
];

async function decodedFrame(file, frame) {
  const child = spawn('ffmpeg', ['-nostdin', '-loglevel', 'error', '-i', file, '-vf', `select=eq(n\\,${frame})`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { stdio: ['ignore', 'pipe', 'pipe'] });
  const buffers = []; let error = '';
  child.stdout.on('data', data => buffers.push(data)); child.stderr.on('data', data => { error += data; });
  await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', code => code === 0 ? resolve() : reject(new Error(error))); });
  const pixels = Buffer.concat(buffers); assert.equal(pixels.length, 1920 * 1080 * 3); return pixels;
}

try {
  const engine = await QueueEngine.open({ root: path.join(userData, 'library/audio'), persistencePath: path.join(userData, 'library/queue.json'), settings: {} });
  const id = await engine.demo(), track = engine.tracks[0];
  track.duration = 6; track.result.lines = structuredClone(lines);
  track.result.lines[0].words[0].start = track.result.lines[0].words[0].end = null;
  await engine.close();
  const env = { ...process.env, NORAE_TEST_DATA: userData, NORAE_DEV_URL: '' }; delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ args: ['.'], env });
  const page = await app.firstWindow(), errors = []; page.on('pageerror', error => errors.push(error.message));
  const exportButton = page.getByRole('button', { name: 'Export MP4', exact: true });
  await page.getByRole('heading', { name: 'A little louder', exact: true }).waitFor();
  assert.equal(await exportButton.isDisabled(), true);
  await page.getByText(/Line 1, unit 1: set both start and end before exporting/).waitFor();
  const output = path.join(userData, 'export.mp4');
  await app.evaluate(({ dialog }, output) => {
    globalThis.providerCalls = 0; globalThis.fetch = async () => { globalThis.providerCalls++; throw new Error('Export must not call providers'); };
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: output });
  }, output);
  await page.evaluate(({ id, lines }) => window.norae.saveTiming(id, { lines, font: 'Arial', reviewed: true }), { id, lines });
  await exportButton.click();
  await page.getByRole('progressbar', { name: 'MP4 export progress' }).waitFor();
  await page.getByRole('status').filter({ hasText: 'Saved export.mp4' }).waitFor({ timeout: 120000 });
  const media = JSON.parse(await run('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', output]));
  const video = media.streams.find(stream => stream.codec_type === 'video'), audio = media.streams.find(stream => stream.codec_type === 'audio');
  assert.equal(video.width, 1920); assert.equal(video.height, 1080); assert.equal(video.codec_name, 'h264'); assert.equal(video.profile, 'High');
  assert.equal(video.pix_fmt, 'yuv420p'); assert.equal(video.avg_frame_rate, '30/1'); assert.equal(video.nb_frames, '180'); assert.equal(video.sample_aspect_ratio, '1:1');
  assert.equal(video.color_space, 'bt709'); assert.equal(video.color_transfer, 'bt709'); assert.equal(video.color_primaries, 'bt709');
  assert.equal(audio.codec_name, 'aac'); assert.equal(audio.profile, 'LC'); assert.equal(audio.sample_rate, '48000'); assert.equal(audio.channels, 2);
  assert.ok(Math.abs(Number(media.format.duration) - 6) < .15);
  assert.ok(Math.abs(Number(video.start_time) - Number(audio.start_time)) < 1 / 30, `Audio/video starts must agree within a frame: video=${video.start_time}, audio=${audio.start_time}`);
  const file = await readFile(output), atoms = [];
  for (let offset = 0; offset + 8 <= file.length;) { const size = file.readUInt32BE(offset); assert.ok(size >= 8); atoms.push({ name: file.toString('ascii', offset + 4, offset + 8), offset, size }); offset += size; }
  const moov = atoms.find(atom => atom.name === 'moov'); assert.ok(moov.offset < atoms.find(atom => atom.name === 'mdat').offset);
  assert.equal(file.subarray(moov.offset, moov.offset + moov.size).includes(Buffer.from('elst')), false);
  const canvas = createCanvas(1920, 1080), ctx = canvas.getContext('2d');
  for (const position of [.5, 1.3, 2.2, 3.7]) {
    drawKaraoke(ctx, lines, position, 6, { font: 'Arial' });
    const expected = ctx.getImageData(0, 0, 1920, 1080).data, actual = await decodedFrame(output, Math.round(position * 30));
    let white = 0, matchingWhite = 0, blue = 0, matchingBlue = 0;
    const barGray = Math.round(255 * READING_BAR_OPACITY);
    for (let pixel = 1920 * 280; pixel < 1920 * 850; pixel++) {
      const i = pixel * 4, j = pixel * 3;
      if (Math.abs(expected[i] - barGray) <= 1 && expected[i] === expected[i + 1] && expected[i] === expected[i + 2]) { white++; if ([0, 1, 2].every(channel => Math.abs(actual[j + channel] - expected[i + channel]) < 25)) matchingWhite++; }
      if (expected[i + 2] > 220 && expected[i] < 90 && expected[i + 1] > 105 && expected[i + 1] < 155) { blue++; if (actual[j + 2] > 200 && actual[j] < 110 && actual[j + 1] > 85 && actual[j + 1] < 175) matchingBlue++; }
    }
    assert.ok(white > 30 && matchingWhite / white > .65, `Reading bar differs from preview at ${position}s: ${matchingWhite}/${white} pixels`);
    if (position > 1) assert.ok(blue > 30 && matchingBlue / blue > .65, `Consumed words differ from preview at ${position}s`);
  }
  assert.equal(await app.evaluate(() => globalThis.providerCalls), 0); assert.deepEqual(errors, []);
  assert.equal((await readdir(path.dirname(output))).some(file => file.startsWith('.norae-export-')), false);
  console.log('Export desktop passed: timing preflight, native progress, real 1080p/30 High H.264 + 48kHz stereo AAC, fast-start/no edit lists, audio/video sync, encoded bars and blue words match preview through lead-in and rolling pair replacement; no APIs or preview artifacts');
} finally { if (app) await app.close(); await rm(userData, { recursive: true, force: true }); }
