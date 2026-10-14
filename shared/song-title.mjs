const comparable = value => value.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function cleanSongTitle(title, artist = '') {
  const original = String(title || '').trim();
  let cleaned = original;
  if (artist.trim()) {
    const prefix = new RegExp(`^${escapeRegex(artist.trim())}\\s*(?:[-–—|:]\\s*)`, 'i');
    cleaned = cleaned.replace(prefix, '').trim();
  }
  cleaned = cleaned.replace(/\s*[\[(](?:official[^\])]*|lyrics?[^\])]*|audio|music video|unreleased(?:\s+\d{4})?|leaked?|cdq|hq|lq|4k|hd)[\])]/gi, '').trim();
  return cleaned || original;
}

// An on-device model may extract names, but must never manufacture a song.
export function acceptedSongTitle(candidate, original, artist = '') {
  if (typeof candidate !== 'string' || !candidate.trim() || candidate.length > 500 || /[\r\n\x00-\x1f]/.test(candidate)) return null;
  const title = cleanSongTitle(candidate, artist);
  if (!comparable(original).includes(comparable(title))) return null;
  if (comparable(title) === comparable(artist)) return null;
  const versions = original.match(/\b(?:remix|cover|live|acoustic|instrumental|sped|slowed|nightcore)\b/gi) || [];
  if (versions.some(version => !new RegExp(`\\b${version}\\b`, 'i').test(title))) return null;
  return title;
}
