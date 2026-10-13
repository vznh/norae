import { mkdir, readFile, rename, open, lstat } from 'node:fs/promises';
import path from 'node:path';

const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const AUDIO_FILE = /^(?:audio|demo)\.(?:mp3|wav|m4a|ogg|opus)$/;
const FIELDS = ['id', 'url', 'title', 'artist', 'singer', 'duration', 'status', 'steps', 'candidates', 'lyrics', 'transcript', 'result', 'error', 'overrides', 'demo', 'font', 'reviewed', 'export', 'originalMetadata', 'metadataEnrichment'];

export class QueueStore {
  constructor({ file, audioRoot }) { this.file = file; this.audioRoot = audioRoot; this.pending = Promise.resolve(); }
  save(tracks) {
    const records = tracks.map(track => {
      const record = Object.fromEntries(FIELDS.filter(field => track[field] !== undefined).map(field => [field, track[field]]));
      if (track.audioPath) {
        const filename = path.basename(track.audioPath);
        if (!UUID.test(track.id) || !AUDIO_FILE.test(filename) || path.resolve(track.audioPath) !== path.resolve(this.audioRoot, track.id, filename)) throw new Error('Queue audio must stay inside the local library.');
        record.audioFile = filename;
      }
      return record;
    });
    // Capture now, before another progress update mutates the live tracks.
    const data = JSON.stringify({ version: 1, tracks: records });
    this.pending = this.pending.catch(() => {}).then(async () => {
      await mkdir(path.dirname(this.file), { recursive: true });
      const temporary = `${this.file}.tmp`, file = await open(temporary, 'w', 0o600);
      try { await file.writeFile(data); await file.sync(); } finally { await file.close(); }
      await rename(temporary, this.file);
    });
    return this.pending;
  }
  flush() { return this.pending; }
  async load() {
    let data;
    try { data = await readFile(this.file, 'utf8'); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    if (Buffer.byteLength(data) > 30_000_000) throw new Error('Saved queue is too large; the file has been left intact.');
    const saved = JSON.parse(data);
    if (saved.version !== 1 || !Array.isArray(saved.tracks) || saved.tracks.length > 30) throw new Error('Unsupported saved queue; the file has been left intact.');
    const ids = new Set(), tracks = [];
    for (const record of saved.tracks) {
      if (!UUID.test(record?.id) || ids.has(record.id) || record.audioFile && !AUDIO_FILE.test(record.audioFile)) throw new Error('Invalid saved track; the queue file has been left intact.');
      if (!record.steps || !Array.isArray(record.candidates) || !Array.isArray(record.transcript)) throw new Error('Incomplete saved track; the queue file has been left intact.');
      ids.add(record.id);
      const track = Object.fromEntries(FIELDS.filter(field => record[field] !== undefined).map(field => [field, record[field]]));
      track.directory = path.join(this.audioRoot, track.id);
      track.audioPath = null; track.audioUrl = null;
      if (record.audioFile) {
        const audio = path.join(track.directory, record.audioFile);
        try { const info = await lstat(audio); if (info.isFile() && !info.isSymbolicLink()) { track.audioPath = audio; track.audioUrl = `norae-audio://track/${track.id}`; } }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
      const interrupted = ['queued', 'processing'].includes(track.status) || track.error === 'Cancelled.';
      for (const step of Object.values(track.steps)) if (step.state === 'running') { step.state = 'error'; step.message = 'Interrupted by relaunch. Completed work is saved; retry only when ready.'; }
      if (interrupted) {
        track.status = track.audioPath && track.result?.lines?.length ? 'review' : 'error';
        track.error = 'Processing was interrupted by relaunch. Completed work was kept; no API requests were restarted.';
      }
      if (record.audioFile && !track.audioPath) { track.status = 'error'; track.error = 'Saved audio is missing. The lyrics and timing were retained.'; }
      if (track.export?.state === 'running') track.export = { state: 'cancelled', progress: 0, message: 'Export interrupted by relaunch; song timing is saved.' };
      tracks.push(track);
    }
    return tracks;
  }
}
