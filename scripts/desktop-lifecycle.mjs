// Restart serially: the old Electron process must close before another starts.
export class DesktopLifecycle {
  constructor({ launch, onExit = () => {}, onError = () => {}, shutdownTimeoutMs = 3000 }) {
    this.launch = launch; this.onExit = onExit; this.onError = onError; this.shutdownTimeoutMs = shutdownTimeoutMs;
    this.child = null; this.closed = false; this.pendingRestart = false; this.restartJob = null;
    this.intentionalStops = new WeakSet(); this.stopJobs = new WeakMap();
  }
  start() {
    if (this.closed || this.child) return;
    const child = this.launch(); this.child = child;
    child.once('error', error => this.onError(error));
    child.once('close', (code, signal) => {
      if (this.child === child) this.child = null;
      if (!this.intentionalStops.has(child)) this.onExit(code, signal);
    });
  }
  restart() {
    if (this.closed) return Promise.resolve();
    this.pendingRestart = true;
    if (this.restartJob) return this.restartJob;
    this.restartJob = (async () => {
      while (this.pendingRestart && !this.closed) {
        this.pendingRestart = false;
        await this.stopChild();
        if (this.closed) break;
        // Changes arriving during shutdown are included in this fresh launch.
        this.pendingRestart = false;
        this.start();
      }
    })().finally(() => { this.restartJob = null; });
    return this.restartJob;
  }
  stopChild() {
    const child = this.child;
    if (!child) return Promise.resolve();
    const existing = this.stopJobs.get(child);
    if (existing) return existing;
    if (child.exitCode !== null || child.signalCode !== null) { this.child = null; return Promise.resolve(); }
    this.intentionalStops.add(child);
    const job = new Promise(resolve => {
      const timer = setTimeout(() => child.kill('SIGKILL'), this.shutdownTimeoutMs);
      child.once('close', () => { clearTimeout(timer); resolve(); });
      child.kill('SIGTERM');
    });
    this.stopJobs.set(child, job);
    return job;
  }
  async stop() {
    this.closed = true; this.pendingRestart = false;
    await this.stopChild();
    await this.restartJob;
  }
}
