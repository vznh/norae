export const READING_BAR_WIDTH: number;
export const READING_BAR_OPACITY: number;
export const CURSOR_FADE_SECONDS: number;
export const LINE_APPROACH_GAP_SECONDS: number;
export const SUNG_TEXT_COLOR: string;
export const UPCOMING_TEXT_COLOR: string;
export type CursorWord = { start: number | null; end: number | null; x: number; y: number; width: number; lineIndex: number; opacity: number; fontSize: number; verseStart?: boolean; leadInStart?: number };
export type ReadingCursor = CursorWord & { phase: 'singing' | 'gap' | 'approach' | 'waiting' | 'leaving' };
export function getReadingCursors(words: CursorWord[], time: number, leadInStart?: number): ReadingCursor[];
