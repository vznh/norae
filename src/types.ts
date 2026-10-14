export type Step = { state: 'waiting' | 'running' | 'done' | 'error' | 'review' | 'skipped'; message: string };
export type TimedUnit = { text: string; start: number | null; end: number | null; loss?: number | null };
export type LyricLine = { text: string; start: number | null; end: number | null; heard: string; agreement: number | null; review: boolean; timing: string; blockStart?: boolean; section?: string; words?: TimedUnit[] };
export type Candidate = { id: number; title: string; artist: string; album: string; duration: number; score: number; exact: boolean; source?: string; copyright?: string; plainLyrics?: string; sourceUrl?: string };
export type Track = {
  id: string; url?: string; title: string; artist: string; singer: string; duration: number;
  status: 'queued' | 'processing' | 'ready' | 'review' | 'error';
  steps: { audio: Step; lyrics: Step; transcript: Step; alignment: Step };
  candidates: Candidate[]; lyrics: Candidate | null;
  transcript: { text: string; start: number; end: number }[];
  result: { source: string; timing: string; agreement: number | null; lines: LyricLine[]; notes: string[] } | null;
  audioUrl: string | null; error: string; demo: boolean; font: string; reviewed: boolean;
  export: { state: 'idle' | 'running' | 'done' | 'error' | 'cancelled'; progress: number; message: string };
};
export type Settings = { ytDlp: string; ffmpeg: string; whisper: string; model: string; language: string; lyricsProvider: 'lrclib'; transcriptionProvider: 'elevenlabs' | 'whisper'; credentialsFile: string; font: string };
export type Dependency = { key: string; ok: boolean; detail: string; optional?: boolean };
export type NoraeAPI = {
  snapshot(): Promise<Track[]>; add(input: { url: string; title?: string; artist?: string; singer?: string }): Promise<string>;
  demo(): Promise<string>; remove(id: string): Promise<void>; move(id: string, direction: number): Promise<void>; reorder(id: string, index: number): Promise<void>;
  retry(id: string): Promise<void>; retryLyrics(id: string): Promise<void>; selectLyrics(id: string, candidateId: number): Promise<void>;
  align(id: string): Promise<void>; saveTiming(id: string, input: {lines: LyricLine[]; font: string; reviewed: boolean}): Promise<void>;
  replaceLyrics(id: string, text: string): Promise<void>;
  exportVideo(id: string): Promise<string | null>; cancelExport(id: string): Promise<void>;
  saveProject(id: string): Promise<string | null>; loadProject(id: string): Promise<boolean>;
  getSettings(): Promise<Settings>; saveSettings(settings: Settings): Promise<Settings>; check(): Promise<Dependency[]>;
  chooseModel(): Promise<string | null>; chooseCredentials(): Promise<string | null>; fullscreen(enabled: boolean): Promise<void>;
  onChange(callback: (tracks: Track[]) => void): () => void;
  onStorageError(callback: (message: string) => void): () => void;
};
declare global { interface Window { norae?: NoraeAPI } }
