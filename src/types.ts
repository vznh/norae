export type Step = { state: 'waiting' | 'running' | 'done' | 'error' | 'review' | 'skipped'; message: string };
export type LyricLine = { text: string; start: number | null; end: number | null; heard: string; agreement: number | null; review: boolean; timing: string };
export type Candidate = { id: number; title: string; artist: string; album: string; duration: number; score: number; exact: boolean };
export type Track = {
  id: string; url?: string; title: string; artist: string; singer: string; duration: number;
  status: 'queued' | 'processing' | 'ready' | 'review' | 'error';
  steps: { audio: Step; lyrics: Step; transcript: Step };
  candidates: Candidate[]; lyrics: Candidate | null;
  transcript: { text: string; start: number; end: number }[];
  result: { source: string; timing: string; agreement: number | null; lines: LyricLine[]; notes: string[] } | null;
  audioUrl: string | null; error: string; demo: boolean;
};
export type Settings = { ytDlp: string; ffmpeg: string; whisper: string; model: string; language: string };
export type Dependency = { key: string; ok: boolean; detail: string };
export type NoraeAPI = {
  snapshot(): Promise<Track[]>; add(input: { url: string; title?: string; artist?: string; singer?: string }): Promise<string>;
  demo(): Promise<string>; remove(id: string): Promise<void>; move(id: string, direction: number): Promise<void>;
  retry(id: string): Promise<void>; selectLyrics(id: string, candidateId: number): Promise<void>;
  getSettings(): Promise<Settings>; saveSettings(settings: Settings): Promise<Settings>; check(): Promise<Dependency[]>;
  chooseModel(): Promise<string | null>; fullscreen(enabled: boolean): Promise<void>;
  onChange(callback: (tracks: Track[]) => void): () => void;
};
declare global { interface Window { norae?: NoraeAPI } }
