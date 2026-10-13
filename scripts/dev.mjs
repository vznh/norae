import { spawn } from 'node:child_process';
import { watch } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import electron from 'electron';
import { DesktopLifecycle } from './desktop-lifecycle.mjs';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
// Own the server instance: never attach Electron to another app's occupied port.
const server = await createServer({ root: projectRoot, server: { host: '127.0.0.1', port: 0, strictPort: false } });
await server.listen();
const address = server.httpServer.address();
if (!address || typeof address === 'string') throw new Error('Could not start the local renderer.');
const url = `http://127.0.0.1:${address.port}`;
console.log(`Norae desktop renderer: ${url}`);
const desktopEnv = { ...process.env, NORAE_DEV_URL: url };
// IDE terminals can inherit this flag from their own Electron host.
delete desktopEnv.ELECTRON_RUN_AS_NODE;
const watchers = [];
let stopped = false, restartTimer, changedFile = '';
const desktop = new DesktopLifecycle({
  launch: () => spawn(electron, ['.'], { cwd: projectRoot, stdio: 'inherit', env: desktopEnv }),
  onExit: (code, signal) => {
    if (code === 0 || signal) { process.exitCode = code || 0; void stop(); }
    else console.error(`Norae desktop exited with code ${code}. It will relaunch after the next source change.`);
  },
  onError: error => console.error(`Could not launch Norae: ${error.message}`),
});
async function stop() {
  if (stopped) return;
  stopped = true; clearTimeout(restartTimer);
  for (const watcher of watchers) watcher.close();
  await desktop.stop(); await server.close();
}
function sourceChanged(file) {
  if (stopped) return;
  changedFile = file; clearTimeout(restartTimer);
  restartTimer = setTimeout(async () => {
    console.log(`Source changed (${changedFile}) · fully relaunching Norae`);
    void desktop.restart().catch(error => console.error(`Desktop relaunch failed: ${error.message}`));
  }, 350);
}
for (const folder of ['src', 'electron', 'shared']) {
  watchers.push(watch(path.join(projectRoot, folder), { recursive: true }, (_event, filename) => {
    if (filename && /\.(?:[cm]?[jt]sx?|css|svg|json|swift)$/.test(filename.toString())) sourceChanged(`${folder}/${filename}`);
  }));
}
const rootFiles = new Set(['index.html', 'vite.config.ts', 'tsconfig.json', 'package.json']);
watchers.push(watch(projectRoot, (_event, filename) => { if (filename && rootFiles.has(filename.toString())) sourceChanged(filename.toString()); }));
process.on('SIGINT', () => void stop()); process.on('SIGTERM', () => void stop());
console.log('Full desktop relaunch on source changes enabled · songs and timing are saved locally');
desktop.start();
