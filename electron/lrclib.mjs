import { rankCandidates } from './core.mjs';

export async function fetchLyrics(track, signal, _settings, { request = globalThis.fetch } = {}) {
  const query = new URLSearchParams({ track_name: track.title, artist_name: track.artist });
  const url = `https://lrclib.net/api/search?${query}`;
  signal?.throwIfAborted();
  const requestSignal = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(25000)]);
  let response;
  try {
    response = await request(url, { headers: { 'User-Agent': 'NoraePrototype/0.1 (desktop karaoke)' }, signal: requestSignal });
  } catch (error) {
    signal?.throwIfAborted();
    throw new Error(error.name === 'TimeoutError' ? 'LRCLIB timed out. Transcription continues independently.' : 'LRCLIB could not be reached. Transcription continues independently.');
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new Error(`LRCLIB returned ${response.status}. Transcription continues independently.`);
  }
  let rows;
  try { rows = await response.json(); } catch { throw new Error('Unexpected response from LRCLIB.'); }
  signal?.throwIfAborted();
  if (!Array.isArray(rows)) throw new Error('Unexpected response from LRCLIB.');
  try {
    const candidates = rankCandidates(rows, track);
    return { candidates, selected: candidates.find(candidate => candidate.exact) || null };
  } catch { throw new Error('Unexpected response from LRCLIB.'); }
}
