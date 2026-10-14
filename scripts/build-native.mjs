import { mkdir, rename, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from '../electron/process.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
export const metadataHelper = path.join(root, '.runtime/native/norae-metadata');

export async function buildNative() {
  if (process.platform !== 'darwin') throw new Error('Norae is a macOS app.');
  const source = path.join(root, 'native/Metadata.swift');
  const sourceInfo = await stat(source);
  try { if ((await stat(metadataHelper)).mtimeMs >= sourceInfo.mtimeMs) return; } catch {}
  await mkdir(path.dirname(metadataHelper), { recursive: true });
  await run('xcrun', ['swiftc', '-parse-as-library', '-O', '-module-cache-path', path.join(root, '.runtime/native/module-cache'), '-target', `${process.arch === 'arm64' ? 'arm64' : 'x86_64'}-apple-macosx14.0`, source, '-o', `${metadataHelper}.tmp`], { timeout: 120000 });
  await rename(`${metadataHelper}.tmp`, metadataHelper);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await buildNative();
