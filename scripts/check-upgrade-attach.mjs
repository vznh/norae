import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { connectInspector, disableRelaunchWatcher } from './inspector-client.mjs';

const root = await mkdtemp('/tmp/norae-attach-check-'); let child, client;
try {
  const file = `${root}/dev.mjs`;
  await writeFile(file, `import {watch} from 'node:fs';\nconst watchers=[], server={test:true}, desktop={restart:()=>{console.log('UNSAFE RESTART');return Promise.resolve();}};\nlet stopped=false,restartTimer;\nfunction stop(){stopped=true;clearTimeout(restartTimer);for(const watcher of watchers)watcher.close();server.test=false;}\nfunction sourceChanged(){if(stopped)return;clearTimeout(restartTimer);restartTimer=setTimeout(()=>{\nvoid desktop.restart();\n},350);}\nwatchers.push(watch(${JSON.stringify(root)},sourceChanged));\nprocess.on('SIGTERM',stop);console.log('READY');\n`);
  await writeFile(file, (await readFile(file, 'utf8')) + '\nsetInterval(()=>{},100000);\n');
  child = spawn(process.execPath, ['--inspect-port=9231', file], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; child.stdout.on('data', data => { output += data; });
  await new Promise(resolve => child.stdout.once('data', resolve));
  child.kill('SIGSTOP'); await writeFile(`${root}/change`, 'changed'); child.kill('SIGUSR1'); child.kill('SIGCONT');
  const deadline = Date.now() + 2000;
  while (!client) { try { client = await connectInspector(9231, child.pid); } catch (error) { if (Date.now() > deadline) throw error; await new Promise(resolve => setTimeout(resolve, 10)); } }
  await disableRelaunchWatcher(client, file);
  const value = await client.call('Runtime.evaluate', { expression: 'globalThis.__noraeUpgradeServer.test', returnByValue: true });
  assert.equal(value.result.value, true); assert.equal(output.includes('UNSAFE RESTART'), false);
  console.log('Launcher attach passed: paused watcher disabled before its restart callback; desktop untouched');
} finally { client?.close(); if (child && child.exitCode === null && child.signalCode === null) { const closed = new Promise(resolve => child.once('close', resolve)); child.kill('SIGCONT'); child.kill('SIGKILL'); await closed; } await rm(root, { recursive: true, force: true }); }
