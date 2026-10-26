/** A microphone the browser knows: the code it gives it, and its name, which is empty until the browser has been allowed to use one. */
export interface Microphone {
  readonly id: string
  readonly label: string
}

export interface Microphones {
  readonly list: readonly Microphone[]
  /** Whether the browser has told the names of the microphones, which it does only once it has been allowed to use one. */
  readonly named: boolean
}

/** Stand-ins that some browsers list for whatever the computer uses by default: not microphones of their own. */
const STAND_INS = new Set(['default', 'communications'])

/**
 * The microphones this browser knows, without the stand-ins for the default. Where the stand-ins are all there is, the
 * default one is listed, so that a computer with a single microphone still has one.
 */
export async function listMicrophones(): Promise<Microphones> {
  if (!navigator.mediaDevices?.enumerateDevices) return { list: [], named: false }
  let devices: MediaDeviceInfo[]
  try {
    devices = await navigator.mediaDevices.enumerateDevices()
  } catch {
    return { list: [], named: false }
  }
  const inputs = devices.filter((device) => device.kind === 'audioinput')
  const own = inputs.filter((device) => !STAND_INS.has(device.deviceId))
  const chosen = own.length > 0 ? own : inputs.filter((device) => device.deviceId !== 'communications')
  return { list: chosen.map((device) => ({ id: device.deviceId, label: device.label })), named: chosen.some((device) => device.label !== '') }
}

/** What to ask the browser for, to record from a microphone: the one chosen, which it must be, or else the default. */
export const audioConstraints = (microphoneId: string | null): MediaStreamConstraints => ({
  audio: microphoneId === null ? true : { deviceId: { exact: microphoneId } },
})

const MICROPHONE_KEY = 'justinvideo-microphone'

/** The microphone the person chose last time in this browser, or null for the default. */
export function savedMicrophone(): string | null {
  try {
    return localStorage.getItem(MICROPHONE_KEY) || null
  } catch {
    return null
  }
}

/** Keeps the choice in this browser. The default is kept as no choice. */
export function saveMicrophone(microphoneId: string | null): void {
  try {
    if (microphoneId === null) localStorage.removeItem(MICROPHONE_KEY)
    else localStorage.setItem(MICROPHONE_KEY, microphoneId)
  } catch {
    // The choice is only remembered while storage allows.
  }
}

/** The chosen microphone if the browser still has it, else null, so a microphone that has been unplugged shows as the default. */
export const availableChoice = (choice: string | null, microphones: Microphones): string | null =>
  choice !== null && microphones.list.some((microphone) => microphone.id === choice) ? choice : null

/** Whether an error from asking for a microphone means that the one asked for is not there, as against that the person said no. */
export const isMissingDevice = (error: unknown): boolean => {
  const name = error instanceof DOMException ? error.name : error instanceof Error ? error.name : ''
  return name === 'OverconstrainedError' || name === 'NotFoundError'
}
