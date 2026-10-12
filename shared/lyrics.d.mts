import type { LyricLine } from '../src/types';
export function parseLyricLayout(text?: string): { text: string; blockStart: boolean; section: string }[];
export function groupTranscriptLines(segments?: { text: string; start: number; end: number }[]): LyricLine[];
export function lyricSections(lines: LyricLine[]): { label: string; indices: number[] }[];
