import { audioConstraints, isMissingDevice } from './devices'
import { InputMeter } from './meter'
import { encodeWav, peakInt16, toMono } from './wav'

export type RecordingFailure =
  /** The browser has no way to record from the microphone. */
  | 'Unsupported'
  /** The person, or the browser's settings, did not allow the microphone. */
  | 'Denied'
  /** There is no microphone, or something else is using it. */
  | 'Unavailable'

export class RecordingError extends Error {
  constructor(
    readonly failure: RecordingFailure,
    options?: { cause?: unknown },
  ) {
    super(failure, options)
  }
}

/** A voiceover is stopped at this length, to keep the recording and its decoded sound within what a browser can hold. */
export const MAX_RECORDING_MS = 20 * 60_000

/** The sample rate the recording is kept at: plenty for a voice, and what every browser decodes to without trouble. */
export const RECORDING_RATE = 44_100

export interface Recorded {
  /** A mono WAV file of what was said. */
  readonly wav: Blob
  readonly durationMs: number
  /** False when the microphone gave exact silence, as one that is blocked in the settings does. */
  readonly heardSound: boolean
}

export const recordingSupported = (): boolean =>
  typeof MediaRecorder !== 'undefined' && typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function'

/** The first type the browser can record that it can also decode back. */
function recordingType(): string | undefined {
  const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']
  return types.find((type) => MediaRecorder.isTypeSupported(type))
}

/** What the recorder made, as samples at RECORDING_RATE, or null when it made nothing. */
async function decode(recording: Blob): Promise<Float32Array | null> {
  if (recording.size === 0) return null
  const context = new OfflineAudioContext(1, 1, RECORDING_RATE)
  try {
    const buffer = await context.decodeAudioData(await recording.arrayBuffer())
    return toMono(Array.from({ length: buffer.numberOfChannels }, (_, channel) => buffer.getChannelData(channel)))
  } catch {
    return null
  }
}

/**
 * Asks for the microphone: the one with this code, or the default. A chosen microphone that is not there any more, because
 * it was unplugged, is made up for with the default, and fellBack says so. Throws a RecordingError with the person's answer
 * or what is wrong. The caller lets go of the stream.
 */
export async function openMicrophone(microphoneId: string | null): Promise<{ stream: MediaStream; fellBack: boolean }> {
  const ask = async (id: string | null): Promise<MediaStream> => {
    try {
      return await navigator.mediaDevices.getUserMedia(audioConstraints(id))
    } catch (error) {
      const name = error instanceof DOMException ? error.name : ''
      throw new RecordingError(name === 'NotAllowedError' || name === 'SecurityError' ? 'Denied' : 'Unavailable', { cause: error })
    }
  }
  try {
    return { stream: await ask(microphoneId), fellBack: false }
  } catch (error) {
    if (microphoneId === null || !(error instanceof RecordingError) || !isMissingDevice(error.cause)) throw error
    return { stream: await ask(null), fellBack: true }
  }
}

/**
 * Records the microphone. The browser records in its own format, which is not always one that can be seeked in, so what
 * was recorded is decoded and kept as a plain WAV file: a voiceover then plays, seeks and mixes like any other sound.
 * One recording at a time.
 */
export class VoiceRecorder {
  private stream: MediaStream | null = null
  private meter: InputMeter | null = null
  private recorder: MediaRecorder | null = null
  private chunks: Blob[] = []
  private startedAt = 0
  private onStopped: (() => void) | null = null

  get isRecording(): boolean {
    return this.recorder !== null
  }

  /** How loud the microphone is now, from 0 to 1, or null when this browser cannot measure it. */
  level(): number | null {
    return this.meter?.level() ?? null
  }

  /** Whether there is no level to wait for: the browser cannot measure it. */
  get levelUnavailable(): boolean {
    return this.meter?.unavailable ?? true
  }

  /** How long the recording has run, in milliseconds. */
  elapsedMs(): number {
    return this.recorder ? performance.now() - this.startedAt : 0
  }

  /**
   * Asks for the microphone and starts: the one with this code, or the default. A chosen microphone that is not there any
   * more, because it was unplugged, is made up for with the default, and fellBack says so. Throws a RecordingError, with
   * the person's answer or what is wrong.
   */
  async start(microphoneId: string | null = null): Promise<{ fellBack: boolean }> {
    if (this.recorder) throw new Error('A recording is already running')
    if (!recordingSupported()) throw new RecordingError('Unsupported')
    const { stream, fellBack } = await openMicrophone(microphoneId)
    try {
      const type = recordingType()
      const recorder = type ? new MediaRecorder(stream, { mimeType: type }) : new MediaRecorder(stream)
      this.chunks = []
      recorder.addEventListener('dataavailable', (event) => {
        if (event.data.size > 0) this.chunks.push(event.data)
      })
      recorder.addEventListener('stop', () => this.onStopped?.())
      // A piece every second, so that a long recording is not held in one piece until its end.
      recorder.start(1000)
      this.stream = stream
      this.recorder = recorder
      this.startedAt = performance.now()
      // The meter is a help to the person and never worth failing the recording for.
      this.meter = new InputMeter(stream)
      return { fellBack }
    } catch (error) {
      stream.getTracks().forEach((track) => track.stop())
      throw new RecordingError('Unavailable', { cause: error })
    }
  }

  /** Ends the recording and returns it, or null when nothing was captured. The microphone is let go either way. */
  async stop(): Promise<Recorded | null> {
    const recorder = this.recorder
    if (!recorder) return null
    const stopped = new Promise<void>((resolve) => {
      this.onStopped = resolve
    })
    if (recorder.state !== 'inactive') recorder.stop()
    else this.onStopped?.()
    await stopped
    this.release()
    const samples = await decode(new Blob(this.chunks, { type: recorder.mimeType }))
    this.chunks = []
    if (!samples || samples.length === 0) return null
    return {
      wav: encodeWav(samples, RECORDING_RATE),
      durationMs: Math.floor((samples.length / RECORDING_RATE) * 1000),
      heardSound: peakInt16(samples) > 0,
    }
  }

  /** Throws the recording away, as when the page goes away in the middle of it. */
  cancel(): void {
    const recorder = this.recorder
    this.onStopped = null
    this.release()
    this.chunks = []
    if (recorder && recorder.state !== 'inactive') {
      try {
        recorder.stop()
      } catch {
        // Nothing was captured, and nothing is wanted.
      }
    }
  }

  private release(): void {
    this.meter?.close()
    this.meter = null
    this.stream?.getTracks().forEach((track) => track.stop())
    this.stream = null
    this.recorder = null
  }
}
