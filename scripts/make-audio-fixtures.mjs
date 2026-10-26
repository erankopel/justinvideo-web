// Makes the sound files in test-data/audio, as 16-bit mono WAVs, which every browser that runs the tests can read:
// tone.wav, a steady tone, and steps.wav, a tone that is quiet, then loud, then silent, for the waveform tests. They are
// committed, so the tests do not depend on this script; run `npm run make-audio-fixtures` only to change them.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const web = join(dirname(fileURLToPath(import.meta.url)), '..')

/** A sine of the given frequency and peak level (0 to 1, or a function of the second), as the bytes of a WAV file. */
function tone({ seconds, hertz, peak, sampleRate = 44_100 }) {
  const peakAt = typeof peak === 'function' ? peak : () => peak
  const samples = Math.round(seconds * sampleRate)
  const bytes = Buffer.alloc(44 + samples * 2)
  bytes.write('RIFF', 0)
  bytes.writeUInt32LE(36 + samples * 2, 4)
  bytes.write('WAVEfmt ', 8)
  bytes.writeUInt32LE(16, 16)
  bytes.writeUInt16LE(1, 20) // PCM
  bytes.writeUInt16LE(1, 22) // mono
  bytes.writeUInt32LE(sampleRate, 24)
  bytes.writeUInt32LE(sampleRate * 2, 28)
  bytes.writeUInt16LE(2, 32)
  bytes.writeUInt16LE(16, 34)
  bytes.write('data', 36)
  bytes.writeUInt32LE(samples * 2, 40)
  for (let i = 0; i < samples; i++) {
    bytes.writeInt16LE(Math.round(peakAt(i / sampleRate) * 32767 * Math.sin((2 * Math.PI * hertz * i) / sampleRate)), 44 + i * 2)
  }
  return bytes
}

mkdirSync(join(web, 'test-data', 'audio'), { recursive: true })
writeFileSync(join(web, 'test-data', 'audio', 'tone.wav'), tone({ seconds: 3, hertz: 880, peak: 0.5 }))
console.log('tone.wav: 3 s at 880 Hz, peak 0.5')
// Quiet (0.2) for the first second, loud (0.8) for the second, silent for the third.
writeFileSync(join(web, 'test-data', 'audio', 'steps.wav'), tone({ seconds: 3, hertz: 440, peak: (t) => (t < 1 ? 0.2 : t < 2 ? 0.8 : 0) }))
console.log('steps.wav: 3 s at 440 Hz, peak 0.2, then 0.8, then silence')
