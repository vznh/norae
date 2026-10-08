import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { audioResponse } from '../electron/audio.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'norae-audio-range-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'audio.mp3'); await writeFile(file, '0123456789');
  return file;
}
function request(range, method = 'GET') { return new Request('https://fixture.local/audio', { method, headers: range ? { Range: range } : {} }); }
test('complete audio advertises seek support, MIME type and an exact content length', async t => {
  const response = await audioResponse(request(), await fixture(t));
  assert.equal(response.status, 200); assert.equal(response.headers.get('accept-ranges'), 'bytes');
  assert.equal(response.headers.get('content-length'), '10'); assert.equal(response.headers.get('content-type'), 'audio/mpeg');
  assert.equal(await response.text(), '0123456789');
});
test('bounded, open and suffix seeks return matching partial bytes and 206 headers', async t => {
  const file = await fixture(t);
  for (const [range, content, expected] of [['bytes=2-5', '2345', '2-5'], ['bytes=7-', '789', '7-9'], ['bytes=-3', '789', '7-9'], ['bytes=8-999', '89', '8-9'], ['bytes=-999', '0123456789', '0-9']]) {
    const response = await audioResponse(request(range), file);
    assert.equal(response.status, 206); assert.equal(response.headers.get('content-range'), `bytes ${expected}/10`);
    assert.equal(response.headers.get('content-length'), String(content.length)); assert.equal(await response.text(), content);
  }
});
test('unsatisfiable seeks report 416 without sending a misleading audio body', async t => {
  const file = await fixture(t);
  for (const range of ['bytes=10-', 'bytes=6-2', 'bytes=-0', 'bytes=-', 'bytes=999999999999999999999-']) {
    const response = await audioResponse(request(range), file);
    assert.equal(response.status, 416); assert.equal(response.headers.get('content-range'), 'bytes */10'); assert.equal(await response.text(), '');
  }
});
test('HEAD is bodyless, unsupported ranges use the full file, and missing recordings return 404', async t => {
  const file = await fixture(t), head = await audioResponse(request('bytes=2-5', 'HEAD'), file);
  assert.equal(head.status, 200); assert.equal(head.headers.get('content-length'), '10'); assert.equal(await head.text(), '');
  for (const range of ['items=1-2', 'bytes=1-2,4-5']) assert.equal(await (await audioResponse(request(range), file)).text(), '0123456789');
  assert.equal((await audioResponse(request(), `${file}.missing`)).status, 404);
  assert.equal((await audioResponse(request(undefined, 'POST'), file)).status, 405);
});
test('empty recordings do not open an invalid stream and unsatisfiable ranges report their size', async t => {
  const file = await fixture(t); await writeFile(file, '');
  const full = await audioResponse(request(), file); assert.equal(full.status, 200); assert.equal(await full.text(), '');
  const range = await audioResponse(request('bytes=0-'), file); assert.equal(range.status, 416); assert.equal(range.headers.get('content-range'), 'bytes */0');
});
