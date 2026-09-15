import path from 'node:path';
import { readFile, access } from 'node:fs/promises';
import { run } from './process.mjs';
import { metadata, rankCandidates, parseWhisper } from './core.mjs';

export const defaultSettings = { ytDlp: 'yt-dlp', ffmpeg: 'ffmpeg', whisper: 'whisper-cli', model: '', language: 'auto' };
export async function checkDependencies(settings) {
  const results = await Promise.all([
    ...[['ytDlp', ['--version']], ['ffmpeg', ['-version']], ['whisper', ['--help']]].map(async ([key, args]) => {
      try { await run(settings[key], args, { timeout: 12000 }); return { key, ok: true, detail: 'Available' }; }
      catch (error) { return { key, ok: false, detail: error.message }; }
    }),
    (async () => { try { if (!settings.model) throw new Error('Choose a ggml Whisper model.'); await access(settings.model); return { key: 'model', ok: true, detail: path.basename(settings.model) }; } catch { return { key: 'model', ok: false, detail: 'Choose an existing ggml model file.' }; } })(),
  ]);
  return results;
}
export async function inspect(url, settings, signal, overrides) {
  const raw = await run(settings.ytDlp, ['--ignore-config', '--no-playlist', '--skip-download', '--dump-single-json', '--no-warnings', '--socket-timeout', '20', '--', url], { signal });
  const info = JSON.parse(raw);
  if (info.is_live || !Number.isFinite(info.duration) || info.duration <= 0 || info.duration > 900) throw new Error('Choose a finished video shorter than 15 minutes.');
  return metadata(info, overrides);
}
export async function extract(url, directory, settings, signal) {
  await run(settings.ytDlp, ['--ignore-config', '--no-playlist', '--no-progress', '--no-warnings', '--socket-timeout', '20', '--retries', '2', '--max-filesize', '100M', ...(settings.ffmpeg === 'ffmpeg' ? [] : ['--ffmpeg-location', settings.ffmpeg]), '-f', 'bestaudio/best', '-x', '--audio-format', 'mp3', '--audio-quality', '0', '-o', path.join(directory, 'audio.%(ext)s'), '--', url], { signal, timeout: 300000 });
  const file = path.join(directory, 'audio.mp3');
  await access(file);
  return file;
}
export async function fetchLyrics(track, signal) {
  const query = new URLSearchParams({ track_name: track.title, artist_name: track.artist });
  const response = await fetch(`https://lrclib.net/api/search?${query}`, { headers: { 'User-Agent': 'NoraePrototype/0.1 (desktop karaoke)' }, signal: AbortSignal.any([signal, AbortSignal.timeout(25000)]) });
  if (!response.ok) throw new Error(`LRCLIB returned ${response.status}. Local transcription continues independently.`);
  const rows = await response.json();
  if (!Array.isArray(rows)) throw new Error('Unexpected response from LRCLIB.');
  const candidates = rankCandidates(rows, track);
  return { candidates, selected: candidates.find(candidate => candidate.exact) || null };
}
export async function transcribe(audioPath, directory, settings, signal) {
  if (!settings.model) throw new Error('Select a Whisper model in Settings, then retry.');
  const wav = path.join(directory, 'whisper.wav');
  await run(settings.ffmpeg, ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-i', audioPath, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wav], { signal });
  // No lyrics, prompt or hints enter this independent acoustic pass.
  await run(settings.whisper, ['-m', settings.model, '-f', wav, '-l', settings.language, '-oj', '-of', path.join(directory, 'transcript')], { signal, timeout: 1800000 });
  const segments = parseWhisper(JSON.parse(await readFile(path.join(directory, 'transcript.json'), 'utf8')));
  if (!segments.length) throw new Error('Whisper returned no usable speech segments. Database lyrics remain available.');
  return segments;
}
