import { fileURLToPath } from 'node:url';
import { run } from './process.mjs';
import { acceptedSongTitle, cleanSongTitle } from '../shared/song-title.mjs';

export const METADATA_VERSION = 1;
let helperPath = fileURLToPath(new URL('../.runtime/native/norae-metadata', import.meta.url));
export function configureMetadataHelper(file) { helperPath = file; }

const availabilityMessages = {
  available: 'On-device title cleanup ready',
  'apple-intelligence-disabled': 'Enable Apple Intelligence in System Settings to use on-device title cleanup.',
  'model-not-ready': 'Apple Intelligence is still preparing its model. Basic title cleanup is available.',
  'device-not-eligible': 'This Mac does not support Apple Intelligence. Basic title cleanup is available.',
  'requires-macos-26': 'Apple Intelligence title cleanup requires macOS 26. Basic cleanup is available.',
};
export async function checkMetadata() {
  try {
    const result = JSON.parse(await run(helperPath, ['--availability'], { timeout: 10000, maxOutput: 4096 }));
    return { key: 'appleIntelligence', optional: true, ok: result.status === 'available', detail: availabilityMessages[result.status] || 'Basic title cleanup is available.' };
  } catch {
    return { key: 'appleIntelligence', optional: true, ok: false, detail: 'On-device title helper unavailable. Basic title cleanup is available.' };
  }
}

export async function enrichMetadata(track, signal, overrides = {}, invoke = run) {
  const original = track.originalMetadata || { title: track.title, artist: track.artist };
  const title = cleanSongTitle(track.title, track.artist);
  const fallback = { title: overrides.title || title, metadataEnrichment: { version: METADATA_VERSION, source: 'basic', status: 'unavailable' }, originalMetadata: original };
  if (overrides.title) return { ...fallback, metadataEnrichment: { version: METADATA_VERSION, source: 'manual', status: 'preserved' } };
  try {
    signal?.throwIfAborted();
    const result = JSON.parse(await invoke(helperPath, [], {
      input: JSON.stringify({ title: original.title.slice(0, 1000), artist: track.artist.slice(0, 500) }),
      signal, timeout: 20000, maxOutput: 4096,
    }));
    signal?.throwIfAborted();
    const accepted = result.status === 'enriched' && acceptedSongTitle(result.title, original.title, track.artist);
    return { ...fallback, ...(accepted ? { title: accepted } : {}), metadataEnrichment: { version: METADATA_VERSION, source: accepted ? 'apple-intelligence' : 'basic', status: accepted ? 'enriched' : result.status === 'enriched' ? 'invalid-output' : String(result.status || 'invalid-output').slice(0, 80) } };
  } catch {
    signal?.throwIfAborted();
    return fallback;
  }
}
