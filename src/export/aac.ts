import { canEncodeAudio } from 'mediabunny'

/** What an AAC encoder is asked to do, which is what the export asks of it: stereo at 48 kHz, 192 kbit/s. */
export const AAC_PROBE = { numberOfChannels: 2, sampleRate: 48_000, bitrate: 192_000 } as const

let loading: Promise<boolean> | null = null

/**
 * Gives the export an AAC encoder of its own, for a browser that has none, as Firefox and Chrome on Linux have not. It is the
 * AAC encoder of FFmpeg built for the browser, in an extension of Mediabunny that is loaded only now, when it is wanted (it is
 * a megabyte), and which runs in a worker of its own. True once Mediabunny can encode AAC with it; false where it could not be
 * loaded or started, which is asked again the next time. The browser's own encoder is always used where there is one.
 */
export function softwareAac(): Promise<boolean> {
  loading ??= (async () => {
    try {
      const { registerAacEncoder } = await import('@mediabunny/aac-encoder')
      registerAacEncoder()
      return await canEncodeAudio('aac', AAC_PROBE)
    } catch {
      return false
    }
  })().then((ready) => {
    if (!ready) loading = null
    return ready
  })
  return loading
}
