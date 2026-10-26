import { afterEach, describe, expect, it, vi } from 'vitest'
import { availableChoice, audioConstraints, isMissingDevice, listMicrophones, saveMicrophone, savedMicrophone } from './devices'

const device = (deviceId: string, label: string, kind: MediaDeviceKind = 'audioinput'): MediaDeviceInfo =>
  ({ deviceId, label, kind, groupId: deviceId, toJSON: () => ({}) }) as MediaDeviceInfo

const withDevices = (devices: MediaDeviceInfo[] | Error): void => {
  vi.stubGlobal('navigator', { mediaDevices: { enumerateDevices: async () => (devices instanceof Error ? Promise.reject(devices) : devices) } })
}

afterEach(() => vi.unstubAllGlobals())

describe('listMicrophones', () => {
  it('lists the microphones with their names, and leaves out the cameras, the speakers and the stand-ins for the default', async () => {
    withDevices([
      device('default', 'Default - Studio microphone'),
      device('communications', 'Communications - Studio microphone'),
      device('a1', 'Studio microphone'),
      device('a2', 'Headset'),
      device('v1', 'Camera', 'videoinput'),
      device('o1', 'Speakers', 'audiooutput'),
    ])
    const found = await listMicrophones()
    expect(found.list).toEqual([
      { id: 'a1', label: 'Studio microphone' },
      { id: 'a2', label: 'Headset' },
    ])
    expect(found.named).toBe(true)
  })

  it('says the names are not known when the browser has not been allowed to use a microphone yet', async () => {
    withDevices([device('a1', ''), device('a2', '')])
    const found = await listMicrophones()
    expect(found.list).toEqual([
      { id: 'a1', label: '' },
      { id: 'a2', label: '' },
    ])
    expect(found.named).toBe(false)
  })

  it('lists the default one when the stand-ins are all that there is, so that one microphone is still a choice', async () => {
    withDevices([device('default', 'Default - Built-in microphone'), device('communications', 'Communications - Built-in microphone')])
    expect((await listMicrophones()).list).toEqual([{ id: 'default', label: 'Default - Built-in microphone' }])
  })

  it('has no microphones when the browser cannot say, or has none', async () => {
    withDevices([])
    expect(await listMicrophones()).toEqual({ list: [], named: false })
    withDevices(new Error('refused'))
    expect(await listMicrophones()).toEqual({ list: [], named: false })
    vi.stubGlobal('navigator', {})
    expect(await listMicrophones()).toEqual({ list: [], named: false })
  })
})

describe('audioConstraints', () => {
  it('asks for the default microphone, or for exactly the one chosen', () => {
    expect(audioConstraints(null)).toEqual({ audio: true })
    expect(audioConstraints('a2')).toEqual({ audio: { deviceId: { exact: 'a2' } } })
  })
})

describe('the choice that is kept', () => {
  const storage = (): Map<string, string> => {
    const kept = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => kept.get(key) ?? null,
      setItem: (key: string, value: string) => void kept.set(key, value),
      removeItem: (key: string) => void kept.delete(key),
    })
    return kept
  }

  it('is kept in the browser, and the default is kept as no choice', () => {
    const kept = storage()
    expect(savedMicrophone()).toBeNull()
    saveMicrophone('a2')
    expect(savedMicrophone()).toBe('a2')
    expect(kept.size).toBe(1)
    saveMicrophone(null)
    expect(savedMicrophone()).toBeNull()
    expect(kept.size).toBe(0)
  })

  it('is only remembered while storage allows: a browser that refuses it gives the default and does not fail', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new DOMException('blocked', 'SecurityError')
      },
      setItem: () => {
        throw new DOMException('blocked', 'SecurityError')
      },
      removeItem: () => {
        throw new DOMException('blocked', 'SecurityError')
      },
    })
    expect(savedMicrophone()).toBeNull()
    expect(() => saveMicrophone('a2')).not.toThrow()
    expect(() => saveMicrophone(null)).not.toThrow()
  })
})

describe('availableChoice', () => {
  const microphones = { list: [{ id: 'a1', label: 'One' }, { id: 'a2', label: 'Two' }], named: true }

  it('is the choice when the browser still has that microphone, and the default when it does not, or when none was made', () => {
    expect(availableChoice('a2', microphones)).toBe('a2')
    expect(availableChoice('gone', microphones)).toBeNull()
    expect(availableChoice(null, microphones)).toBeNull()
  })
})

describe('isMissingDevice', () => {
  it('knows that the microphone asked for is not there, as against that the person said no', () => {
    expect(isMissingDevice(new DOMException('no such device', 'OverconstrainedError'))).toBe(true)
    expect(isMissingDevice(new DOMException('none', 'NotFoundError'))).toBe(true)
    expect(isMissingDevice(new DOMException('refused', 'NotAllowedError'))).toBe(false)
    expect(isMissingDevice(new Error('other'))).toBe(false)
    expect(isMissingDevice('text')).toBe(false)
  })
})
