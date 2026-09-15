import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, Check, Expand, LoaderCircle, MoreHorizontal, Pause, Play, Plus, RotateCcw, Settings2, SkipForward, Trash2, Volume2, X } from 'lucide-react';
import type { Dependency, LyricLine, Settings, Track } from './types';

const api = window.norae;
const time = (seconds: number) => `${Math.floor(Math.max(0, seconds) / 60)}:${Math.floor(Math.max(0, seconds) % 60).toString().padStart(2, '0')}`;
const errorText = (error: unknown) => (error as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
const statusText = { queued: 'Queued', processing: 'Preparing…', ready: 'Ready', review: 'Needs review', error: 'Failed' };

function IconButton({ label, children, onClick, disabled = false }: { label: string; children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return <button type="button" title={label} aria-label={label} className="icon-button" onClick={onClick} disabled={disabled}>{children}</button>;
}

export default function App() {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [stage, setStage] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [volume, setVolume] = useState(.7);
  const [error, setError] = useState('');
  const [dependencies, setDependencies] = useState<Dependency[]>([]);
  const audio = useRef<HTMLAudioElement>(null);
  const autoPlay = useRef(false);
  const selected = tracks.find(track => track.id === selectedId) || null;

  useEffect(() => {
    if (!api) return;
    let disposed = false;
    const update = (next: Track[]) => {
      if (disposed) return;
      setTracks(next);
      setSelectedId(current => next.some(track => track.id === current) ? current : next[0]?.id || null);
    };
    const unsubscribe = api.onChange(update);
    api.snapshot().then(update).catch(error => setError(errorText(error)));
    api.check().then(next => { if (!disposed) setDependencies(next); }).catch(error => setError(errorText(error)));
    return () => { disposed = true; unsubscribe(); };
  }, []);
  useEffect(() => { if (audio.current) audio.current.volume = volume; }, [volume]);
  useEffect(() => { setPosition(0); setPlaying(false); setReviewOpen(false); }, [selectedId]);
  useEffect(() => {
    if (!stage) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setStage(false); void api?.fullscreen(false).catch(error => setError(errorText(error))); }
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [stage]);

  const act = async (action: () => Promise<unknown>) => {
    setError('');
    try { await action(); } catch (error) { setError(errorText(error)); }
  };
  const play = () => {
    if (!selected?.audioUrl) return;
    if (audio.current?.paused) void act(() => audio.current!.play());
    else audio.current?.pause();
  };
  const select = (id: string) => {
    if (id !== selectedId) { autoPlay.current = false; audio.current?.pause(); setSelectedId(id); }
  };
  const nextTrack = tracks.slice(tracks.findIndex(track => track.id === selectedId) + 1).find(track => track.audioUrl);
  const next = () => {
    if (nextTrack) { autoPlay.current = true; setSelectedId(nextTrack.id); }
    else { audio.current?.pause(); setPlaying(false); }
  };
  const toggleStage = () => {
    setStage(!stage);
    void act(async () => { await api?.fullscreen(!stage); });
  };
  const seek = (value: number) => {
    if (audio.current && selected?.audioUrl) { audio.current.currentTime = value; setPosition(value); }
  };
  const activeIndex = selected?.result?.lines.findIndex(line => line.start !== null && line.end !== null && position >= line.start && position < line.end) ?? -1;
  const activeLine = selected?.result?.lines[activeIndex];
  const total = audio.current?.duration && Number.isFinite(audio.current.duration) ? audio.current.duration : selected?.duration || 0;
  const needsSetup = dependencies.some(dep => !dep.ok);
  const sourceNote = selected?.demo ? 'Demo · illustrative lyrics' : selected?.result?.source === 'transcript' ? 'Unverified transcript' : selected?.result?.timing === 'approximate' ? 'Approximate timing' : '';

  return <div className="app">
    <audio ref={audio} src={selected?.audioUrl || undefined}
      onTimeUpdate={() => setPosition(audio.current?.currentTime || 0)}
      onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={next}
      onCanPlay={() => { if (autoPlay.current) { autoPlay.current = false; void act(() => audio.current!.play()); } }}
      onError={() => { if (selected?.audioUrl) setError('Audio could not be played. Retry the song in Cross-check.'); }} />

    {!stage ? <>
      <header className="app-header">
        <h1>norae</h1>
        <IconButton label="Settings" onClick={() => setSettingsOpen(true)} disabled={!api}><Settings2 size={18} /></IconButton>
      </header>
      <main className="main">
        <QueueInput added={id => setSelectedId(current => current || id)} />
        {!api && <p className="notice">Open the desktop app with <code>npm run dev</code> to queue songs.</p>}
        {needsSetup && <button className="setup-notice" onClick={() => setSettingsOpen(true)}>Audio setup required <span>Open settings</span></button>}
        <div className="workspace">
          <section className="queue-panel" aria-label="Song queue">
            <h2>Queue <span>{tracks.length}</span></h2>
            <div className="queue-list">
              {!tracks.length && <p className="empty-queue">No songs queued.</p>}
              {tracks.map((track, i) => <div key={track.id} className={`queue-row ${selectedId === track.id ? 'selected' : ''}`}>
                <button className="track-select" onClick={() => select(track.id)} aria-label={`Select ${track.title}`} aria-pressed={selectedId === track.id}>
                  <span className="track-number">{i + 1}</span>
                  <span className="track-info"><strong>{track.title}</strong><span>{track.artist}</span><small className={`status-${track.status}`}>{track.status === 'processing' && <LoaderCircle size={11} className="spin" />}{statusText[track.status]}{!['You', 'Everyone'].includes(track.singer) && ` · ${track.singer}`}</small></span>
                </button>
                <TrackActions track={track} index={i} count={tracks.length}
                  move={direction => void act(() => api!.move(track.id, direction))}
                  remove={() => { if (track.id === selectedId) audio.current?.pause(); void act(() => api!.remove(track.id)); }} />
              </div>)}
            </div>
          </section>
          <section className="song-panel" aria-label="Lyrics">
            {selected ? <>
              <div className="song-heading"><div><h2>{selected.title}</h2><p>{selected.artist}</p></div><button className="text-button" onClick={() => setReviewOpen(true)}>Cross-check{selected.status === 'review' && <span className="review-dot" />}</button></div>
              {sourceNote && <p className="source-note">{sourceNote}</p>}
              <Lyrics track={selected} activeIndex={activeIndex} onSeek={seek} />
            </> : <div className="empty-state"><p>Lyrics will appear here.</p></div>}
          </section>
        </div>
      </main>
    </> : <main className="stage">
      <header><span>{selected?.title}</span><small>{sourceNote}</small></header>
      <div className="stage-lyrics">
        <p>{activeIndex > 0 ? selected?.result?.lines[activeIndex - 1]?.text : '♪'}</p>
        <h1>{activeLine?.text || (playing ? '♪' : 'Press play')}</h1>
        <p>{activeIndex >= 0 ? selected?.result?.lines[activeIndex + 1]?.text : selected?.result?.lines.find(line => line.start !== null && line.start > position)?.text}</p>
      </div>
    </main>}

    {selected && <footer className="player" aria-label="Playback controls">
      <button className="play-button" aria-label={playing ? 'Pause' : 'Play'} onClick={play} disabled={!selected.audioUrl}>{playing ? <Pause size={19} fill="currentColor" /> : <Play size={19} fill="currentColor" />}</button>
      <IconButton label="Next song" onClick={next} disabled={!nextTrack}><SkipForward size={18} /></IconButton>
      <div className="progress"><span>{time(position)}</span><input aria-label="Playback position" type="range" min="0" max={total || 1} step="0.1" value={Math.min(position, total || 1)} onChange={event => seek(Number(event.target.value))} disabled={!selected.audioUrl} /><span>{time(total)}</span></div>
      <div className="player-volume"><Volume2 size={17} /><input aria-label="Volume" type="range" min="0" max="1" step="0.01" value={volume} onChange={event => setVolume(Number(event.target.value))} /></div>
      <IconButton label="Toggle stage view" onClick={toggleStage} disabled={!selected.audioUrl}><Expand size={18} /></IconButton>
    </footer>}
    {error && <div className="toast" role="alert"><span>{error}</span><IconButton label="Dismiss notification" onClick={() => setError('')}><X size={16} /></IconButton></div>}
    {reviewOpen && selected && <Modal title="Cross-check" close={() => setReviewOpen(false)} className="review-modal"><Review track={selected} act={act} onSettings={() => { setReviewOpen(false); setSettingsOpen(true); }} /></Modal>}
    {settingsOpen && <SettingsModal close={() => setSettingsOpen(false)} checked={setDependencies} loadDemo={async () => {
      const id = await api!.demo(); select(id); setSettingsOpen(false);
    }} />}
  </div>;
}

function QueueInput({ added }: { added: (id: string) => void }) {
  const [url, setUrl] = useState(''), [singer, setSinger] = useState(''), [title, setTitle] = useState(''), [artist, setArtist] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const details = useRef<HTMLDetailsElement>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!api) return;
    setBusy(true); setError('');
    try {
      added(await api.add({ url, singer, title, artist }));
      setUrl(''); setSinger(''); setTitle(''); setArtist('');
      if (details.current) details.current.open = false;
    } catch (error) { setError(errorText(error)); }
    finally { setBusy(false); }
  }
  return <form className="queue-input" onSubmit={submit}>
    <div className="url-row"><input aria-label="YouTube URL" required type="url" placeholder="Paste a YouTube URL" value={url} onChange={event => { setUrl(event.target.value); setError(''); }} maxLength={2048} disabled={!api} /><button className="primary" disabled={!api || busy || !url.trim()}>{busy ? <LoaderCircle size={16} className="spin" /> : <Plus size={16} />}Add to queue</button></div>
    <details className="song-details" ref={details}><summary>Song details <span>optional</span></summary><div className="form-columns"><label className="field"><span>Song title</span><input value={title} onChange={event => setTitle(event.target.value)} maxLength={200} /></label><label className="field"><span>Artist</span><input value={artist} onChange={event => setArtist(event.target.value)} maxLength={200} /></label><label className="field"><span>Singer</span><input value={singer} onChange={event => setSinger(event.target.value)} maxLength={200} /></label></div></details>
    {error && <p className="form-error" role="alert">{error}</p>}
  </form>;
}

