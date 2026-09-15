import { randomUUID } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { youtubeUrl, reconcile } from './core.mjs';
import * as providers from './providers.mjs';
import { writeDemo, demoLines } from './demo.mjs';

const step = () => ({ state: 'waiting', message: '' });
const steps = () => ({ audio: step(), lyrics: step(), transcript: step() });
export class QueueEngine extends EventEmitter {
  constructor({ root, settings, services = providers }) {
    super(); this.root = root; this.settings = settings; this.services = services; this.tracks = []; this.jobs = new Map(); this.closed = false;
  }
  snapshot() { return structuredClone(this.tracks.map(({ directory, audioPath, ...track }) => track)); }
  publish() { this.emit('change', this.snapshot()); }
  add(input) {
    if (this.closed) throw new Error('The room is closing.');
    if (!input || typeof input !== 'object') throw new Error('Invalid track.');
    if (this.tracks.length >= 30) throw new Error('This room holds up to 30 tracks. Remove a track first.');
    const url = youtubeUrl(input.url);
    const overrides = {};
    for (const field of ['title', 'artist', 'singer']) {
      if (input[field] !== undefined && typeof input[field] !== 'string') throw new Error(`Invalid ${field}.`);
      overrides[field] = (input[field] || '').trim().slice(0, 200);
    }
    const track = { id: randomUUID(), url, title: overrides.title || 'Reading your track…', artist: overrides.artist || 'YouTube', singer: overrides.singer || 'You', duration: 0, status: 'queued', steps: steps(), candidates: [], lyrics: null, transcript: [], result: null, audioUrl: null, error: '', overrides, demo: false };
    this.tracks.push(track); this.publish(); this.pump(); return track.id;
  }
  async demo() {
    const existing = this.tracks.find(track => track.demo);
    if (existing) return existing.id;
    const id = randomUUID(), directory = path.join(this.root, id);
    await mkdir(directory, { recursive: true });
    const audioPath = path.join(directory, 'demo.wav'); await writeDemo(audioPath);
    const lines = demoLines.map((text, i) => ({ text, start: i * 4 + 3, end: i * 4 + 7, heard: '', agreement: null, review: false, timing: 'demo' }));
    this.tracks.push({ id, title: 'A little louder', artist: 'The Norae demo', singer: 'Everyone', duration: 30, status: 'ready', steps: { audio: { state: 'done', message: 'Original synthesized instrumental' }, lyrics: { state: 'done', message: 'Illustrative original lyrics' }, transcript: { state: 'skipped', message: 'Demo fixture · no transcription performed' } }, candidates: [], lyrics: null, transcript: [], result: { source: 'demo', timing: 'demo', agreement: null, lines, notes: ['Original instrumental and illustrative timed lyrics. This demo does not run the YouTube or transcription pipeline.'] }, audioUrl: `norae-audio://track/${id}`, audioPath, directory, error: '', demo: true });
    this.publish(); return id;
  }
  async remove(id) {
    const track = this.tracks.find(track => track.id === id); if (!track) return;
    this.tracks = this.tracks.filter(track => track.id !== id);
    const job = this.jobs.get(id); job?.controller.abort(); this.publish();
    if (job) await job.promise;
    if (track.directory) await rm(track.directory, { recursive: true, force: true });
  }
  move(id, direction) {
    if (![1, -1].includes(direction)) throw new Error('Invalid queue direction.');
    const index = this.tracks.findIndex(track => track.id === id), next = index + direction;
    if (index < 0 || next < 0 || next >= this.tracks.length) return;
    [this.tracks[index], this.tracks[next]] = [this.tracks[next], this.tracks[index]]; this.publish();
  }
  async retry(id) {
    const track = this.tracks.find(track => track.id === id);
    if (!track || track.demo || this.jobs.has(id)) return;
    if (track.directory) await rm(track.directory, { recursive: true, force: true });
    Object.assign(track, { status: 'queued', steps: steps(), error: '', result: null, lyrics: null, candidates: [], transcript: [], audioUrl: null, audioPath: null });
    this.publish(); this.pump();
  }
  selectLyrics(id, candidateId) {
    const track = this.tracks.find(track => track.id === id);
    if (!track || track.steps.lyrics.state === 'running') throw new Error('Wait until the lyrics search finishes before choosing a recording.');
    const candidate = track.candidates.find(row => row.id === candidateId);
    if (!candidate) throw new Error('Choose a result from this track’s lyrics search.');
    track.lyrics = candidate; track.steps.lyrics = { state: 'done', message: 'LRCLIB version selected by you' };
    if (this.jobs.has(id)) track.result = reconcile(track.lyrics, track.transcript, track.duration); else this.finish(track);
    this.publish();
  }
  finish(track) {
    track.result = reconcile(track.lyrics, track.transcript, track.duration);
    const needsReview = track.result.lines.some(line => line.review) || !track.result.lines.length;
    track.status = needsReview ? 'review' : 'ready';
  }
  pump() {
    if (this.closed || this.jobs.size) return;
    const track = this.tracks.find(track => track.status === 'queued'); if (!track) return;
    const controller = new AbortController();
    const job = { controller, promise: null };
    this.jobs.set(track.id, job);
    job.promise = this.process(track, controller.signal).finally(() => { this.jobs.delete(track.id); this.publish(); this.pump(); });
  }
  async process(track, signal) {
    const settings = { ...this.settings };
    const update = (key, state, message) => { track.steps[key] = { state, message }; this.publish(); };
    try {
      track.status = 'processing'; update('audio', 'running', 'Reading YouTube metadata');
      Object.assign(track, await this.services.inspect(track.url, settings, signal, track.overrides));
      signal.throwIfAborted();
      track.directory = path.join(this.root, track.id); await mkdir(track.directory, { recursive: true });
      update('audio', 'running', 'Extracting a temporary MP3');
      track.audioPath = await this.services.extract(track.url, track.directory, settings, signal);
      signal.throwIfAborted(); track.audioUrl = `norae-audio://track/${track.id}`; update('audio', 'done', 'Temporary MP3 ready');
      // Both branches start after extraction, independently. Neither awaits or reads the other.
      await Promise.allSettled([
        (async () => {
          update('lyrics', 'running', 'Searching LRCLIB');
          try {
            const { candidates, selected } = await this.services.fetchLyrics(track, signal);
            signal.throwIfAborted(); track.candidates = candidates; track.lyrics = selected;
            track.result = reconcile(track.lyrics, track.transcript, track.duration);
            update('lyrics', selected ? 'done' : 'review', selected ? 'Matching lyrics found on LRCLIB' : candidates.length ? 'Choose the matching recording in Cross-check' : 'No matching database lyrics found');
          } catch (error) { update('lyrics', 'error', error.message); }
        })(),
        (async () => {
          update('transcript', 'running', 'Listening locally with Whisper');
          try {
            track.transcript = await this.services.transcribe(track.audioPath, track.directory, settings, signal);
            signal.throwIfAborted(); track.result = reconcile(track.lyrics, track.transcript, track.duration); update('transcript', 'done', `${track.transcript.length} segments transcribed on this device`);
          } catch (error) { update('transcript', 'error', error.message); }
        })(),
      ]);
      signal.throwIfAborted(); this.finish(track);
    } catch (error) {
      track.status = 'error'; track.error = signal.aborted ? 'Cancelled.' : error.message;
      if (track.steps.audio.state === 'running') update('audio', 'error', track.error);
    } finally {
      if (track.directory) {
        if (signal.aborted || track.status === 'error') { await rm(track.directory, { recursive: true, force: true }).catch(() => {}); track.audioPath = null; track.audioUrl = null; }
        else await Promise.all(['whisper.wav', 'transcript.json'].map(file => rm(path.join(track.directory, file), { force: true }).catch(() => {})));
      }
      this.publish();
    }
  }
  async close() { this.closed = true; for (const job of this.jobs.values()) job.controller.abort(); await Promise.allSettled([...this.jobs.values()].map(job => job.promise)); await rm(this.root, { recursive: true, force: true }); }
}
