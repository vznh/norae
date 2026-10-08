import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseEnv } from 'node:util';

// Credentials stay in the main process; snapshots and settings contain no keys.
export async function credentials(settings = {}) {
  let file = {};
  try { file = parseEnv(await readFile(settings.credentialsFile || path.resolve('.env.local'), 'utf8')); }
  catch (error) { if (settings.credentialsFile && error.code !== 'ENOENT') throw new Error('The credentials file could not be read. Choose a readable dotenv file in Settings.'); }
  return { elevenlabs: process.env.ELEVENLABS_API_KEY || file.ELEVENLABS_API_KEY || '' };
}
async function request(url, options, provider) {
  let response;
  try { response = await fetch(url, options); }
  catch { if (options.signal?.aborted) throw new Error(options.signal.reason?.name === 'TimeoutError' ? `${provider} timed out. Retry the song.` : 'Cancelled.'); throw new Error(`${provider} could not be reached. Check your connection and retry.`); }
  if (!response.ok) throw new Error(`${provider} returned HTTP ${response.status}. Check API access, quota, and credentials.`);
  try { return await response.json(); } catch { throw new Error(`${provider} returned an invalid response.`); }
}
const combinedSignal = (signal, timeout) => AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(timeout)]);
async function elevenlabs(method, audioPath, settings, signal, fields) {
  const key = (await credentials(settings)).elevenlabs;
  if (!key) throw new Error('ElevenLabs API key missing. Add ELEVENLABS_API_KEY to your credentials file in Settings.');
  const form = new FormData();
  form.append('file', new Blob([await readFile(audioPath)], { type: audioPath.endsWith('.wav') ? 'audio/wav' : 'audio/mpeg' }), path.basename(audioPath));
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  return request(`https://api.elevenlabs.io/v1/${method}`, { method: 'POST', headers: { 'xi-api-key': key }, body: form, signal: combinedSignal(signal, 600000) }, 'ElevenLabs');
}
export async function transcribeElevenLabs(audioPath, settings, signal) {
  const data = await elevenlabs('speech-to-text', audioPath, settings, signal, { model_id: 'scribe_v2', language_code: 'eng', timestamps_granularity: 'word', tag_audio_events: 'false', diarize: 'false' });
  const words = (data.words || []).filter(word => word.type === 'word' && typeof word.text === 'string' && Number.isFinite(word.start) && Number.isFinite(word.end) && word.start >= 0 && word.end > word.start).map(({ text, start, end, logprob }) => ({ text, start, end, ...(Number.isFinite(logprob) ? { logprob } : {}) }));
  if (!words.length) throw new Error('Scribe v2 returned no usable words. Database lyrics remain available for manual timing.');
  return words;
}
export async function alignElevenLabs(audioPath, text, settings, signal) {
  return elevenlabs('forced-alignment', audioPath, settings, signal, { text });
}