function TrackActions({ track, index, count, move, remove }: { track: Track; index: number; count: number; move: (direction: number) => void; remove: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); trigger.current?.focus(); } };
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [open]);
  return <div className="track-actions" ref={ref} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <button ref={trigger} className="icon-button" aria-label={`Options for ${track.title}`} aria-expanded={open} onClick={() => setOpen(!open)}><MoreHorizontal size={18} /></button>
    {open && <div className="track-menu">
      <button disabled={index === 0} onClick={() => { move(-1); setOpen(false); }}><ArrowUp size={14} />Move up</button>
      <button disabled={index === count - 1} onClick={() => { move(1); setOpen(false); }}><ArrowDown size={14} />Move down</button>
      <button onClick={() => { remove(); setOpen(false); }}><Trash2 size={14} />Remove</button>
    </div>}
  </div>;
}

function Lyrics({ track, activeIndex, onSeek }: { track: Track; activeIndex: number; onSeek: (time: number) => void }) {
  const active = useRef<HTMLButtonElement>(null);
  useEffect(() => { active.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, [activeIndex]);
  if (!track.result?.lines.length) {
    const message = track.status === 'processing' ? 'Preparing lyrics…' : track.status === 'queued' ? 'Waiting to prepare.' : track.status === 'error' ? 'Could not prepare this song.' : 'No lyrics found.';
    return <div className="empty-state">{track.status === 'processing' && <LoaderCircle size={20} className="spin" />}<p>{message}</p>{!['processing', 'queued'].includes(track.status) && <small>Open Cross-check for details.</small>}</div>;
  }
  return <div className="lyric-list">{track.result.lines.map((line, i) => <button
    ref={i === activeIndex ? active : undefined} key={i}
    className={`lyric-line ${i === activeIndex ? 'current' : ''}`}
    title={line.start === null ? 'Timing unavailable' : `Seek to ${time(line.start)}`}
    disabled={line.start === null} onClick={() => line.start !== null && onSeek(line.start)}>{line.text}</button>)}</div>;
}
function Review({ track, act, onSettings }: { track: Track; act: (fn: () => Promise<unknown>) => Promise<void>; onSettings: () => void }) {
  return <div className="review-panel">{track.demo ? <div className="info-box">Demo fixture: original instrumental and illustrative lyrics. No lyrics lookup, transcription, or accuracy comparison was performed.</div> : <>
    {Object.entries(track.steps).filter(([, step]) => step.state === 'error' || step.state === 'review').map(([key, step]) => <div className="review-message" key={key}><strong>{key === 'transcript' ? 'Local transcription' : key === 'lyrics' ? 'Lyrics lookup' : 'Audio extraction'}</strong><p>{step.message}</p></div>)}
    {track.candidates.length > 0 && <label className="field"><span>Confirm the recording <small>LRCLIB · {track.candidates.length} candidates</small></span><select aria-label="Lyrics recording" disabled={track.steps.lyrics.state === 'running'} value={track.lyrics?.id || ''} onChange={event => void act(() => api!.selectLyrics(track.id, Number(event.target.value)))}><option value="" disabled>Select the matching song and version</option>{track.candidates.map(row => <option key={row.id} value={row.id}>{row.artist} — {row.title} {row.album ? `· ${row.album}` : ''} · {time(row.duration)}</option>)}</select></label>}
    <div className="review-summary"><div><strong>{track.result?.agreement == null ? '—' : `${Math.round(track.result.agreement * 100)}%`}</strong><span>word agreement</span></div><p>{track.result?.notes[0] || 'Each source runs independently. The comparison appears when processing finishes.'}</p></div>
    {track.result?.lines.some(line => line.review) && <div className="comparison"><div className="comparison-head"><span>PRIMARY WORDING</span><span>LOCAL TRANSCRIPT EVIDENCE</span></div>{track.result.lines.filter(line => line.review).map((line, i) => <Comparison key={i} line={line} />)}</div>}
    {track.result?.lines.length === 0 && track.transcript.length > 0 && <p>{track.transcript.map(segment => segment.text).join(' ')}</p>}
    <div className="review-actions"><button className="secondary" onClick={() => void act(() => api!.retry(track.id))} disabled={track.status === 'processing' || track.status === 'queued'}><RotateCcw size={14} /> Retry processing</button><button className="text-button" onClick={onSettings}><Settings2 size={14} /> Audio settings</button></div>
  </>}</div>;
}
function Comparison({ line }: { line: LyricLine }) { return <div className="comparison-row"><div><span>{line.start === null ? 'Untimed' : time(line.start)} · {line.timing}</span><p>{line.text}</p></div><div><span>{line.agreement === null ? 'Unverified' : `${Math.round(line.agreement * 100)}% word agreement`}</span><p>{line.heard || 'No matching transcript evidence.'}</p></div></div>; }
function Modal({ title, close, children, className = '' }: { title: string; close: () => void; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const dialog = ref.current;
    const focusable = () => [...(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), summary, [tabindex="0"]') || [])].filter(element => element.getClientRects().length);
    focusable()[0]?.focus();
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
      if (event.key === 'Tab') {
        const items = focusable(), first = items[0], last = items.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    dialog?.addEventListener('keydown', handler);
    return () => { dialog?.removeEventListener('keydown', handler); previous?.focus(); };
  }, []);
  return <div className="modal-overlay" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}><div className={`modal ${className}`} ref={ref} role="dialog" aria-modal="true" aria-label={title}><div className="modal-heading"><h2>{title}</h2><IconButton label="Close dialog" onClick={close}><X size={19} /></IconButton></div>{children}</div></div>;
}

function SettingsModal({ close, checked, loadDemo }: { close: () => void; checked: (deps: Dependency[]) => void; loadDemo: () => Promise<void> }) {
  const [settings, setSettings] = useState<Settings | null>(null), [deps, setDeps] = useState<Dependency[]>([]);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState('');
  useEffect(() => {
    api?.getSettings().then(setSettings).catch(error => setError(errorText(error)));
    api?.check().then(setDeps).catch(error => setError(errorText(error)));
  }, []);
  const save = async (event: FormEvent) => {
    event.preventDefault(); if (!api || !settings) return;
    setBusy(true); setError('');
    try {
      setSettings(await api.saveSettings(settings));
      const results = await api.check(); setDeps(results); checked(results);
      setMessage(results.every(dep => dep.ok) ? 'Saved. Audio tools are ready.' : 'Saved. Some audio tools still need setup.');
    } catch (error) { setError(errorText(error)); }
    finally { setBusy(false); }
  };
  return <Modal title="Settings" close={close}>
    {deps.some(dep => !dep.ok) && <div className="setup-instructions"><p>Install missing audio tools from the project folder:</p><code>npm run setup:audio</code></div>}
    {settings && <form onSubmit={save}>
      <label className="field"><span>Whisper model</span><div className="file-field"><input value={settings.model} onChange={event => setSettings({ ...settings, model: event.target.value })} placeholder="Path to a ggml .bin model" /><button type="button" className="secondary" onClick={async () => {
        try { const model = await api?.chooseModel(); if (model) setSettings({ ...settings, model }); } catch (error) { setError(errorText(error)); }
      }}>Browse</button></div></label>
      <label className="field"><span>Song language</span><input value={settings.language} onChange={event => setSettings({ ...settings, language: event.target.value })} placeholder="auto, en, ko, ja…" required /><small>Use auto to detect the language.</small></label>
      <details className="advanced-settings"><summary>Audio tool paths</summary><div>{(['ytDlp', 'ffmpeg', 'whisper'] as const).map(key => <label className="field" key={key}><span>{key === 'ytDlp' ? 'yt-dlp' : key === 'whisper' ? 'Whisper CLI' : 'FFmpeg'}<small className={deps.find(dep => dep.key === key)?.ok ? 'dep-ok' : 'dep-missing'}>{deps.find(dep => dep.key === key)?.ok ? 'Available' : 'Missing'}</small></span><input value={settings[key]} onChange={event => setSettings({ ...settings, [key]: event.target.value })} required /></label>)}</div></details>
      {error && <p className="form-error" role="alert">{error}</p>}
      {message && <p className="save-message" role="status">{message}</p>}
      <div className="settings-actions"><button type="button" className="text-button" disabled={busy} onClick={async () => {
        setBusy(true); setError('');
        try { await loadDemo(); } catch (error) { setError(errorText(error)); } finally { setBusy(false); }
      }}>Load demo</button><button className="primary" disabled={busy}>{busy ? <LoaderCircle size={15} className="spin" /> : <Check size={15} />}Save & check tools</button></div>
    </form>}
  </Modal>;
}
