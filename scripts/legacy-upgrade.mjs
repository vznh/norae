import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, readdir, lstat, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { QueueStore } from '../electron/queue-store.mjs';

const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const AUDIO_FILE = /^(?:audio|demo)\.(?:mp3|wav|m4a|ogg|opus)$/;

export async function migrateLegacyQueue(tracks, { userData }) {
  if (!Array.isArray(tracks) || tracks.length > 30) throw new Error('Invalid legacy queue.');
  if (new Set(tracks.map(track => track.id)).size !== tracks.length) throw new Error('Duplicate legacy track IDs.');
  const library = path.join(userData, 'library'), root = path.join(library, 'audio');
  const store = new QueueStore({ file: path.join(library, 'queue.json'), audioRoot: root });
  const existing = await store.load();
  if (existing.length && JSON.stringify(existing.map(track => track.id)) !== JSON.stringify(tracks.map(track => track.id))) throw new Error('A different saved library already exists. Keep both queues open for review.');
  const legacyRoot = path.join(userData, 'temporary-audio');
  let sessions = [];
  try { sessions = (await readdir(legacyRoot, { withFileTypes: true })).filter(entry => entry.isDirectory() && /^session-[a-z0-9]+$/i.test(entry.name)); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const migrated = [];
  for (const track of tracks) {
    if (!UUID.test(track.id) || !track.steps || !Array.isArray(track.candidates) || !Array.isArray(track.transcript)) throw new Error('Invalid legacy track.');
    if (['queued', 'processing'].includes(track.status) || track.export?.state === 'running' || Object.values(track.steps).some(step => step.state === 'running')) throw new Error('Wait for current processing or export to finish before upgrading.');
    const next = structuredClone(track); delete next.audioPath; delete next.directory;
    if (track.audioUrl) {
      if (track.audioUrl !== `norae-audio://track/${track.id}`) throw new Error('Unexpected legacy audio URL.');
      const sources = [];
      for (const session of sessions) {
        const directory = path.join(legacyRoot, session.name, track.id);
        try {
          const directoryInfo = await lstat(directory);
          if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) continue;
          for (const filename of await readdir(directory)) if (AUDIO_FILE.test(filename)) {
            const file = path.join(directory, filename), info = await lstat(file);
            if (info.isFile() && !info.isSymbolicLink()) sources.push({ file, filename, size: info.size });
          }
        } catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
      if (sources.length !== 1) throw new Error('Could not identify exactly one cached recording. The live queue has not been closed.');
      const source = sources[0]; next.directory = path.join(root, track.id); next.audioPath = path.join(next.directory, source.filename);
      await mkdir(next.directory, { recursive: true });
      try { await copyFile(source.file, next.audioPath, constants.COPYFILE_EXCL); }
      catch (error) { if (error.code !== 'EEXIST') throw error; const info = await lstat(next.audioPath); if (!info.isFile() || info.isSymbolicLink() || info.size !== source.size) throw new Error('Existing library audio differs; the live queue has not been closed.'); }
    }
    migrated.push(next);
  }
  await store.save(migrated);
  const restored = await store.load();
  if (restored.length !== tracks.length || restored.some((track, i) => track.id !== tracks[i].id || Boolean(track.audioPath) !== Boolean(tracks[i].audioUrl))) throw new Error('The restored queue failed verification. Keep the live app open.');
  return { tracks: restored.length, recordings: restored.filter(track => track.audioPath).length };
}

// Available only during a one-time upgrade of a development instance. The
// desktop supplies its normal public snapshot; settings never cross this route.
export function installLegacyUpgrade(server, options) {
  const token = randomUUID(), state = { phase: 'waiting', tracks: 0, recordings: 0, error: '' };
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  let saving = null;
  const middlewareIndex = server.middlewares.stack.length;
  server.middlewares.use('/__norae-upgrade', (request, response) => {
    response.setHeader('Content-Type', 'application/json'); response.setHeader('Cache-Control', 'no-store');
    const reply = (status, body) => { response.statusCode = status; response.end(JSON.stringify(body)); };
    if (request.method === 'GET') return reply(200, { token, ...state });
    if (request.method !== 'POST' || request.headers.origin !== origin || request.headers['x-norae-upgrade'] !== token) return reply(403, { error: 'Untrusted upgrade request.' });
    if (saving || state.phase === 'saved') return reply(200, state);
    let body = '', bytes = 0;
    request.on('data', chunk => { bytes += chunk.length; if (bytes > 30_000_000) request.destroy(); else body += chunk; });
    request.on('end', () => {
      state.phase = 'saving';
      saving = Promise.resolve().then(() => migrateLegacyQueue(JSON.parse(body), options))
        .then(result => { Object.assign(state, result, { phase: 'saved', error: '' }); reply(200, state); })
        .catch(error => { Object.assign(state, { phase: 'error', error: error.message }); reply(400, state); })
        .finally(() => { saving = null; });
    });
  });
  // This server is already listening. Put the one-time route ahead of Vite's
  // SPA fallback, which would otherwise answer it with index.html or a 404.
  const [middleware] = server.middlewares.stack.splice(middlewareIndex, 1);
  server.middlewares.stack.unshift(middleware);
  return { state };
}
