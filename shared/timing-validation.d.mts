import type { LyricLine, Track } from '../src/types';
export function validateLines(lines: LyricLine[] | undefined, duration: number, options?: { requireTiming?: boolean }): LyricLine[];
export function validateFont(font: string): string;
export function exportIssue(track: Track | null): string | null;
