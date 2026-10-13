import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { DesktopLifecycle } from '../scripts/desktop-lifecycle.mjs';

class Child extends EventEmitter {
  constructor(autoExit = false) { super(); this.exitCode = null; this.signalCode = null; this.signals = []; this.autoExit = autoExit; }
  kill(signal) { this.signals.push(signal); if (this.autoExit || signal === 'SIGKILL') queueMicrotask(() => this.finish()); return true; }
  finish() { this.exitCode = 0; this.emit('close', 0, null); }
}
test('full relaunch waits for the old desktop and coalesces source changes during shutdown', async () => {
  const old = new Child(), fresh = new Child(true), launches = []; let exits = 0;
  const desktop = new DesktopLifecycle({ launch: () => { const child = launches.length ? fresh : old; launches.push(child); return child; }, onExit: () => exits++ });
  desktop.start(); const first = desktop.restart(), second = desktop.restart();
  assert.deepEqual(old.signals, ['SIGTERM']); assert.equal(launches.length, 1);
  old.finish(); await Promise.all([first, second]);
  assert.equal(launches.length, 2); assert.equal(desktop.child, fresh); assert.equal(exits, 0);
  await desktop.stop(); assert.deepEqual(fresh.signals, ['SIGTERM']);
});
test('stopping during a relaunch never creates another desktop', async () => {
  const old = new Child(); let launches = 0;
  const desktop = new DesktopLifecycle({ launch: () => { launches++; return old; } });
  desktop.start(); const restarting = desktop.restart(), stopping = desktop.stop();
  old.finish(); await Promise.all([restarting, stopping]);
  assert.equal(launches, 1); assert.equal(desktop.child, null);
});
test('a desktop that fails to exit is terminated before the replacement launches', async () => {
  const old = new Child(), fresh = new Child(true); let launches = 0;
  const desktop = new DesktopLifecycle({ launch: () => launches++ ? fresh : old, shutdownTimeoutMs: 10 });
  desktop.start(); await desktop.restart();
  assert.deepEqual(old.signals, ['SIGTERM', 'SIGKILL']); assert.equal(desktop.child, fresh);
  await desktop.stop();
});
test('an ordinary app exit is reported instead of silently reopening the app', async () => {
  const old = new Child(); const exits = [];
  const desktop = new DesktopLifecycle({ launch: () => old, onExit: (code, signal) => exits.push({ code, signal }) });
  desktop.start(); old.finish();
  assert.deepEqual(exits, [{ code: 0, signal: null }]); assert.equal(desktop.child, null);
  await desktop.stop();
});
