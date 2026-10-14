import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceUrl, sourceName } from '../shared/source-url.mjs';

test('SoundCloud tracks canonicalize desktop/mobile links while dropping share tracking', () => {
  for (const input of ['https://soundcloud.com/artist-name/my-track', 'https://www.soundcloud.com/artist-name/my-track/?utm_source=clipboard&utm_campaign=social_sharing#t=4', 'https://m.soundcloud.com/artist-name/my-track']) {
    assert.equal(sourceUrl(input), 'https://soundcloud.com/artist-name/my-track');
    assert.equal(sourceName(sourceUrl(input)), 'SoundCloud');
  }
});
test('SoundCloud share links are retained for downloader resolution', () => {
  assert.equal(sourceUrl('https://on.soundcloud.com/AbC123/?utm_source=clipboard'), 'https://on.soundcloud.com/AbC123');
  assert.equal(sourceUrl('https://snd.sc/AbC123'), 'https://snd.sc/AbC123');
});
test('private recording identity retains the access token required by the supplied link', () => {
  assert.equal(sourceUrl('https://soundcloud.com/artist/track/s-fixture?utm_source=clipboard'), 'https://soundcloud.com/artist/track/s-fixture');
  assert.equal(sourceUrl('https://soundcloud.com/artist/track?secret_token=s-fixture&utm_source=clipboard'), 'https://soundcloud.com/artist/track?secret_token=s-fixture');
});
test('profiles, sets, related collections, unsupported hosts and unsafe links cannot be queued', () => {
  for (const input of [
    'https://soundcloud.com/artist', 'https://soundcloud.com/artist/sets/album', 'https://soundcloud.com/artist/sets', 'https://soundcloud.com/artist/tracks', 'https://soundcloud.com/artist/likes', 'https://soundcloud.com/artist/track/recommended', 'https://soundcloud.com/stations/track/artist/track',
    'https://soundcloud.com.attacker.test/artist/track', 'https://soundcloud.com@attacker.test/artist/track', 'https://user:password@soundcloud.com/artist/track', 'https://soundcloud.com:8000/artist/track', 'http://soundcloud.com/artist/track', 'file:///tmp/song.mp3', 'https://on.soundcloud.com/a/b', 'https://api.soundcloud.com/playlists/123',
  ]) assert.throws(() => sourceUrl(input), input);
});
test('YouTube canonical identity stays compatible with previously saved songs', () => {
  assert.equal(sourceUrl('https://youtu.be/abcdefghijk?t=4'), 'https://www.youtube.com/watch?v=abcdefghijk');
  assert.equal(sourceName(sourceUrl('https://music.youtube.com/watch?v=abcdefghijk')), 'YouTube');
});
