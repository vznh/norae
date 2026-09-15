// Optional live smoke check. Downloads only upstream's public-domain JFK speech
// fixture and Blender's Creative Commons Big Buck Bunny. Does not print or save database lyrics.
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { transcribe, fetchLyrics, inspect, extract, defaultSettings } from '../electron/providers.mjs';
import { run } from '../electron/process.mjs';
const root = await mkdtemp(path.resolve('.runtime/live-'));
const settings = { ...defaultSettings, model: path.resolve('.models/ggml-base.bin'), language: 'en' };
const signal = AbortSignal.timeout(180000);
const results = [];
try {
  await Promise.all([
    (async () => {
      try {
        const directory = path.join(root, 'speech'); await mkdir(directory);
        const response = await fetch('https://raw.githubusercontent.com/ggml-org/whisper.cpp/master/samples/jfk.wav', { signal });
        if (!response.ok) throw new Error(`Speech fixture HTTP ${response.status}`);
        const fixture = path.join(directory, 'source.wav'); await writeFile(fixture, Buffer.from(await response.arrayBuffer()));
        const mp3 = path.join(directory, 'audio.mp3');
        await run(settings.ffmpeg, ['-nostdin', '-loglevel', 'error', '-y', '-i', fixture, mp3], { signal });
        const segments = await transcribe(mp3, directory, settings, signal);
        assert.ok(segments.map(segment => segment.text).join(' ').toLowerCase().includes('country'));
        results.push({ check: 'FFmpeg + local Whisper on public-domain speech', passed: true, segments: segments.length });
      } catch (error) { results.push({ check: 'FFmpeg + local Whisper', passed: false, error: error.message }); }
    })(),
    (async () => {
      try {
        const result = await fetchLyrics({ title: 'Yellow', artist: 'Coldplay', duration: 269 }, signal);
        assert.ok(result.candidates.length > 0);
        results.push({ check: 'Live LRCLIB lookup', passed: true, candidates: result.candidates.length });
      } catch (error) { results.push({ check: 'Live LRCLIB lookup', passed: false, error: error.message }); }
    })(),
    (async () => {
      try {
        const url = 'https://www.youtube.com/watch?v=aqz-KE-bpKQ';
        const metadata = await inspect(url, settings, signal, {});
        const directory = path.join(root, 'youtube'); await mkdir(directory);
        await extract(url, directory, settings, signal);
        results.push({ check: 'YouTube Big Buck Bunny → temporary MP3', passed: true, duration: metadata.duration });
      } catch (error) { results.push({ check: 'YouTube Big Buck Bunny → temporary MP3', passed: false, error: error.message }); }
    })(),
  ]);
  console.log(JSON.stringify(results, null, 2));
  if (results.some(result => !result.passed)) process.exitCode = 1;
} finally { await rm(root, { recursive: true, force: true }); }
