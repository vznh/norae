const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be']);
const SOUNDCLOUD_HOSTS = new Set(['soundcloud.com', 'www.soundcloud.com', 'm.soundcloud.com']);
const SOUNDCLOUD_SHORT_HOSTS = new Set(['on.soundcloud.com', 'snd.sc']);
const COLLECTIONS = new Set(['sets', 'tracks', 'albums', 'reposts', 'likes', 'spotlight', 'comments', 'followers', 'following']);
const SINGLE_TRACK_MESSAGE = 'Use a single YouTube video or SoundCloud track link, not a playlist or profile.';

function parseSource(value) {
  if (typeof value !== 'string' || value.length > 2048) throw new Error('Paste a valid YouTube or SoundCloud URL.');
  let url;
  try { url = new URL(value.trim()); } catch { throw new Error('Paste a full YouTube or SoundCloud URL, including https://.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) throw new Error('Use an https:// YouTube or SoundCloud link.');
  return url;
}

function canonicalYouTube(url) {
  let id;
  if (url.hostname === 'youtu.be') id = url.pathname.slice(1);
  else if (url.pathname === '/watch') id = url.searchParams.get('v');
  else id = url.pathname.match(/^\/(?:shorts|embed|live)\/([\w-]+)\/?$/)?.[1];
  if (!id || !/^[\w-]{11}$/.test(id)) throw new Error(SINGLE_TRACK_MESSAGE);
  return `https://www.youtube.com/watch?v=${id}`;
}

function canonicalSoundCloud(url) {
  const match = url.pathname.match(/^\/([\w-]+)\/([\w-]+)(?:\/(s-[\w-]+))?\/?$/);
  if (!match || COLLECTIONS.has(match[2]) || match[1] === 'stations') throw new Error(SINGLE_TRACK_MESSAGE);
  const canonical = new URL(`https://soundcloud.com/${match[1]}/${match[2]}${match[3] ? `/${match[3]}` : ''}`);
  const token = url.searchParams.get('secret_token');
  if (token) {
    if (!/^s-[\w-]+$/.test(token)) throw new Error(SINGLE_TRACK_MESSAGE);
    canonical.searchParams.set('secret_token', token);
  }
  return canonical.href;
}

export function sourceUrl(value) {
  const url = parseSource(value);
  if (YOUTUBE_HOSTS.has(url.hostname)) return canonicalYouTube(url);
  if (SOUNDCLOUD_HOSTS.has(url.hostname)) return canonicalSoundCloud(url);
  if (SOUNDCLOUD_SHORT_HOSTS.has(url.hostname) && /^\/[\w-]+\/?$/.test(url.pathname)) return `https://${url.hostname}${url.pathname.replace(/\/$/, '')}`;
  throw new Error(SINGLE_TRACK_MESSAGE);
}

export function sourceName(value) {
  const host = new URL(value).hostname;
  return SOUNDCLOUD_HOSTS.has(host) || SOUNDCLOUD_SHORT_HOSTS.has(host) ? 'SoundCloud' : 'YouTube';
}

// Retained for existing consumers that specifically validate YouTube URLs.
export function youtubeUrl(value) {
  const url = parseSource(value);
  if (!YOUTUBE_HOSTS.has(url.hostname)) throw new Error(SINGLE_TRACK_MESSAGE);
  return canonicalYouTube(url);
}
