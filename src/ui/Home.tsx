import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import { formatBytes, formatClock, isolateLtr } from '../i18n'
import type { ImportOutcome } from '../import/importer'
import { type Project, renameProject, MAX_NAME_LENGTH } from '../project/model'
import type { ProjectEntry } from '../storage/project-store'
import { useServices, useTranslation } from './context'
import { Dialog } from './Dialog'
import { PROBLEM_TEXT } from './messages'
import { hrefOf } from './route'
import { withProjectLock } from '../storage/project-lock'
import { Thumbnail } from './Thumbnail'
import { useImport } from './useImport'
import { ImportStatus } from './ImportStatus'

async function storageUsage(): Promise<{ used: number; quota: number } | null> {
  try {
    const { usage, quota } = (await navigator.storage?.estimate?.()) ?? {}
    return usage !== undefined && quota !== undefined ? { used: usage, quota } : null
  } catch {
    return null
  }
}

export function Home() {
  const { projects, media, now } = useServices()
  const { t, language } = useTranslation()
  const [entries, setEntries] = useState<ProjectEntry[] | null>(null)
  const [usage, setUsage] = useState<{ used: number; quota: number } | null>(null)
  const [renaming, setRenaming] = useState<Project | null>(null)
  const [deleting, setDeleting] = useState<{ id: string; name: string } | null>(null)
  const [saveProblem, setSaveProblem] = useState(false)
  const [busy, setBusy] = useState(false)
  const picker = useRef<HTMLInputElement>(null)

  const refresh = useCallback(async () => {
    setEntries(await projects.list())
    setUsage(await storageUsage())
  }, [projects])
  useEffect(() => {
    void refresh()
  }, [refresh])

  const finished = useCallback(
    (outcome: ImportOutcome) => {
      // A project that was made without a problem opens straight away, as on Android. Otherwise the list stays, with what was refused.
      if (outcome.project && outcome.failures.length === 0) location.hash = hrefOf({ name: 'project', id: outcome.project.id })
      else void refresh()
    },
    [refresh],
  )
  const { progress, problems, start } = useImport(null, finished)

  // A project that another tab has open is left alone: what is changed here would be overwritten there, or overwrite it.
  const remove = async (id: string): Promise<void> => {
    setDeleting(null)
    const outcome = await withProjectLock(id, async () => {
      await projects.delete(id)
      await media.removeProject(id).catch(() => undefined)
    })
    setBusy(outcome === 'busy')
    await refresh()
  }

  const rename = async (project: Project, name: string): Promise<void> => {
    setRenaming(null)
    try {
      // The project is read again, so that a change made in another tab since the list was drawn is not written over.
      const outcome = await withProjectLock(project.id, async () => projects.save(renameProject(await projects.load(project.id), name, now())))
      setBusy(outcome === 'busy')
      setSaveProblem(false)
    } catch {
      setSaveProblem(true)
    }
    await refresh()
  }

  return (
    <main>
      <h1>{t('projectsTitle')}</h1>
      <p>
        <button type="button" class="primary" disabled={progress !== null} onClick={() => picker.current?.click()}>
          {t('newProject')}
        </button>
        <input
          ref={picker}
          type="file"
          accept="video/*,.mkv,.mov,.mp4,.m4v,.webm"
          multiple
          hidden
          data-testid="video-input"
          onChange={(event) => {
            const input = event.currentTarget
            void start([...(input.files ?? [])])
            input.value = ''
          }}
        />
      </p>
      <p class="hint">{t('dropHint')}</p>
      <ImportStatus progress={progress} problems={problems} />
      {saveProblem && <p role="alert">{t('saveFailed')}</p>}
      {busy && <p role="alert" data-testid="project-busy">{t('projectBusyHome')}</p>}

      {entries === null ? (
        <p>{t('loading')}</p>
      ) : entries.length === 0 ? (
        <p>{t('noProjects')}</p>
      ) : (
        <ul class="projects">
          {entries.map((entry) =>
            entry.kind === 'readable' ? (
              <li key={entry.project.id} class="project">
                <a class="open" href={hrefOf({ name: 'project', id: entry.project.id })}>
                  <Thumbnail id={entry.project.id} />
                  <span class="name">{entry.project.name}</span>
                </a>
                <span class="facts">
                  {t('projectClips', { n: entry.project.edit.timeline.clips.length })} · {t('projectLength', { time: isolateLtr(formatClock(entry.project.edit.timeline.durationMs)) })}
                </span>
                <span class="facts">{t('projectChanged', { date: new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' }).format(entry.project.modifiedAtMs) })}</span>
                <span class="actions">
                  <button type="button" onClick={() => setRenaming(entry.project)}>
                    {t('rename')}
                  </button>
                  <button type="button" aria-label={t('deleteNamed', { name: entry.project.name })} onClick={() => setDeleting({ id: entry.project.id, name: entry.project.name })}>
                    {t('deleteProject')}
                  </button>
                </span>
              </li>
            ) : (
              <li key={entry.id} class="project damaged">
                <span class="name">{t('projectUnreadable')}</span>
                <span class="facts">{t(PROBLEM_TEXT[entry.problem])}</span>
                <span class="actions">
                  <button type="button" aria-label={t('deleteNamed', { name: entry.id })} onClick={() => setDeleting({ id: entry.id, name: entry.id })}>
                    {t('deleteProject')}
                  </button>
                </span>
              </li>
            ),
          )}
        </ul>
      )}

      {usage && <p class="hint">{t('storageUsed', { used: formatBytes(usage.used, language), quota: formatBytes(usage.quota, language) })}</p>}
      <p class="hint">{t('storageNote')}</p>

      <Dialog open={renaming !== null} title={t('renameTitle')} onClose={() => setRenaming(null)}>
        {renaming && <RenameForm project={renaming} onSave={(name) => void rename(renaming, name)} onCancel={() => setRenaming(null)} />}
      </Dialog>
      <Dialog open={deleting !== null} title={t('deleteTitle')} onClose={() => setDeleting(null)}>
        {deleting && (
          <>
            <p>{t('deleteMessage')}</p>
            <div class="buttons">
              <button type="button" onClick={() => setDeleting(null)}>
                {t('cancel')}
              </button>
              <button type="button" class="danger" onClick={() => void remove(deleting.id)}>
                {t('deleteProject')}
              </button>
            </div>
          </>
        )}
      </Dialog>
    </main>
  )
}

export function RenameForm({ project, onSave, onCancel }: { project: Project; onSave: (name: string) => void; onCancel: () => void }) {
  const { t } = useTranslation()
  const [name, setName] = useState(project.name)
  return (
    <form
      method="dialog"
      onSubmit={(event) => {
        event.preventDefault()
        if (name.trim() !== '') onSave(name)
      }}
    >
      <label>
        {t('renameLabel')}
        <input type="text" value={name} maxLength={MAX_NAME_LENGTH} autofocus onInput={(event) => setName(event.currentTarget.value)} />
      </label>
      <div class="buttons">
        <button type="button" onClick={onCancel}>
          {t('cancel')}
        </button>
        <button type="submit" class="primary" disabled={name.trim() === ''}>
          {t('save')}
        </button>
      </div>
    </form>
  )
}
