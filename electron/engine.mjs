import { randomUUID } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { sourceUrl, sourceName, reconcile } from './core.mjs';
import * as providers from './providers.mjs';
import { writeDemo, demoLines } from './demo.mjs';
import { prepareLines, applyAlignment, repairReferenceTiming, validateLines, validateFont } from './timing.mjs';
import { exportVideo } from './video.mjs';
import { QueueStore } from './queue-store.mjs';
import { exportIssue } from '../shared/timing-validation.mjs';
import { METADATA_VERSION } from './metadata.mjs';

const step = () => ({ state: 'waiting', message: '' });
const steps = () => ({ audio: step(), lyrics: step(), transcript: step(), alignment: step() });
export class QueueEngine extends EventEmitter {
  constructor({ root, settings, services = providers, persistencePath }) {
    super(); this.root = root; this.settings = settings; this.services = services; this.tracks = []; this.jobs = new Map(); this.lyricsRetries = new Map(); this.renders = new Map(); this.closed = false;
    this.store = persistencePath ? new QueueStore({ file: persistencePath, audioRoot: root }) : null;
  }
  static async open(options) {
    const engine = new QueueEngine(options);
    await mkdir(engine.root, { recursive: true });
    if (engine.store) engine.tracks = await engine.store.load();
    let repairedQueue = false;
    for (const track of engine.tracks) {
      if (track.reviewed) continue;
      const repaired = repairReferenceTiming(track.result, track.lyrics, track.duration, track.transcript);
      if (repaired !== track.result) {
        repairedQueue = true;
        track.result = repaired; track.status = 'review';
        track.steps.alignment = { state: 'review', message: repaired.notes[0] };
      }
    }
    if (repairedQueue && engine.store) await engine.store.save(engine.tracks);
    // Restoring never pumps queued work or repeats provider requests.
    return engine;
  }
  snapshot() { return structuredClone(this.tracks.map(({ directory, audioPath, ...track }) => track)); }
  enrichSavedMetadata() {
    if (this.closed || !this.services.enrich) return Promise.resolve();
    if (this.metadataRefresh) return this.metadataRefresh.promise;
    const controller = new AbortController();
    const job = { controller, promise: null }; this.metadataRefresh = job;
    job.promise = Promise.resolve().then(async () => {
      for (const track of [...this.tracks]) {
        if (controller.signal.aborted) break;
        if (track.demo || this.jobs.has(track.id) || ['queued', 'processing'].includes(track.status) || (track.metadataEnrichment?.version === METADATA_VERSION && track.metadataEnrichment.source !== 'basic')) continue;
        const enriched = await this.services.enrich(track, controller.signal, track.overrides);
        controller.signal.throwIfAborted();
        if (this.tracks.includes(track) && !this.jobs.has(track.id)) { Object.assign(track, enriched); this.publish(); }
      }
    }).finally(() => { this.metadataRefresh = null; });
    return job.promise;
  }
  publish(persist = true) {
    this.emit('change', this.snapshot());
    if (persist && this.store && !this.closed) {
      try { void this.store.save(this.tracks).catch(() => this.emit('storage-error', 'Your queue could not be saved locally. Keep Norae open and save timing projects before relaunching.')); }
      catch { this.emit('storage-error', 'Your queue could not be saved locally. Keep Norae open and save timing projects before relaunching.'); }
    }
  }
  add(input) {
    if (this.closed) throw new Error('The room is closing.');
    if (!input || typeof input !== 'object') throw new Error('Invalid track.');
    if (this.tracks.length >= 30) throw new Error('This room holds up to 30 tracks. Remove a track first.');
    const url = sourceUrl(input.url);
    const overrides = {};
    for (const field of ['title', 'artist', 'singer']) {
      if (input[field] !== undefined && typeof input[field] !== 'string') throw new Error(`Invalid ${field}.`);
      overrides[field] = (input[field] || '').trim().slice(0, 200);
    }
    const track = { id: randomUUID(), url, title: overrides.title || 'Reading your track…', artist: overrides.artist || sourceName(url), singer: overrides.singer || 'You', duration: 0, status: 'queued', steps: steps(), candidates: [], lyrics: null, transcript: [], result: null, audioUrl: null, error: '', overrides, demo: false, font: this.settings.font || 'Arial', reviewed: false, export: { state: 'idle', progress: 0, message: '' } };
    this.tracks.push(track); this.publish(); this.pump(); return track.id;
  }
  async demo() {
    const existing = this.tracks.find(track => track.demo);
    if (existing) return existing.id;
    const id = randomUUID(), directory = path.join(this.root, id);
    await mkdir(directory, { recursive: true });
    const audioPath = path.join(directory, 'demo.wav'); await writeDemo(audioPath);
    const lines = demoLines.map((text, i) => { const parts = text.match(/\S+\s*/g); return { text, blockStart: i === 0 || i === 4, words: parts.map((text, j) => ({ text, start: i * 4 + 3 + j * 4 / parts.length, end: i * 4 + 3 + (j + 1) * 4 / parts.length })), start: i * 4 + 3, end: i * 4 + 7, heard: '', agreement: null, review: false, timing: 'demo' }; });
    this.tracks.push({ id, title: 'A little louder', artist: 'The Norae demo', singer: 'Everyone', duration: 30, status: 'ready', steps: { audio: { state: 'done', message: 'Original synthesized instrumental' }, lyrics: { state: 'done', message: 'Illustrative original lyrics' }, transcript: { state: 'skipped', message: 'Demo fixture · no transcription performed' }, alignment: { state: 'skipped', message: 'Illustrative word timing' } }, candidates: [], lyrics: null, transcript: [], result: { source: 'demo', timing: 'demo', agreement: null, lines, notes: ['Original instrumental and illustrative timed lyrics. This demo does not run the YouTube or transcription pipeline.'] }, audioUrl: `norae-audio://track/${id}`, audioPath, directory, error: '', demo: true, font: 'Arial', reviewed: false, export: { state: 'idle', progress: 0, message: '' } });
    this.publish(); return id;
  }
  async remove(id) {
    const track = this.tracks.find(track => track.id === id); if (!track) return;
    this.tracks = this.tracks.filter(track => track.id !== id);
    const job = this.jobs.get(id); job?.controller.abort(); this.publish();
    const lyricsRetry = this.lyricsRetries.get(id); lyricsRetry?.controller.abort();
    const render = this.renders.get(id); render?.controller.abort();
    if (job) await job.promise;
    if (lyricsRetry) await lyricsRetry.promise.catch(() => {});
    if (render) await render.promise.catch(() => {});
    if (this.store) await this.store.flush();
    if (track.directory) await rm(track.directory, { recursive: true, force: true });
  }
  move(id, direction) {
    if (![1, -1].includes(direction)) throw new Error('Invalid queue direction.');
    const index = this.tracks.findIndex(track => track.id === id), next = index + direction;
    if (index < 0 || next < 0 || next >= this.tracks.length) return;
    [this.tracks[index], this.tracks[next]] = [this.tracks[next], this.tracks[index]]; this.publish();
  }
  reorder(id, index) {
    if (!Number.isInteger(index)) throw new Error('Invalid queue position.');
    const current = this.tracks.findIndex(track => track.id === id);
    if (current < 0) return;
    const target = Math.max(0, Math.min(index, this.tracks.length - 1));
    if (current === target) return;
    const [track] = this.tracks.splice(current, 1); this.tracks.splice(target, 0, track); this.publish();
  }
  async retry(id) {
    const track = this.tracks.find(track => track.id === id);
    if (!track || track.demo || this.jobs.has(id)) return;
    if (this.lyricsRetries.has(id)) throw new Error('Wait for the lyrics search to finish before retrying all processing.');
    if (this.renders.has(id)) throw new Error('Cancel the export before retrying.');
    if (track.directory) await rm(track.directory, { recursive: true, force: true });
    Object.assign(track, { status: 'queued', steps: steps(), error: '', result: null, lyrics: null, candidates: [], transcript: [], audioUrl: null, audioPath: null, reviewed: false });
    this.publish(); this.pump();
  }
  async retryLyrics(id) {
    if (this.closed) throw new Error('The room is closing.');
    const track = this.tracks.find(track => track.id === id);
    if (!track?.audioPath || track.demo) throw new Error('Prepare a song before retrying its lyrics.');
    const existing = this.lyricsRetries.get(id);
    if (existing) return existing.promise;
    if (track.steps.lyrics.state === 'running') throw new Error('A lyrics search is already running.');
    const controller = new AbortController(), job = { controller, promise: null };
    this.lyricsRetries.set(id, job);
    track.steps.lyrics = { state: 'running', message: 'Retrying LRCLIB lyrics search' };
    job.promise = Promise.resolve().then(async () => {
      try {
        controller.signal.throwIfAborted();
        const { candidates } = await this.services.fetchLyrics(track, controller.signal, { ...this.settings });
        controller.signal.throwIfAborted();
        // A retry only refreshes recording choices. Existing wording and manual
        // timing change only when the reviewer explicitly selects a recording.
        track.candidates = candidates;
        track.steps.lyrics = { state: 'review', message: candidates.length ? 'Lyrics found. Choose the matching recording in Cross-check.' : 'No matching LRCLIB lyrics found. You can retry or paste lyrics in Edit timing.' };
      } catch (error) {
        if (!controller.signal.aborted) track.steps.lyrics = { state: 'error', message: error.message };
        throw error;
      }
    }).finally(() => { this.lyricsRetries.delete(id); this.publish(); });
    this.publish();
    return job.promise;
  }
  selectLyrics(id, candidateId) {
    const track = this.tracks.find(track => track.id === id);
    if (!track || track.steps.lyrics.state === 'running') throw new Error('Wait until the lyrics search finishes before choosing a recording.');
    const candidate = track.candidates.find(row => row.id === candidateId);
    if (!candidate) throw new Error('Choose a result from this track’s lyrics search.');
    if (this.renders.has(id)) throw new Error('Cancel the export before changing lyrics.');
    track.lyrics = candidate; track.reviewed = false; track.steps.lyrics = { state: 'done', message: `${candidate.source || 'LRCLIB'} version selected by you` };
    if (this.jobs.has(id)) track.result = prepareLines(reconcile(track.lyrics, track.transcript, track.duration), track.lyrics); else this.finish(track);
    this.publish();
    if (!this.jobs.has(id) && this.services.align) return this.align(id);
  }
  finish(track) {
    track.result = prepareLines(reconcile(track.lyrics, track.transcript, track.duration), track.lyrics);
    const needsReview = track.result.lines.some(line => line.review) || !track.result.lines.length;
    track.status = needsReview ? 'review' : 'ready';
  }
  async performAlignment(track, signal) {
    if (!this.services.align || !track.result?.lines.length || track.result.source === 'transcript') { track.steps.alignment = { state: 'skipped', message: 'Confirm or paste lyrics before alignment.' }; return; }
    track.steps.alignment = { state: 'running', message: 'Aligning the selected lyrics with ElevenLabs' }; this.publish();
    try {
      const response = await this.services.align(track.audioPath, track.result.lines.map(line => line.text).join('\n'), this.settings, signal);
      signal.throwIfAborted(); track.result = applyAlignment(track.result, response, track.duration, track.lyrics, track.transcript); track.reviewed = false;
      track.status = track.result.lines.some(line => line.review) ? 'review' : 'ready';
      track.steps.alignment = track.result.timing === 'partial'
        ? { state: 'review', message: track.result.notes[0] }
        : { state: 'done', message: 'Word timing ready. Review held vowels and slurred phrases.' };
    } catch (error) { track.steps.alignment = { state: 'error', message: error.message }; track.status = 'review'; }
    this.publish();
  }
  async align(id) {
    const track = this.tracks.find(track => track.id === id);
    if (!track?.audioPath || !track.result?.lines.length) throw new Error('Prepare the audio and lyrics first.');
    if (this.jobs.has(id) || this.renders.has(id)) throw new Error('Wait for processing or cancel the export first.');
    const controller = new AbortController(), job = { controller, promise: null };
    this.jobs.set(id, job);
    job.promise = this.performAlignment(track, controller.signal).finally(() => { this.jobs.delete(id); this.publish(); this.pump(); });
    return job.promise;
  }
  saveTiming(id, input) {
    const track = this.tracks.find(track => track.id === id);
    if (!track?.audioPath || this.jobs.has(id) || this.renders.has(id)) throw new Error('Wait for processing or cancel the export before editing.');
    const lines = validateLines(input?.lines, track.duration);
    track.font = validateFont(input.font || 'Arial'); track.reviewed = Boolean(input.reviewed);
    track.result = { ...(track.result || {}), source: track.result?.source || 'manual', timing: 'manual', agreement: track.result?.agreement ?? null, lines, notes: [track.result?.source === 'transcript' ? 'Edited timing is used for preview and export. Transcript wording and verse breaks remain unverified.' : 'Reviewer timing is used for preview and export.'] };
    if (track.result.source === 'transcript') track.result.lines = lines.map(line => ({ ...line, review: true }));
    track.status = track.result.lines.some(line => line.review) ? 'review' : 'ready'; this.publish();
  }
  replaceLyrics(id, text) {
    const track = this.tracks.find(track => track.id === id);
    if (!track?.audioPath || this.jobs.has(id) || this.renders.has(id)) throw new Error('Wait for processing or cancel the export before replacing lyrics.');
    if (typeof text !== 'string' || !text.trim() || text.length > 60000) throw new Error('Paste complete lyrics, up to 60,000 characters.');
    track.lyrics = { id: 0, title: track.title, artist: track.artist, plainLyrics: text, syncedLyrics: '', source: 'Reviewer', copyright: track.lyrics?.copyright || '' };
    track.reviewed = false; this.finish(track); track.steps.lyrics = { state: 'done', message: 'Reviewer supplied lyrics' };
    track.steps.alignment = { state: 'waiting', message: 'Use Align lyrics or set timing manually.' }; this.publish();
  }
  async exportVideo(id, output) {
    const track = this.tracks.find(track => track.id === id);
    if (!track?.audioPath || this.jobs.has(id) || this.renders.has(id)) throw new Error('Wait for processing or the current export to finish.');
    const issue = exportIssue(track); if (issue) throw new Error(issue);
    const controller = new AbortController();
    track.export = { state: 'running', progress: 0, message: 'Rendering 1080p MP4' }; this.publish();
    const render = { controller, promise: null }; this.renders.set(id, render);
    render.promise = exportVideo({ ...track, result: structuredClone(track.result) }, output, this.settings, controller.signal, progress => { track.export.progress = progress; this.publish(false); })
      .then(file => { track.export = { state: 'done', progress: 100, message: `Saved ${path.basename(file)}` }; return file; })
      .catch(error => { track.export = { state: controller.signal.aborted ? 'cancelled' : 'error', progress: 0, message: controller.signal.aborted ? 'Export cancelled' : error.message }; if (!controller.signal.aborted) throw error; return null; })
      .finally(() => { this.renders.delete(id); this.publish(); });
    return render.promise;
  }
  cancelExport(id) { this.renders.get(id)?.controller.abort(); }
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
      track.status = 'processing'; update('audio', 'running', `Reading ${sourceName(track.url)} metadata`);
      Object.assign(track, await this.services.inspect(track.url, settings, signal, track.overrides));
      signal.throwIfAborted();
      if (this.services.enrich) {
        update('audio', 'running', 'Cleaning the song title on this Mac');
        Object.assign(track, await this.services.enrich(track, signal, track.overrides));
        signal.throwIfAborted();
      }
      track.directory = path.join(this.root, track.id); await mkdir(track.directory, { recursive: true });
      update('audio', 'running', 'Extracting a temporary MP3');
      track.audioPath = await this.services.extract(track.url, track.directory, settings, signal);
      signal.throwIfAborted(); track.audioUrl = `norae-audio://track/${track.id}`; update('audio', 'done', 'Temporary MP3 ready');
      // Both branches start after extraction, independently. Neither awaits or reads the other.
      await Promise.allSettled([
        (async () => {
          update('lyrics', 'running', 'Searching LRCLIB');
          try {
            const { candidates, selected } = await this.services.fetchLyrics(track, signal, settings);
            signal.throwIfAborted(); track.candidates = candidates; track.lyrics = selected;
            track.result = prepareLines(reconcile(track.lyrics, track.transcript, track.duration), track.lyrics);
            update('lyrics', selected ? 'done' : 'review', selected ? `Matching lyrics found on ${selected.source || 'LRCLIB'}` : candidates.length ? 'Choose the matching recording in Cross-check' : 'No matching database lyrics found');
          } catch (error) { update('lyrics', 'error', error.message); }
        })(),
        (async () => {
          update('transcript', 'running', settings.transcriptionProvider === 'elevenlabs' ? 'Transcribing English with ElevenLabs Scribe v2' : 'Listening locally with Whisper');
          try {
            track.transcript = await this.services.transcribe(track.audioPath, track.directory, settings, signal);
            signal.throwIfAborted(); track.result = prepareLines(reconcile(track.lyrics, track.transcript, track.duration), track.lyrics); update('transcript', 'done', `${track.transcript.length} ${settings.transcriptionProvider === 'elevenlabs' ? 'words transcribed with Scribe v2' : 'segments transcribed on this device'}`);
          } catch (error) { update('transcript', 'error', error.message); }
        })(),
      ]);
      signal.throwIfAborted(); this.finish(track); await this.performAlignment(track, signal); signal.throwIfAborted();
    } catch (error) {
      track.status = 'error'; track.error = signal.aborted ? 'Cancelled.' : error.message;
      if (track.steps.audio.state === 'running') update('audio', 'error', track.error);
    } finally {
      if (track.directory) {
        if ((signal.aborted || track.status === 'error') && !(this.closed && this.store && track.audioPath)) { await rm(track.directory, { recursive: true, force: true }).catch(() => {}); track.audioPath = null; track.audioUrl = null; }
        else await Promise.all(['whisper.wav', 'transcript.json'].map(file => rm(path.join(track.directory, file), { force: true }).catch(() => {})));
      }
      this.publish();
    }
  }
  async close() {
    this.closed = true;
    const jobs = [...this.jobs.values(), ...this.lyricsRetries.values(), ...this.renders.values(), ...(this.metadataRefresh ? [this.metadataRefresh] : [])];
    for (const job of jobs) job.controller.abort();
    await Promise.allSettled(jobs.map(job => job.promise));
    if (this.store) await this.store.save(this.tracks);
    else await rm(this.root, { recursive: true, force: true });
  }
}
