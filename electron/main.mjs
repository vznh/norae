import { app, BrowserWindow, ipcMain, protocol, net, dialog } from 'electron';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdir, mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { QueueEngine } from './engine.mjs';
import { defaultSettings, checkDependencies } from './providers.mjs';
const directory = path.dirname(fileURLToPath(import.meta.url));
const devUrl = process.env.NORAE_DEV_URL;
if (devUrl && !/^http:\/\/127\.0\.0\.1:\d+$/.test(devUrl)) throw new Error('Invalid development URL.');
if (process.env.NORAE_TEST_DATA) app.setPath('userData', process.env.NORAE_TEST_DATA);
protocol.registerSchemesAsPrivileged([{ scheme: 'norae-audio', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);
const hasLock = app.requestSingleInstanceLock();
let window, engine, quitting = false;
if (!hasLock) app.quit();
else {
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.focus(); } });
  app.whenReady().then(async () => {
    const userData = app.getPath('userData'); await mkdir(userData, { recursive: true });
    const settingsPath = path.join(userData, 'settings.json');
    let saved = {}; try { saved = JSON.parse(await readFile(settingsPath, 'utf8')); } catch {}
    let settings = validateSettings({ ...defaultSettings, ...saved });
    const localModel = path.resolve(directory, '../.models/ggml-base.bin');
    if (!settings.model) { try { await stat(localModel); settings.model = localModel; } catch {} }
    const cacheRoot = path.join(userData, 'temporary-audio');
    // Single-instance lock is held; remove leftovers from an interrupted previous session.
    await rm(cacheRoot, { recursive: true, force: true }); await mkdir(cacheRoot, { recursive: true });
    engine = new QueueEngine({ root: await mkdtemp(path.join(cacheRoot, 'session-')), settings });
    protocol.handle('norae-audio', request => {
      const url = new URL(request.url);
      const track = url.hostname === 'track' && engine.tracks.find(track => track.id === url.pathname.slice(1));
      if (!track?.audioPath || !['GET', 'HEAD'].includes(request.method)) return new Response('Not found', { status: 404 });
      return net.fetch(pathToFileURL(track.audioPath).href, { method: request.method, headers: request.headers });
    });
    const handle = (channel, fn) => ipcMain.handle(channel, (event, ...args) => {
      if (event.sender !== window?.webContents || event.senderFrame !== window?.webContents.mainFrame) throw new Error('Untrusted sender.');
      return fn(...args);
    });
    handle('room:snapshot', () => engine.snapshot());
    handle('room:add', input => engine.add(input));
    handle('room:demo', () => engine.demo());
    handle('room:remove', id => engine.remove(id));
    handle('room:move', (id, direction) => engine.move(id, direction));
    handle('room:retry', id => engine.retry(id));
    handle('room:lyrics', (id, candidateId) => engine.selectLyrics(id, candidateId));
    handle('settings:get', () => settings);
    handle('settings:save', async input => { settings = validateSettings(input); await writeFile(settingsPath, JSON.stringify(settings, null, 2)); engine.settings = settings; return settings; });
    handle('settings:check', () => checkDependencies(settings));
    handle('settings:model', async () => { const result = await dialog.showOpenDialog(window, { title: 'Choose a ggml Whisper model', properties: ['openFile'], filters: [{ name: 'Whisper ggml model', extensions: ['bin'] }] }); return result.canceled ? null : result.filePaths[0]; });
    handle('window:fullscreen', enabled => window.setFullScreen(Boolean(enabled)));
    engine.on('change', tracks => { if (window && !window.isDestroyed()) window.webContents.send('room:changed', tracks); });
    createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  }).catch(error => { console.error(error); app.quit(); });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', event => {
    if (quitting || !engine) return;
    event.preventDefault(); quitting = true; engine.close().finally(() => app.quit());
  });
}
function createWindow() {
  window = new BrowserWindow({ title: 'Norae', width: 1440, height: 980, minWidth: 1040, minHeight: 720, backgroundColor: '#ffffff', titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 22, y: 22 }, webPreferences: { preload: path.join(directory, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  if (devUrl) window.loadURL(devUrl); else window.loadFile(path.join(directory, '../dist/index.html'));
}
function validateSettings(input) {
  const result = {};
  for (const key of Object.keys(defaultSettings)) {
    if (typeof input?.[key] !== 'string' || input[key].length > 4096 || input[key].includes('\0')) throw new Error(`Invalid ${key} setting.`);
    result[key] = input[key].trim();
    if (key !== 'model' && !result[key]) throw new Error(`${key} cannot be empty.`);
  }
  if (!/^(auto|[a-z]{2,3})$/.test(result.language)) throw new Error('Language must be auto or a language code, such as en or ko.');
  return result;
}
