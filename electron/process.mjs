import { spawn } from 'node:child_process';

export function run(command, args, { signal, timeout = 120_000, maxOutput = 8_000_000 } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('Cancelled.'));
    const child = spawn(command, args, { shell: false, windowsHide: true, detached: process.platform !== 'win32', env: { ...process.env, PATH: `${process.env.PATH || ''}:/opt/homebrew/bin:/usr/local/bin` } });
    let stdout = '', stderr = '', failure, killTimer;
    const kill = (signal) => {
      try {
        if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, signal);
        else if (signal === 'SIGKILL' && child.pid) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on('error', () => {});
        else child.kill(signal);
      } catch { /* The process may have exited before cancellation. */ }
    };
    const stop = (message) => { if (failure) return; failure = new Error(message); kill('SIGTERM'); killTimer = setTimeout(() => kill('SIGKILL'), 2000); };
    const timer = setTimeout(() => stop('This step timed out. Retry the track.'), timeout);
    const abort = () => stop('Cancelled.');
    signal?.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', chunk => { if (failure) return; stdout += chunk; if (stdout.length > maxOutput) stop('Tool output exceeded the size limit.'); });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-12000); });
    const cleanup = () => { clearTimeout(timer); clearTimeout(killTimer); signal?.removeEventListener('abort', abort); };
    child.on('error', error => { cleanup(); reject(new Error(error.code === 'ENOENT' ? `${command} is not installed. Open Settings for setup instructions.` : error.message)); });
    child.on('close', code => { cleanup(); if (failure) reject(failure); else if (code !== 0) reject(new Error(stderr.trim().slice(-1800) || `${command} exited with code ${code}.`)); else resolve(stdout); });
  });
}
