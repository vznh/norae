import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { access, copyFile, rename, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { drawKaraoke } from '../shared/karaoke.mjs';
import { validateLines, validateFont } from './timing.mjs';

export async function exportVideo(track, output, settings, signal, progress = () => {}, { width = 1920, height = 1080, fps = 30 } = {}) {
  signal?.throwIfAborted();
  validateLines(track.result?.lines, track.duration, { requireTiming: true });
  const font = validateFont(track.font || settings.font || 'Arial');
  if (!GlobalFonts.has(font)) {
    const filename = { Arial: 'Arial.ttf', Verdana: 'Verdana.ttf', 'Trebuchet MS': 'Trebuchet MS.ttf' }[font];
    try { GlobalFonts.registerFromPath(`/System/Library/Fonts/Supplemental/${filename}`, font); } catch {}
  }
  if (!GlobalFonts.has(font)) throw new Error(`${font} is not installed. Install it or choose another font before exporting.`);
  await access(track.audioPath);
  const canvas = createCanvas(width, height), ctx = canvas.getContext('2d');
  ctx.scale(width / 1920, height / 1080);
  // Encode in session storage first. A cancelled render never damages an existing export.
  const temporary = path.join(track.directory, 'render.mp4');
  if ([temporary, track.audioPath].some(file => path.resolve(file) === path.resolve(output))) throw new Error('Choose an export destination outside the song’s working files.');
  const pendingOutput = path.join(path.dirname(output), `.norae-export-${randomUUID()}.mp4`);
  const child = spawn(settings.ffmpeg, [
    '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'rawvideo', '-pixel_format', 'rgba', '-video_size', `${width}x${height}`, '-framerate', String(fps), '-i', 'pipe:0', '-i', track.audioPath,
    '-map', '0:v:0', '-map', '1:a:0', '-vf', 'scale=out_color_matrix=bt709:out_range=tv,setsar=1,setparams=field_mode=prog:range=limited:color_primaries=bt709:color_trc=bt709:colorspace=bt709',
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-profile:v', 'high', '-bf', '2', '-g', String(Math.max(1, Math.round(fps / 2))), '-x264-params', 'open-gop=0',
    '-pix_fmt', 'yuv420p', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv',
    '-c:a', 'aac', '-profile:a', 'aac_low', '-ar', '48000', '-ac', '2', '-b:a', '384k',
    '-t', String(track.duration), '-avoid_negative_ts', 'disabled', '-use_editlist', '0', '-movflags', '+faststart+negative_cts_offsets', temporary,
  ], { shell: false, stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true, env: { PATH: `${process.env.PATH || ''}:/opt/homebrew/bin:/usr/local/bin` } });
  let stderr = '', failure;
  child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-4000); });
  child.stdin.on('error', error => { failure ||= error; });
  const finished = new Promise((resolve, reject) => {
    child.once('error', error => { failure = error; reject(error); });
    child.once('close', code => code === 0 && !failure ? resolve() : reject(failure || new Error(stderr || `FFmpeg exited with code ${code}.`)));
  });
  // Attach a rejection handler immediately while frame generation is in progress.
  void finished.catch(() => {});
  const abort = () => { child.stdin.destroy(); child.kill('SIGTERM'); };
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, 3600000);
  let lastProgress = -1;
  try {
    signal?.throwIfAborted();
    const frames = Math.ceil(track.duration * fps);
    for (let frame = 0; frame < frames; frame++) {
      signal?.throwIfAborted();
      if (failure || child.exitCode !== null) throw failure || new Error(stderr || 'Video encoder stopped.');
      drawKaraoke(ctx, track.result.lines, frame / fps, track.duration, { font, copyright: track.lyrics?.copyright || '' });
      const pixels = ctx.getImageData(0, 0, width, height).data;
      const bytes = Buffer.from(pixels.buffer, pixels.byteOffset, pixels.byteLength);
      if (!child.stdin.write(bytes)) await once(child.stdin, 'drain', { signal });
      const percent = Math.min(99, Math.floor((frame + 1) / frames * 100));
      if (percent !== lastProgress) { progress(percent); lastProgress = percent; }
      if (frame % 15 === 0) await new Promise(resolve => setImmediate(resolve));
    }
    child.stdin.end(); await finished; signal?.throwIfAborted();
    // Copy across volumes first, then commit atomically in the destination
    // directory. A copy failure or cancellation leaves an existing MP4 intact.
    await copyFile(temporary, pendingOutput, constants.COPYFILE_EXCL);
    signal?.throwIfAborted();
    await rename(pendingOutput, output);
    progress(100);
    return output;
  } finally {
    clearTimeout(timer); signal?.removeEventListener('abort', abort);
    if (child.exitCode === null) { abort(); const kill = setTimeout(() => child.kill('SIGKILL'), 2000); await finished.catch(() => {}); clearTimeout(kill); }
    await Promise.all([temporary, pendingOutput].map(file => rm(file, { force: true })));
  }
}

export async function saveTimingProject(track, output) {
  await writeFile(output, JSON.stringify({ version: 1, url: track.url || '', title: track.title, artist: track.artist, duration: track.duration, font: track.font || 'Arial', source: track.result?.source, copyright: track.lyrics?.copyright || '', lines: track.result?.lines || [] }, null, 2));
  return output;
}
