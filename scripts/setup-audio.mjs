import { spawnSync } from 'node:child_process';
import { mkdir, access, rename, rm } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = { ...process.env, PATH: `${process.env.PATH}:/opt/homebrew/bin:/usr/local/bin`, HOMEBREW_NO_AUTO_UPDATE: '1' };
const available = (command, args) => spawnSync(command, args, { env, stdio: 'ignore' }).status === 0;
if (process.platform !== 'darwin') {
  console.error('Automatic audio setup currently supports macOS. Install yt-dlp, FFmpeg and whisper.cpp for your platform, download a ggml model, then set their paths in Norae Settings. See README.md.');
  process.exit(1);
}
const missing = [['yt-dlp', '--version', 'yt-dlp'], ['ffmpeg', '-version', 'ffmpeg'], ['whisper-cli', '--help', 'whisper-cpp']].filter(([command, arg]) => !available(command, [arg]));
if (missing.length) {
  if (!available('brew', ['--version'])) { console.error('Homebrew is required. Install it from https://brew.sh, then rerun npm run setup:audio.'); process.exit(1); }
  console.log(`Installing ${missing.map(row => row[2]).join(', ')} with Homebrew…`);
  const result = spawnSync('brew', ['install', ...missing.map(row => row[2])], { env, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
const name = process.argv[2] || 'base';
if (!['base', 'small', 'medium', 'large-v3', 'large-v3-turbo'].includes(name)) { console.error('Model must be base, small, medium, large-v3, or large-v3-turbo.'); process.exit(1); }
const directory = path.join(root, '.models'); await mkdir(directory, { recursive: true });
const model = path.join(directory, `ggml-${name}.bin`);
try { await access(model); console.log(`Model already present: ${model}`); }
catch {
  const partial = `${model}.partial`;
  console.log(`Downloading multilingual ${name} model (${name === 'base' ? '~142 MiB' : 'up to ~3 GiB'})…`);
  try {
    const response = await fetch(`https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${name}.bin`, { signal: AbortSignal.timeout(900000) });
    if (!response.ok || !response.body) throw new Error(`Model download failed: HTTP ${response.status}`);
    await pipeline(Readable.fromWeb(response.body), createWriteStream(partial));
    await rename(partial, model);
  } catch (error) { await rm(partial, { force: true }); throw error; }
}
console.log(`Audio setup complete. Model: ${model}`);
console.log(name === 'base' ? 'Restart Norae to auto-detect this model, or choose it in Settings. Base is for fast setup; use large-v3 for quality evaluation.' : 'Choose this model in Norae Settings, then retry your track.');
