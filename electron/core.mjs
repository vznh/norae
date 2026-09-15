export function youtubeUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) throw new Error('Paste a valid YouTube video URL.');
  let url;
  try { url = new URL(value.trim()); } catch { throw new Error('Paste a full YouTube URL, including https://.'); }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || url.port) throw new Error('Use an https:// YouTube video URL.');
  let id;
  if (host === 'youtu.be') id = url.pathname.slice(1);
  else if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com'].includes(host)) {
    if (url.pathname === '/watch') id = url.searchParams.get('v');
    else id = url.pathname.match(/^\/(?:shorts|embed|live)\/([\w-]+)\/?$/)?.[1];
  }
  if (!id || !/^[\w-]{11}$/.test(id)) throw new Error('Use a single YouTube video link, not a playlist or channel.');
  return `https://www.youtube.com/watch?v=${id}`;
}

export const normalize = (text = '') => text.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
export const tokens = (text = '') => normalize(text).match(/[\p{L}\p{N}]+/gu) || [];
export function similarity(a, b) {
  const left = new Set(tokens(a)), right = new Set(tokens(b));
  if (!left.size || !right.size) return 0;
  return [...left].filter(word => right.has(word)).length * 2 / (left.size + right.size);
}

export function metadata(info, overrides = {}) {
  let title = info.track || info.title || 'Untitled video';
  let artist = info.artist || info.creator || info.uploader || '';
  title = title.replace(/\s*[\[(](?:official[^\])]*|lyrics?[^\])]*|audio[^\])]*|music video[^\])]*|4k|hd)[\])]/gi, '').trim();
  if (!info.track && title.includes(' - ')) [artist, title] = [title.split(' - ')[0], title.split(' - ').slice(1).join(' - ')];
  artist = artist.replace(/\s*- Topic$|VEVO$/gi, '').trim();
  return { title: overrides.title?.trim() || title, artist: overrides.artist?.trim() || artist, duration: Number(info.duration) || 0 };
}

export function parseLrc(lrc = '', duration = 0) {
  const offset = Number(lrc.match(/\[offset:([+-]?\d+)\]/i)?.[1] || 0) / 1000;
  const result = [];
  for (const line of lrc.split(/\r?\n/)) {
    const stamps = [...line.matchAll(/\[(\d+):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
    const text = line.replace(/\[[^\]]*\]/g, '').trim();
    // Empty timestamped lines are retained as instrumental gaps.
    for (const stamp of stamps) {
      const start = Math.max(0, Number(stamp[1]) * 60 + Number(stamp[2]) + Number(`0.${stamp[3] || 0}`) + offset);
      result.push({ text, start });
    }
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

export function reconcile(lyrics, segments = [], duration = 0) {
  if (!lyrics) return {
    source: 'transcript', timing: 'transcript', agreement: null,
    lines: segments.map(line => ({ ...line, heard: line.text, agreement: null, review: true, timing: 'transcript' })),
    notes: ['No confirmed database lyrics. Showing the unverified local transcript.'],
  };
  const synced = parseLrc(lyrics.syncedLyrics, duration);
  const lines = synced.length ? synced : lyrics.plainLyrics.split(/\r?\n/).map(text => ({ text: text.trim() })).filter(line => line.text && !/^\[.*\]$/.test(line.text));
  const matches = wordAlignment(lines, segments);
  let matchedWords = 0, totalWords = 0;
  const output = lines.map((line, i) => {
    const ids = [...new Set(matches[i])];
    const count = tokens(line.text).length;
    matchedWords += matches[i].length; totalWords += count;
    const agreement = segments.length && count ? matches[i].length / count : null;
    const timedSegments = ids.map(id => segments[id]);
    const timing = synced.length ? 'database' : timedSegments.length && (agreement ?? 0) >= .5 ? 'approximate' : 'untimed';
    return { ...line, start: synced.length ? line.start : timing === 'approximate' ? timedSegments[0].start : null, end: synced.length ? line.end : timing === 'approximate' ? timedSegments.at(-1).end : null, heard: timedSegments.map(s => s.text).join(' '), agreement, timing, review: agreement === null || agreement < .85 || timing !== 'database' || (timedSegments.length > 0 && synced.length > 0 && Math.abs(timedSegments[0].start - line.start) > 5) };
  });
  return { source: 'database', timing: synced.length ? 'database' : 'approximate', agreement: segments.length && totalWords ? matchedWords / totalWords : null, lines: output, notes: synced.length ? ['Database wording and timestamps are preserved. Agreement measures matching words, not accuracy.'] : ['Database wording is preserved. Segment-based timings are approximate; unmatched lines stay untimed.'] };
}
