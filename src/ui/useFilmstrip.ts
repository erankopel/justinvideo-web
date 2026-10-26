import { useEffect, useMemo, useRef } from 'preact/hooks'
import type { Source } from '../project/model'
import { Filmstrip, readerFromFiles } from '../timeline/filmstrip'
import { STRIP_PX } from '../timeline/tiles'
import { useServices } from './context'

/** Device pixels to a CSS pixel for the pictures on the clips. Beyond two the pictures would cost more than they show. */
export const pictureScale = (): number => Math.min(typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1, 2)

/** The pictures for the clips of one project: read from its recordings as the timeline asks, and let go of when the editor closes. */
export function useFilmstrip(projectId: string, sources: readonly Source[]): Filmstrip {
  const { media } = useServices()
  const latest = useRef(sources)
  latest.current = sources
  const film = useMemo(
    () =>
      new Filmstrip(
        readerFromFiles(async (sourceId) => {
          const source = latest.current.find((s) => s.id === sourceId)
          if (!source) throw new Error('A clip refers to a recording the project does not have')
          return media.read(projectId, source.file)
        }, Math.round(STRIP_PX * pictureScale())),
      ),
    [media, projectId],
  )
  useEffect(() => () => film.dispose(), [film])
  return film
}
