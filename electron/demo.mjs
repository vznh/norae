import { writeFile } from 'node:fs/promises';
export const demoLines = [
  'Leave the day outside the door',
  'We have got a little more',
  'Turn the quiet into sound',
  'Let the room come spinning round',
  'Sing it out, a little louder',
  'This is where we all belong',
];
// An original synthesized instrumental. These illustrative lyrics are not ASR results.
export async function writeDemo(file) {
  const rate = 22050, seconds = 30, samples = rate * seconds;
  const wave = Buffer.alloc(44 + samples * 2);
  wave.write('RIFF'); wave.writeUInt32LE(wave.length - 8, 4); wave.write('WAVEfmt ', 8); wave.writeUInt32LE(16, 16); wave.writeUInt16LE(1, 20); wave.writeUInt16LE(1, 22); wave.writeUInt32LE(rate, 24); wave.writeUInt32LE(rate * 2, 28); wave.writeUInt16LE(2, 32); wave.writeUInt16LE(16, 34); wave.write('data', 36); wave.writeUInt32LE(samples * 2, 40);
  const chords = [[261.63, 329.63, 392], [220, 261.63, 329.63], [174.61, 220, 261.63], [196, 246.94, 293.66]];
  for (let i = 0; i < samples; i++) {
    const t = i / rate, beat = t % .5, chord = chords[Math.floor(t / 4) % 4];
    const melody = chord[Math.floor(t * 2) % 3] * 2;
    const value = (Math.sin(t * melody * 2 * Math.PI) * Math.exp(-beat * 8) * .12 + chord.reduce((sum, hz) => sum + Math.sin(t * hz * 2 * Math.PI), 0) * .025) * Math.min(t, 1, seconds - t);
    wave.writeInt16LE(Math.round(value * 32767), 44 + i * 2);
  }
  await writeFile(file, wave);
}
