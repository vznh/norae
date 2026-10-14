import { parseLyricLayout, groupTranscriptLines } from '../shared/lyrics.mjs';
import { unitsFor } from '../shared/karaoke.mjs';

export { youtubeUrl, sourceUrl, sourceName } from '../shared/source-url.mjs';

export const normalize = (text = '') => text.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
export const tokens = (text = '') => normalize(text).match(/[\p{L}\p{N}]+/gu) || [];
export function similarity(a, b) {
  const left = new Set(tokens(a)), right = new Set(tokens(b));
  if (!left.size || !right.size) return 0;
  return [...left].filter(word => right.has(word)).length * 2 / (left.size + right.size);
}

export function metadata(info, overrides = {}) {
  let title = info.track || info.title || 'Untitled track';
  let artist = info.artist || (Array.isArray(info.artists) ? info.artists.filter(artist => typeof artist === 'string' && artist.trim()).join(', ') : '') || info.creator || info.uploader || '';
  title = title.replace(/\s*[\[(](?:official[^\])]*|lyrics?[^\])]*|audio[^\])]*|music video[^\])]*|4k|hd)[\])]/gi, '').trim();
  if (!info.track && title.includes(' - ')) [artist, title] = [title.split(' - ')[0], title.split(' - ').slice(1).join(' - ')];
  artist = artist.replace(/\s*- Topic$|VEVO$/gi, '').trim();
  return { title: overrides.title?.trim() || title, artist: overrides.artist?.trim() || artist, duration: Number(info.duration) || 0 };
}

