import { useEffect, useMemo } from 'preact/hooks'
import { readPeaks } from '../audio/peaks'
import { Waveforms } from '../audio/waveforms'
import { useServices } from './context'

/** The levels of the sound files of one project, read as the timeline asks and let go of when the editor closes. */
export function useWaveforms(projectId: string): Waveforms {
  const { media } = useServices()
  const waves = useMemo(() => new Waveforms(async (file, durationMs, signal) => readPeaks(await media.read(projectId, file), durationMs, signal)), [media, projectId])
  useEffect(() => () => waves.dispose(), [waves])
  return waves
}
