import { setTimeout as sleep } from 'node:timers/promises';
import { rankCandidates } from './core.mjs';

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const MAX_RETRIES = 2;
const MAX_RETRY_WAIT = 60000;
const waitForRetry = (milliseconds, signal) => sleep(milliseconds, undefined, { signal });

function retryDelay(header, attempt, now) {
  if (header?.trim()) {
    const seconds = Number(header);
    if (Number.isFinite(seconds)) return seconds >= 0 ? seconds * 1000 : 1000 * 2 ** attempt;
    const date = Date.parse(header);
    if (Number.isFinite(date)) return Math.max(0, date - now());
  }
  return 1000 * 2 ** attempt;
}

export async function fetchLyrics(track, signal, _settings, { request = globalThis.fetch, wait = waitForRetry, now = Date.now } = {}) {
  const query = new URLSearchParams({ track_name: track.title, artist_name: track.artist });
  const url = `https://lrclib.net/api/search?${query}`;
  let rows;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    signal?.throwIfAborted();
    const requestSignal = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(25000)]);
    let response, failure, retryable;
    try {
      response = await request(url, { headers: { 'User-Agent': 'NoraePrototype/0.1 (desktop karaoke)' }, signal: requestSignal });
      if (response.ok) {
        rows = await response.json();
        break;
      }
      failure = new Error(`LRCLIB returned ${response.status}. Transcription continues independently.`);
      retryable = RETRYABLE_STATUS.has(response.status);
      await response.body?.cancel().catch(() => {});
    } catch (error) {
      signal?.throwIfAborted();
      const timedOut = requestSignal.reason?.name === 'TimeoutError' || error.name === 'TimeoutError';
      retryable = timedOut || error instanceof TypeError;
      failure = new Error(timedOut ? 'LRCLIB timed out. Transcription continues independently.' : retryable ? 'LRCLIB could not be reached. Transcription continues independently.' : 'Unexpected response from LRCLIB.');
    }
    signal?.throwIfAborted();
    if (!retryable || attempt === MAX_RETRIES) throw failure;
    const delay = retryDelay(response?.headers.get('retry-after'), attempt, now);
    // Never retry earlier than requested or leave a song waiting indefinitely.
    if (delay > MAX_RETRY_WAIT) throw new Error('LRCLIB requested a longer wait. Try Retry lyrics later. Transcription continues independently.');
    await wait(delay, signal);
  }
  signal?.throwIfAborted();
  if (!Array.isArray(rows)) throw new Error('Unexpected response from LRCLIB.');
  try {
    const candidates = rankCandidates(rows, track);
    return { candidates, selected: candidates.find(candidate => candidate.exact) || null };
  } catch { throw new Error('Unexpected response from LRCLIB.'); }
}
