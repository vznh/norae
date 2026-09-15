import { spawn } from 'node:child_process';
import { createServer } from 'vite';
import electron from 'electron';
// Own the server instance: never attach Electron to another app's occupied port.
const server = await createServer({ server: { host: '127.0.0.1', port: 0, strictPort: false } });
await server.listen();
const address = server.httpServer.address();
if (!address || typeof address === 'string') throw new Error('Could not start the local renderer.');
const url = `http://127.0.0.1:${address.port}`;
console.log(`Norae desktop renderer: ${url}`);
const desktop = spawn(electron, ['.'], { stdio: 'inherit', env: { ...process.env, NORAE_DEV_URL: url } });
let stopped = false;
async function stop() { if (stopped) return; stopped = true; desktop.kill(); await server.close(); }
process.on('SIGINT', () => void stop()); process.on('SIGTERM', () => void stop());
desktop.on('exit', code => { process.exitCode = code || 0; void stop(); });
desktop.on('error', error => { console.error(error); process.exitCode = 1; void stop(); });
