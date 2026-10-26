import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import { type HeldLock, holdProjectLock } from '../storage/project-lock'
import { useTranslation } from './context'
import { ProjectPage } from './ProjectPage'
import { hrefOf } from './route'

type Gate = 'checking' | 'held' | 'busy' | 'lost'

/**
 * Lets a project be opened in one tab at a time. A second tab is told that the project is open elsewhere and may take it
 * over; the tab that loses it stops, and takes it back the same way. Each time a tab takes a project it loads it afresh, so
 * what it shows is what is stored.
 */
export function ProjectGate({ id }: { id: string }) {
  const { t } = useTranslation()
  const [gate, setGate] = useState<Gate>('checking')
  const [epoch, setEpoch] = useState(0)
  const held = useRef<HeldLock | null>(null)
  const gone = useRef(false)

  const take = useCallback(
    async (steal: boolean): Promise<void> => {
      held.current?.release()
      held.current = null
      const lock = await holdProjectLock(id, {
        steal,
        onLost: () => {
          held.current = null
          if (!gone.current) setGate('lost')
        },
      })
      if (gone.current) {
        lock?.release()
        return
      }
      held.current = lock
      if (lock) setEpoch((n) => n + 1)
      setGate(lock ? 'held' : 'busy')
    },
    [id],
  )

  useEffect(() => {
    gone.current = false
    void take(false)
    return () => {
      gone.current = true
      held.current?.release()
      held.current = null
    }
  }, [take])

  if (gate === 'held') return <ProjectPage key={epoch} id={id} />
  if (gate === 'checking') {
    return (
      <main>
        <p>{t('loading')}</p>
      </main>
    )
  }
  const lost = gate === 'lost'
  return (
    <main data-gate={gate}>
      <p>
        <a href={hrefOf({ name: 'home' })}>← {t('back')}</a>
      </p>
      <h1>{t(lost ? 'projectLostTitle' : 'projectBusyTitle')}</h1>
      <p role="alert">{t(lost ? 'projectLostMessage' : 'projectBusyMessage')}</p>
      <p>
        <button type="button" class="primary" data-testid="use-here" onClick={() => void take(true)}>
          {t('projectUseHere')}
        </button>
      </p>
    </main>
  )
}