export function parseLrc(lrc = '', duration = 0) {
  const offset = Number(lrc.match(/\[offset:([+-]?\d+)\]/i)?.[1] || 0) / 1000;
  const result = []; let boundary = true, section = '';
  for (const line of lrc.split(/\r?\n/)) {
    const stamps = [...line.matchAll(/\[(\d+):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
    if (!line.trim()) { boundary = true; continue; }
    if (!stamps.length && /^\[(?!\w+:)[^\]]+\]$/.test(line.trim())) { boundary = true; section = line.trim().slice(1, -1).slice(0, 200); continue; }
    const text = line.replace(/\[[^\]]*\]/g, '').trim();
    // Empty timestamped lines are retained as instrumental gaps.
    for (const stamp of stamps) {
      const start = Math.max(0, Number(stamp[1]) * 60 + Number(stamp[2]) + Number(`0.${stamp[3] || 0}`) + offset);
      result.push({ text, start, blockStart: boundary, section: boundary ? section : '' });
    }
    if (stamps.length) { boundary = !text; section = ''; }
  }
  result.sort((a, b) => a.start - b.start);
  return result.map((line, i) => ({ ...line, end: result[i + 1]?.start ?? Math.max(duration, line.start + 5) })).filter(line => line.text);
}

export function rankCandidates(rows, track) {
  return rows.filter(row => row && (row.plainLyrics || row.syncedLyrics) && Number.isSafeInteger(row.id)).map(row => {
    const titleScore = similarity(row.trackName, track.title);
    const artistScore = similarity(row.artistName, track.artist);
    const delta = Math.abs(Number(row.duration) - track.duration);
    return { id: row.id, title: row.trackName, artist: row.artistName, album: row.albumName || '', duration: Number(row.duration), plainLyrics: String(row.plainLyrics || '').slice(0, 60000), syncedLyrics: String(row.syncedLyrics || '').slice(0, 80000), score: titleScore * .55 + artistScore * .35 + (delta <= 3 ? .1 : 0), exact: normalize(row.trackName) === normalize(track.title) && normalize(row.artistName) === normalize(track.artist) && delta <= 3 };
  }).sort((a, b) => b.score - a.score).slice(0, 8);
}

export function parseWhisper(data) {
  return (data.transcription || []).map(segment => ({
    text: String(segment.text || '').trim(),
    start: Number(segment.offsets?.from) / 1000,
    end: Number(segment.offsets?.to) / 1000,
  })).filter(segment => segment.text && Number.isFinite(segment.start) && segment.start >= 0 && segment.end > segment.start);
}

// Monotonic word alignment: repeated choruses cannot jump backwards in the audio.
// These matches are evidence, not a calibrated accuracy score or forced alignment.
function wordAlignment(lines, segments) {
  const source = lines.flatMap((line, i) => tokens(line.text).map(word => ({ word, line: i })));
  const heard = segments.flatMap((segment, i) => tokens(segment.text).map(word => ({ word, segment: i })));
  const matches = lines.map(() => []);
  if (!source.length || !heard.length || source.length * heard.length > 9_000_000) return matches;
  const width = heard.length + 1;
  const dp = new Uint16Array((source.length + 1) * width);
  for (let i = 1; i <= source.length; i++) for (let j = 1; j <= heard.length; j++) {
    dp[i * width + j] = source[i - 1].word === heard[j - 1].word ? dp[(i - 1) * width + j - 1] + 1 : Math.max(dp[(i - 1) * width + j], dp[i * width + j - 1]);
  }
  let i = source.length, j = heard.length;
  while (i > 0 && j > 0) {
    if (source[i - 1].word === heard[j - 1].word) { matches[source[i - 1].line].unshift(heard[j - 1].segment); i--; j--; }
    else if (dp[(i - 1) * width + j] >= dp[i * width + j - 1]) i--; else j--;
  }
  return matches;
}

function transcriptWords(line, segments, start, end) {
  const units = unitsFor(line.text);
  // A phrase timestamp cannot supply distinct word boundaries. Use only a
  // complete, monotonic word-for-word match inside the reference line window.
  if (units.length !== segments.length || !units.length) return null;
  let previousEnd = start;
  const words = [];
  for (let i = 0; i < units.length; i++) {
    const segment = segments[i];
    if (normalize(units[i].text) !== normalize(segment.text) || !Number.isFinite(segment.start) || !Number.isFinite(segment.end) || segment.start < previousEnd - .01 || segment.end <= segment.start || segment.end > end + .01) return null;
    words.push({ ...units[i], start: segment.start, end: segment.end });
    previousEnd = segment.end;
  }
  return words;
}

export function reconcile(lyrics, segments = [], duration = 0) {
  if (!lyrics) return {
    source: 'transcript', timing: 'transcript', agreement: null,
    lines: groupTranscriptLines(segments),
    notes: ['No confirmed database lyrics. Showing the unverified transcript with estimated line and verse breaks. Original audio timestamps are preserved.'],
  };
  const synced = parseLrc(lyrics.syncedLyrics, duration);
  const plain = parseLyricLayout(lyrics.plainLyrics || '');
  // A word-synced LRC must not replace the reference lyric's full lines.
  const sameWords = plain.length && normalize(plain.map(line => line.text).join(' ')) === normalize(synced.map(line => line.text).join(' '));
  const syncTokens = synced.flatMap((line, index) => tokens(line.text).map(word => ({ word, index })));
  let cursor = 0;
  const lines = synced.length && sameWords ? plain.map(line => {
    const count = tokens(line.text).length, ids = syncTokens.slice(cursor, cursor + count).map(token => token.index);
    const startsAtBoundary = !cursor || syncTokens[cursor - 1]?.index !== ids[0];
    cursor += count;
    const endsAtBoundary = cursor === syncTokens.length || syncTokens[cursor]?.index !== ids.at(-1);
    return { ...line, start: startsAtBoundary && endsAtBoundary ? synced[ids[0]]?.start ?? null : null, end: startsAtBoundary && endsAtBoundary ? synced[ids.at(-1)]?.end ?? null : null };
  }) : synced.length ? synced : plain;
  const matches = wordAlignment(lines, segments);
  let matchedWords = 0, totalWords = 0;
  const output = lines.map((line, i) => {
    const ids = [...new Set(matches[i])];
    const count = tokens(line.text).length;
    matchedWords += matches[i].length; totalWords += count;
    const agreement = segments.length && count ? matches[i].length / count : null;
    const timedSegments = ids.map(id => segments[id]);
    const timing = synced.length ? line.start !== null && line.end !== null ? 'database' : 'untimed' : timedSegments.length && (agreement ?? 0) >= .5 ? 'approximate' : 'untimed';
    const start = synced.length ? line.start : timing === 'approximate' ? timedSegments[0].start : null;
    const end = synced.length ? line.end : timing === 'approximate' ? timedSegments.at(-1).end : null;
    const words = start !== null && end !== null ? transcriptWords(line, timedSegments, start, end) : null;
    return { ...line, start, end, ...(words ? { words } : {}), heard: timedSegments.map(s => s.text).join(' '), agreement, timing: words ? 'transcript' : timing, review: !!words || agreement === null || agreement < .85 || timing !== 'database' || (timedSegments.length > 0 && synced.length > 0 && Math.abs(timedSegments[0].start - line.start) > 5) };
  });
  const notes = synced.length ? ['Database wording and line timestamps are preserved. Agreement measures matching words, not accuracy.'] : ['Database wording is preserved. Segment-based timings are approximate; unmatched lines stay untimed.'];
  if (output.some(line => line.words)) notes.push('Exactly matching transcript words retain their original timestamps. These are unreviewed transcription timings, not forced alignment.');
  return { source: 'database', timing: synced.length ? 'database' : 'approximate', agreement: segments.length && totalWords ? matchedWords / totalWords : null, lines: output, notes };
}
