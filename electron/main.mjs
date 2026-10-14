import { app, BrowserWindow, ipcMain, protocol, dialog, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { QueueEngine } from './engine.mjs';
import { defaultSettings, checkDependencies } from './providers.mjs';
import { validateFont } from './timing.mjs';
import { saveTimingProject } from './video.mjs';
import { audioResponse } from './audio.mjs';
import { exportIssue } from '../shared/timing-validation.mjs';
import { configureMetadataHelper } from './metadata.mjs';
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
    if (app.isPackaged) configureMetadataHelper(path.join(process.resourcesPath, 'native/norae-metadata'));
    const userData = app.getPath('userData'); await mkdir(userData, { recursive: true });
    const settingsPath = path.join(userData, 'settings.json');
    let saved = {}; try { saved = JSON.parse(await readFile(settingsPath, 'utf8')); } catch {}
    let settings = validateSettings({ ...defaultSettings, ...saved });
    if (saved.lyricsProvider && saved.lyricsProvider !== settings.lyricsProvider) await writeFile(settingsPath, JSON.stringify(settings, null, 2));
    const localModel = path.resolve(directory, '../.models/ggml-base.bin');
    if (!settings.model) { try { await stat(localModel); settings.model = localModel; } catch {} }
    const library = path.join(userData, 'library');
    engine = await QueueEngine.open({ root: path.join(library, 'audio'), persistencePath: path.join(library, 'queue.json'), settings });
    protocol.handle('norae-audio', request => {
      const url = new URL(request.url);
      const track = url.hostname === 'track' && engine.tracks.find(track => track.id === url.pathname.slice(1));
      if (!track?.audioPath || !['GET', 'HEAD'].includes(request.method)) return new Response('Not found', { status: 404 });
      return audioResponse(request, track.audioPath);
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
    handle('room:reorder', (id, index) => engine.reorder(id, index));
    handle('room:retry', id => engine.retry(id));
    handle('room:retryLyrics', id => engine.retryLyrics(id));
    handle('room:lyrics', (id, candidateId) => engine.selectLyrics(id, candidateId));
    handle('room:align', id => engine.align(id));
    handle('room:timing', (id, input) => engine.saveTiming(id, input));
    handle('room:replaceLyrics', (id, text) => engine.replaceLyrics(id, text));
    const selectedTrack = id => { const track = engine.tracks.find(track => track.id === id); if (!track) throw new Error('Select a song first.'); return track; };
    handle('room:export', async id => {
      const track = selectedTrack(id);
      const issue = exportIssue(track); if (issue) throw new Error(issue);
      const result = await dialog.showSaveDialog(window, { title: 'Export karaoke video', defaultPath: `${track.title.replace(/[^\w .-]/g, '').slice(0, 100) || 'karaoke'}.mp4`, filters: [{ name: '1080p karaoke video', extensions: ['mp4'] }] });
      return result.canceled ? null : engine.exportVideo(id, result.filePath);
    });
    handle('room:cancelExport', id => engine.cancelExport(id));
    handle('room:saveProject', async id => {
      const track = selectedTrack(id);
      const result = await dialog.showSaveDialog(window, { title: 'Save lyric timing', defaultPath: `${track.title.replace(/[^\w .-]/g, '').slice(0, 100) || 'karaoke'}.norae.json`, filters: [{ name: 'Norae timing project', extensions: ['json'] }] });
      return result.canceled ? null : saveTimingProject(track, result.filePath);
    });
    handle('room:loadProject', async id => {
      const track = selectedTrack(id);
      const result = await dialog.showOpenDialog(window, { title: 'Load lyric timing for this recording', properties: ['openFile'], filters: [{ name: 'Norae timing project', extensions: ['json'] }] });
      if (result.canceled) return false;
      if ((await stat(result.filePaths[0])).size > 2000000) throw new Error('The timing project is too large.');
      const data = JSON.parse(await readFile(result.filePaths[0], 'utf8'));
      if (data.version !== 1 || !Number.isFinite(data.duration) || (data.url ? data.url !== track.url : data.title !== track.title) || Math.abs(data.duration - track.duration) > .1) throw new Error('Load timing for this exact recording and duration.');
      engine.saveTiming(id, { lines: data.lines, font: data.font, reviewed: false }); return true;
    });
    handle('settings:get', () => settings);
    handle('settings:save', async input => { settings = validateSettings(input); await writeFile(settingsPath, JSON.stringify(settings, null, 2)); engine.settings = settings; return settings; });
    handle('settings:check', () => checkDependencies(settings));
    handle('settings:model', async () => { const result = await dialog.showOpenDialog(window, { title: 'Choose a ggml Whisper model', properties: ['openFile'], filters: [{ name: 'Whisper ggml model', extensions: ['bin'] }] }); return result.canceled ? null : result.filePaths[0]; });
    handle('settings:credentials', async () => { const result = await dialog.showOpenDialog(window, { title: 'Choose a credentials dotenv file', properties: ['openFile'], showHiddenFiles: true }); return result.canceled ? null : result.filePaths[0]; });
    handle('window:fullscreen', enabled => window.setFullScreen(Boolean(enabled)));
    engine.on('change', tracks => { if (window && !window.isDestroyed()) window.webContents.send('room:changed', tracks); });
    engine.on('storage-error', message => { if (window && !window.isDestroyed()) window.webContents.send('room:storageError', message); });
    createWindow();
    void engine.enrichSavedMetadata().catch(error => { if (!quitting) console.error('Saved song title cleanup could not finish:', error.message); });
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  }).catch(error => { console.error(error); app.quit(); });
  app.on('window-all-closed', () => app.quit());
  process.on('SIGTERM', () => app.quit());
  app.on('before-quit', event => {
    if (quitting || !engine) return;
    event.preventDefault(); quitting = true;
    engine.close().then(() => app.quit()).catch(error => { quitting = false; dialog.showErrorBox('Queue could not be saved', `${error.message}\nKeep Norae open and save timing projects before quitting.`); });
  });
}
function createWindow() {
  window = new BrowserWindow({ title: 'Norae', width: 1440, height: 980, minWidth: 1040, minHeight: 720, backgroundColor: '#ffffff', titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 22, y: 19 }, webPreferences: { preload: path.join(directory, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false } });
  window.webContents.once('did-finish-load', () => console.log('Norae desktop ready · LRCLIB lyrics'));
  window.webContents.setWindowOpenHandler(({ url }) => { if (url === 'https://github.com/vznh/norae') void shell.openExternal(url); return { action: 'deny' }; });
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  if (devUrl) window.loadURL(devUrl); else window.loadFile(path.join(directory, '../dist/index.html'));
}
function validateSettings(input) {
  input = { ...input, lyricsProvider: 'lrclib' };
  const result = {};
  for (const key of Object.keys(defaultSettings)) {
    if (typeof input?.[key] !== 'string' || input[key].length > 4096 || input[key].includes('\0')) throw new Error(`Invalid ${key} setting.`);
    result[key] = input[key].trim();
    if (!['model', 'credentialsFile'].includes(key) && !result[key]) throw new Error(`${key} cannot be empty.`);
  }
  result.language = 'en';
  if (!['elevenlabs', 'whisper'].includes(result.transcriptionProvider)) throw new Error('Invalid transcription provider.');
  validateFont(result.font);
  return result;
}
