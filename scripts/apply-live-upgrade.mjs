import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { connectInspector, disableRelaunchWatcher } from './inspector-client.mjs';

const execute = promisify(execFile), options = Object.fromEntries(process.argv.slice(2).map(arg => arg.replace(/^--/, '').split(/=(.*)/s).slice(0, 2)));
const launcherPid = Number(options.launcher), desktopPid = Number(options.desktop), userData = options['user-data'];
const project = path.resolve('.');
if (!Number.isSafeInteger(launcherPid) || !Number.isSafeInteger(desktopPid) || !path.isAbsolute(userData || '')) throw new Error('Supply the exact launcher PID, desktop PID, and user-data directory.');
const cwd = (await execute('lsof', ['-a', '-p', String(launcherPid), '-d', 'cwd', '-Fn'])).stdout.split('\n').find(line => line.startsWith('n'))?.slice(1);
const parent = (await execute('ps', ['-p', String(desktopPid), '-o', 'ppid='])).stdout.trim();
if (cwd !== project || Number(parent) !== launcherPid) throw new Error('The process IDs do not identify this project’s live Norae instance.');
let client;
try {
  if (options.finish !== 'true') {
    try {
      const listener = (await execute('lsof', ['-nP', '-iTCP:9229', '-sTCP:LISTEN', '-t'])).stdout.trim();
      if (listener && listener !== String(launcherPid)) throw new Error('Another process owns inspector port 9229.');
    } catch (error) { if (error.code !== 1) throw error; }
    process.kill(launcherPid, 'SIGUSR1'); process.kill(launcherPid, 'SIGCONT');
  }
  const deadline = Date.now() + 2000;
  while (!client) { try { client = await connectInspector(9229, launcherPid); } catch (error) { if (Date.now() > deadline) throw error; await new Promise(resolve => setTimeout(resolve, 10)); } }
  if (options.finish === 'true') {
    const state = await client.call('Runtime.evaluate', { expression: 'globalThis.__noraeUpgrade?.state', returnByValue: true });
    if (state.result.value?.phase !== 'saved') throw new Error('The live queue has not been saved; the desktop will remain open.');
    const stopped = await client.call('Runtime.evaluate', { expression: 'globalThis.__noraeUpgradeDesktop.stop().then(()=>globalThis.__noraeUpgradeServer.close()).then(()=>true)', awaitPromise: true, returnByValue: true });
    if (stopped.exceptionDetails || stopped.result.value !== true) throw new Error('The old desktop did not close cleanly.');
    console.log('Saved legacy desktop closed; the persistent library is ready for the updated app.');
  } else {
    await disableRelaunchWatcher(client, path.join(project, 'scripts/dev.mjs'));
    const installed = await client.call('Runtime.evaluate', {
      expression: `globalThis.__noraeUpgrade = process.getBuiltinModule('node:module').createRequire(${JSON.stringify(path.join(project, 'scripts/dev.mjs'))})(${JSON.stringify(path.join(project, 'scripts/legacy-upgrade.mjs'))}).installLegacyUpgrade(globalThis.__noraeUpgradeServer, {userData:${JSON.stringify(userData)}}); globalThis.__noraeUpgradeServer.ws.send({type:'full-reload',path:'*'}); true`,
      returnByValue: true,
    });
    if (installed.exceptionDetails) throw new Error('Could not install the queue migration route. The desktop has not been closed.');
    for (let attempt = 0; attempt < 60; attempt++) {
      const result = await client.call('Runtime.evaluate', { expression: 'globalThis.__noraeUpgrade.state', returnByValue: true });
      const state = result.result.value;
      if (state.phase === 'saved') { console.log(JSON.stringify(state)); break; }
      if (state.phase === 'error') throw new Error(state.error);
      if (attempt === 59) console.log(JSON.stringify({ ...state, note: 'Migration remains active; keep the desktop open.' }));
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
} catch (error) {
  // A failed attach must never let the old queued restart discard the queue.
  if (options.finish !== 'true') process.kill(launcherPid, 'SIGSTOP');
  throw error;
} finally { client?.close(); }
