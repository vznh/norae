import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanSongTitle, acceptedSongTitle } from '../shared/song-title.mjs';

const track = { title: 'PARTYNEXTDOOR - Some Of Your Love', artist: 'PARTYNEXTDOOR', duration: 180 };

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
