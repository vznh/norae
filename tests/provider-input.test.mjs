import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { inspect } from '../electron/providers.mjs';

async function inspectFixture(t, info) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'norae-inspect-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const command = path.join(directory, 'downloader.mjs');
  await writeFile(command, `#!/usr/bin/env node\nconsole.log(${JSON.stringify(JSON.stringify(info))});\n`, { mode: 0o700 });
  return inspect('https://on.soundcloud.com/fixture', { ytDlp: command }, new AbortController().signal, {});
}
test('short links resolving to collections are rejected during inspection before any extraction or transcription', async t => {
  await assert.rejects(inspectFixture(t, { _type: 'playlist', duration: 30, entries: [] }), /single track/);
});
test('preview-only tracks are rejected before paid processing, while full streams are accepted', async t => {
  await assert.rejects(inspectFixture(t, { title: 'Home', duration: 180, formats: [{ format_id: 'hls_mp3_128_preview' }] }), /Only a preview/);
  assert.deepEqual(await inspectFixture(t, { track: 'Home', artists: ['Singer'], duration: 180, formats: [{ format_id: 'hls_mp3_128_preview' }, { format_id: 'http_aac_160' }] }), { title: 'Home', artist: 'Singer', duration: 180, originalMetadata: { title: 'Home', artist: 'Singer' } });
});
