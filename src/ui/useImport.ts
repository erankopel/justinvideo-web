import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import { isolateName } from '../i18n'
import { importVideos, type ImportOutcome, type ImportProgress } from '../import/importer'
import type { Project } from '../project/model'
import { requestPersistence } from '../storage/media-store'
import { useServices, useTranslation } from './context'
import { IMPORT_FAILURE_TEXT } from './messages'

/** Importing videos with a progress line and a list of what was refused, and files dropped anywhere on the page. */
export function useImport(into: Project | null, onDone: (outcome: ImportOutcome) => void) {
  const services = useServices()
  const { t } = useTranslation()
  const [progress, setProgress] = useState<ImportProgress | null>(null)
  const [problems, setProblems] = useState<string[]>([])
  // One import at a time: a second drop or pick while one runs is ignored, not queued behind it.
  const busy = useRef(false)

  const start = useCallback(
    async (files: File[]) => {
      if (busy.current || files.length === 0) return
      busy.current = true
      setProblems([])
      setProgress({ fileIndex: 0, fileCount: files.length, name: files[0]?.name ?? '', done: 0, total: 1 })
      let outcome: ImportOutcome
      try {
        outcome = await importVideos(services, files, {
          fallbackName: t('untitledProject'),
          onProgress: setProgress,
          ...(into ? { into } : {}),
        })
      } finally {
        busy.current = false
        setProgress(null)
      }
      setProblems(outcome.failures.map((f) => t('importFailed', { name: isolateName(f.name), reason: t(IMPORT_FAILURE_TEXT[f.failure]) })))
      if (outcome.imported > 0) requestPersistence()
      onDone(outcome)
    },
    [services, into, t, onDone],
  )

  useEffect(() => {
    const over = (event: DragEvent): void => {
      if (event.dataTransfer?.types.includes('Files')) event.preventDefault()
    }
    const drop = (event: DragEvent): void => {
      if (!event.dataTransfer?.files.length) return
      event.preventDefault()
      void start([...event.dataTransfer.files])
    }
    window.addEventListener('dragover', over)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragover', over)
      window.removeEventListener('drop', drop)
    }
  }, [start])

  return { progress, problems, start, dismiss: () => setProblems([]) }
}
