import { _electron as electron } from 'playwright';
import { createServer } from 'vite';
import { mkdtemp, mkdir, copyFile, writeFile, rm, access } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { QueueEngine } from '../electron/engine.mjs';
import { QueueStore } from '../electron/queue-store.mjs';
import { installLegacyUpgrade } from './legacy-upgrade.mjs';

const userData = await mkdtemp(path.join(os.tmpdir(), 'norae-live-upgrade-'));
let app, server;
try {
  const root = path.join(userData, 'temporary-audio/session-fixture'), fixture = new QueueEngine({ root, settings: {} });
  await fixture.demo();
  const first = fixture.tracks[0], id = randomUUID(), directory = path.join(root, id), audioPath = path.join(directory, 'demo.wav');
  await mkdir(directory, { recursive: true }); await copyFile(first.audioPath, audioPath);
  fixture.tracks.push({ ...structuredClone(first), id, title: 'Second cached original', directory, audioPath, audioUrl: `norae-audio://track/${id}`, font: 'Verdana', reviewed: true });
  const before = fixture.snapshot(), fixtureFile = path.join(userData, 'fixture.json'); await writeFile(fixtureFile, JSON.stringify(fixture.tracks));
  server = await createServer({ root: path.resolve('.'), server: { host: '127.0.0.1', port: 0 } }); await server.listen();
  const url = `http://127.0.0.1:${server.httpServer.address().port}`, entry = path.join(userData, 'legacy.mjs');
  await writeFile(entry, `import{app,BrowserWindow,ipcMain,protocol}from'electron';import{readFile}from'node:fs/promises';import{QueueEngine}from${JSON.stringify(path.resolve('electron/engine.mjs'))};import{audioResponse}from${JSON.stringify(path.resolve('electron/audio.mjs'))};app.setPath('userData',${JSON.stringify(userData)});protocol.registerSchemesAsPrivileged([{scheme:'norae-audio',privileges:{standard:true,secure:true,supportFetchAPI:true,stream:true}}]);let engine,quitting=false;app.whenReady().then(async()=>{engine=new QueueEngine({root:${JSON.stringify(root)},settings:{}});engine.tracks=JSON.parse(await readFile(${JSON.stringify(fixtureFile)},'utf8'));ipcMain.handle('room:snapshot',()=>engine.snapshot());ipcMain.handle('settings:check',()=>[]);protocol.handle('norae-audio',req=>audioResponse(req,engine.tracks.find(t=>t.id===new URL(req.url).pathname.slice(1))?.audioPath));const window=new BrowserWindow({width:1440,height:980,webPreferences:{preload:${JSON.stringify(path.resolve('electron/preload.cjs'))},contextIsolation:true,sandbox:true,nodeIntegration:false}});window.loadURL(${JSON.stringify(url)});});app.on('before-quit',event=>{if(quitting)return;event.preventDefault();quitting=true;engine.close().then(()=>app.quit());});`);
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ args: [entry], cwd: path.resolve('.'), env });
  let page = await app.firstWindow(); await page.getByRole('heading', { name: 'A little louder', exact: true }).waitFor();
  const upgrade = installLegacyUpgrade(server, { userData });
  server.ws.send({ type: 'full-reload', path: '*' });
  const deadline = Date.now() + 20000;
  while (upgrade.state.phase !== 'saved') { if (upgrade.state.phase === 'error') throw new Error(upgrade.state.error); if (Date.now() > deadline) throw new Error('The renderer did not save its legacy queue'); await new Promise(resolve => setTimeout(resolve, 100)); }
  assert.equal(upgrade.state.tracks, 2); assert.equal(upgrade.state.recordings, 2);
  const closed = app.waitForEvent('close'); await app.evaluate(({ app }) => { setTimeout(() => app.quit(), 0); }); await closed; app = null;
  await assert.rejects(access(first.audioPath));
  const store = new QueueStore({ file: path.join(userData, 'library/queue.json'), audioRoot: path.join(userData, 'library/audio') });
  assert.equal((await store.load()).length, 2);
  app = await electron.launch({ args: ['.'], cwd: path.resolve('.'), env: { ...env, NORAE_TEST_DATA: userData, NORAE_DEV_URL: '' } });
  page = await app.firstWindow(); await page.getByRole('heading', { name: 'A little louder', exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.norae.snapshot()), before);
  await app.evaluate(() => { globalThis.providerCalls = 0; globalThis.fetch = async () => { globalThis.providerCalls++; throw new Error('Upgrade must not call providers'); }; });
  await page.getByRole('slider', { name: 'Playback position' }).fill('4');
  await page.waitForFunction(() => Math.abs(document.querySelector('audio').currentTime - 4) < .1 && !document.querySelector('audio').seeking);
  await page.getByRole('button', { name: 'Select Second cached original', exact: true }).click();
  await page.getByRole('slider', { name: 'Playback position' }).fill('4');
  await page.waitForFunction(() => Math.abs(document.querySelector('audio').currentTime - 4) < .1 && !document.querySelector('audio').seeking);
  assert.equal(await app.evaluate(() => globalThis.providerCalls), 0);
  console.log('Live upgrade passed: renderer saves both legacy songs, old cache deletion is harmless, fresh desktop restores exact timing/font/queue and seeks to 0:04; no provider calls or previews');
} finally { if (app) await app.close(); if (server) await server.close(); await rm(userData, { recursive: true, force: true }); }
