import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import path from 'node:path';

const TYPES = { '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.opus': 'audio/ogg' };

// The protocol resolves track IDs to owned paths before calling this function.
// Stream only the requested bytes, with explicit HTTP range semantics: Electron's
// file fetch can return a partial body with status 200 and no Content-Range.
export async function audioResponse(request, audioPath) {
  if (!audioPath) return new Response('Not found', { status: 404 });
  if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } });
  let info;
  try { info = await stat(audioPath); }
  catch (error) { if (error.code === 'ENOENT') return new Response('Not found', { status: 404 }); throw error; }
  if (!info.isFile()) return new Response('Not found', { status: 404 });
  const size = info.size;
  const headers = { 'Content-Type': TYPES[path.extname(audioPath)] || 'application/octet-stream', 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' };
  let start = 0, end = size - 1, status = 200;
  // HEAD ignores Range. Unsupported range units and multipart ranges fall back
  // to the complete representation; Chromium requests one byte range at a time.
  const range = request.method === 'GET' && /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range') || '');
  if (range) {
    if (range[1]) { start = Number(range[1]); end = range[2] ? Math.min(Number(range[2]), end) : end; }
    else { const suffix = Number(range[2]); start = Math.max(0, size - suffix); if (!Number.isSafeInteger(suffix) || suffix <= 0) start = size; }
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || end < start) return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${size}`, 'Content-Length': '0' } });
    status = 206; headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
  }
  headers['Content-Length'] = String(Math.max(0, end - start + 1));
  const body = request.method === 'HEAD' || size === 0 ? null : Readable.toWeb(createReadStream(audioPath, { start, end, signal: request.signal }));
  return new Response(body, { status, headers });
}
