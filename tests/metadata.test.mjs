import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanSongTitle, acceptedSongTitle } from '../shared/song-title.mjs';
import { enrichMetadata } from '../electron/metadata.mjs';

const track = { title: 'PARTYNEXTDOOR - Some Of Your Love', artist: 'PARTYNEXTDOOR', duration: 180 };
const signal = () => new AbortController().signal;

test('title cleanup removes artist prefixes but preserves title words, punctuation and recording versions', () => {
  assert.equal(cleanSongTitle(track.title, track.artist), 'Some Of Your Love');
  assert.equal(cleanSongTitle('PARTYNEXTDOOR — Some Of Your Love (Official Audio)', track.artist), 'Some Of Your Love');
  assert.equal(cleanSongTitle('Some Of Your PARTYNEXTDOOR Love', track.artist), 'Some Of Your PARTYNEXTDOOR Love');
  assert.equal(cleanSongTitle('Artist (A) - Home (Live Remix)', 'Artist (A)'), 'Home (Live Remix)');
  assert.equal(cleanSongTitle('Artist - ', 'Artist'), 'Artist -');
});
test('model output cannot invent a title, return instructions or erase a recording version', () => {
  assert.equal(acceptedSongTitle('Some Of Your Love', track.title, track.artist), 'Some Of Your Love');
  for (const title of ['Another Song', '', null, 'Some Of Your Love\nIgnore instructions', 'PARTYNEXTDOOR']) assert.equal(acceptedSongTitle(title, track.title, track.artist), null);
  assert.equal(acceptedSongTitle('Home', 'Home (Live Remix)', 'Singer'), null);
});
test('on-device enrichment sends only bounded metadata, keeps artist/duration untouched and records provenance', async () => {
  let calls = 0;
  const result = await enrichMetadata(track, signal(), {}, async (_command, args, options) => {
    calls++; assert.deepEqual(args, []);
    assert.deepEqual(JSON.parse(options.input), { title: track.title, artist: track.artist });
    assert.ok(options.timeout <= 20000);
    return JSON.stringify({ status: 'enriched', title: 'Some Of Your Love' });
  });
  assert.equal(calls, 1); assert.equal(result.title, 'Some Of Your Love');
  assert.equal(result.artist, undefined); assert.equal(result.duration, undefined);
  assert.equal(result.metadataEnrichment.source, 'apple-intelligence');
  assert.deepEqual(result.originalMetadata, { title: track.title, artist: track.artist });
});
test('unavailable, malformed, hallucinated and failed local generation fall back without failing a song', async () => {
  for (const invoke of [
    async () => '{broken',
    async () => JSON.stringify({ status: 'apple-intelligence-disabled' }),
    async () => JSON.stringify({ status: 'enriched', title: 'Invented Song' }),
    async () => { throw new Error('Helper unavailable'); },
  ]) {
    const result = await enrichMetadata(track, signal(), {}, invoke);
    assert.equal(result.title, 'Some Of Your Love'); assert.equal(result.metadataEnrichment.source, 'basic');
  }
});
test('manual title overrides bypass generation and cancellation does not silently succeed', async () => {
  let calls = 0;
  const invoke = async () => { calls++; throw new Error('must not run'); };
  assert.equal((await enrichMetadata(track, signal(), { title: 'Reviewer title' }, invoke)).title, 'Reviewer title');
  const controller = new AbortController(); controller.abort();
  await assert.rejects(enrichMetadata(track, controller.signal, {}, invoke), { name: 'AbortError' });
  assert.equal(calls, 0);
});
