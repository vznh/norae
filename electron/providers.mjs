import path from 'node:path';
import { readFile, access } from 'node:fs/promises';
import { run } from './process.mjs';
import { metadata, parseWhisper } from './core.mjs';
import { credentials, transcribeElevenLabs, alignElevenLabs } from './cloud.mjs';
import { checkMetadata } from './metadata.mjs';
export { enrichMetadata as enrich } from './metadata.mjs';
export { fetchLyrics } from './lrclib.mjs';

export const defaultSettings = { ytDlp: 'yt-dlp', ffmpeg: 'ffmpeg', whisper: 'whisper-cli', model: '', language: 'en', lyricsProvider: 'lrclib', transcriptionProvider: 'elevenlabs', credentialsFile: '', font: 'Arial' };
export async function checkDependencies(settings) {
  const results = await Promise.all([
    checkMetadata(),
    ...[['ytDlp', ['--version']], ['ffmpeg', ['-version']], ...(settings.transcriptionProvider === 'whisper' ? [['whisper', ['--help']]] : [])].map(async ([key, args]) => {
      try { await run(settings[key], args, { timeout: 12000 }); return { key, ok: true, detail: 'Available' }; }
      catch (error) { return { key, ok: false, detail: error.message }; }
    }),
    ...(settings.transcriptionProvider === 'whisper' ? [(async () => { try { if (!settings.model) throw new Error('Choose a ggml Whisper model.'); await access(settings.model); return { key: 'model', ok: true, detail: path.basename(settings.model) }; } catch { return { key: 'model', ok: false, detail: 'Choose an existing ggml model file.' }; } })()] : []),
    (async () => { const keys = await credentials(settings); return { key: 'elevenlabs', ok: Boolean(keys.elevenlabs), detail: keys.elevenlabs ? 'Key configured · account access is checked on use' : 'ELEVENLABS_API_KEY missing' }; })(),
  ]);
  return results;
}
export async function inspect(url, settings, signal, overrides) {
  const raw = await run(settings.ytDlp, ['--ignore-config', '--no-playlist', '--skip-download', '--dump-single-json', '--no-warnings', '--socket-timeout', '20', '--', url], { signal });
  const info = JSON.parse(raw);
  if (info._type === 'playlist' || Array.isArray(info.entries)) throw new Error('Choose a single track, not a playlist or profile.');
  if (info.is_live || !Number.isFinite(info.duration) || info.duration <= 0 || info.duration > 900) throw new Error('Choose a finished track no longer than 15 minutes.');
  if (info.formats?.length && info.formats.every(format => /(?:^|_)preview(?:_|$)/i.test(format.format_id || ''))) throw new Error('Only a preview is available for this track. Choose a recording available in full.');
  const track = metadata(info, overrides);
  return { ...track, originalMetadata: { title: String(info.track || info.title || track.title).slice(0, 1000), artist: track.artist } };
}
export async function extract(url, directory, settings, signal) {
  await run(settings.ytDlp, ['--ignore-config', '--no-playlist', '--no-progress', '--no-warnings', '--socket-timeout', '20', '--retries', '2', '--max-filesize', '100M', ...(settings.ffmpeg === 'ffmpeg' ? [] : ['--ffmpeg-location', settings.ffmpeg]), '-f', 'bestaudio/best', '-x', '--audio-format', 'mp3', '--audio-quality', '0', '-o', path.join(directory, 'audio.%(ext)s'), '--', url], { signal, timeout: 300000 });
  const file = path.join(directory, 'audio.mp3');
  await access(file);
  return file;
}
export async function transcribe(audioPath, directory, settings, signal) {
  if (settings.transcriptionProvider === 'elevenlabs') return transcribeElevenLabs(audioPath, settings, signal);
  if (!settings.model) throw new Error('Select a Whisper model in Settings, then retry.');
  const wav = path.join(directory, 'whisper.wav');
  await run(settings.ffmpeg, ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-i', audioPath, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wav], { signal });
  // No lyrics, prompt or hints enter this independent acoustic pass.
  await run(settings.whisper, ['-m', settings.model, '-f', wav, '-l', settings.language, '-oj', '-of', path.join(directory, 'transcript')], { signal, timeout: 1800000 });
  const segments = parseWhisper(JSON.parse(await readFile(path.join(directory, 'transcript.json'), 'utf8')));
  if (!segments.length) throw new Error('Whisper returned no usable speech segments. Database lyrics remain available.');
  return segments;
}
export const align = alignElevenLabs;
