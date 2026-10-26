import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RecordingError, VoiceRecorder } from './recorder'

/** A recorder that does nothing but say it began. */
class FakeMediaRecorder {
  static isTypeSupported(): boolean {
    return true
  }
  state = 'inactive'
  mimeType = 'audio/webm'
  addEventListener(): void {}
  start(): void {
    this.state = 'recording'
  }
}

const stream = (): MediaStream => ({ getTracks: () => [{ stop: () => undefined }] }) as unknown as MediaStream
const asked: MediaStreamConstraints[] = []

const answers = (...replies: (MediaStream | DOMException)[]): void => {
  const queue = [...replies]
  asked.length = 0
  vi.stubGlobal('navigator', {
    mediaDevices: {
      getUserMedia: async (constraints: MediaStreamConstraints) => {
        asked.push(constraints)
        const reply = queue.shift()
        if (!reply) throw new Error('nothing was said to answer')
        if (reply instanceof DOMException) throw reply
        return reply
      },
    },
  })
}

beforeEach(() => vi.stubGlobal('MediaRecorder', FakeMediaRecorder))
afterEach(() => vi.unstubAllGlobals())

describe('VoiceRecorder.start', () => {
  it('records from the default microphone when none is chosen', async () => {
    answers(stream())
    expect(await new VoiceRecorder().start()).toEqual({ fellBack: false })
    expect(asked).toEqual([{ audio: true }])
  })

  it('records from exactly the microphone that was chosen', async () => {
    answers(stream())
    expect(await new VoiceRecorder().start('a2')).toEqual({ fellBack: false })
    expect(asked).toEqual([{ audio: { deviceId: { exact: 'a2' } } }])
  })

  it('uses the default when the chosen microphone is not there any more, and says so', async () => {
    answers(new DOMException('no such device', 'OverconstrainedError'), stream())
    expect(await new VoiceRecorder().start('gone')).toEqual({ fellBack: true })
    expect(asked).toEqual([{ audio: { deviceId: { exact: 'gone' } } }, { audio: true }])
  })

  it('does the same when the browser answers that the device was not found', async () => {
    answers(new DOMException('not found', 'NotFoundError'), stream())
    expect(await new VoiceRecorder().start('gone')).toEqual({ fellBack: true })
  })

  it('does not go on to the default when the person has said no to the microphone', async () => {
    answers(new DOMException('refused', 'NotAllowedError'), stream())
    await expect(new VoiceRecorder().start('a2')).rejects.toMatchObject({ failure: 'Denied' })
    expect(asked).toHaveLength(1)
  })

  it('fails when the default does not work either', async () => {
    answers(new DOMException('no such device', 'OverconstrainedError'), new DOMException('none at all', 'NotFoundError'))
    const failure = await new VoiceRecorder().start('gone').catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(RecordingError)
    expect(failure).toMatchObject({ failure: 'Unavailable' })
    expect(asked).toHaveLength(2)
  })

  it('does not try the default for a default that is missing', async () => {
    answers(new DOMException('none at all', 'NotFoundError'), stream())
    await expect(new VoiceRecorder().start()).rejects.toMatchObject({ failure: 'Unavailable' })
    expect(asked).toHaveLength(1)
  })
})
