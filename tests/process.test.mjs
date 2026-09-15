import test from 'node:test';
import assert from 'node:assert/strict';
import { run } from '../electron/process.mjs';

test('subprocess arguments are passed literally without shell evaluation', async () => {
  const text = '$(touch should-not-exist); echo nope';
  assert.equal(await run(process.execPath, ['-e', 'process.stdout.write(process.argv[1])', text]), text);
});
test('subprocess timeout terminates work and reports a useful error', async () => {
  await assert.rejects(run(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { timeout: 50 }), /timed out/);
});
test('subprocess output is bounded', async () => {
  await assert.rejects(run(process.execPath, ['-e', 'process.stdout.write("a".repeat(10000))'], { maxOutput: 100 }), /size limit/);
});
test('subprocess cancellation rejects immediately if already cancelled', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(run(process.execPath, ['-e', 'process.exit(0)'], { signal: controller.signal }), /Cancelled/);
});
