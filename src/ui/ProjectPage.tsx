import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import type { EditOp, EditResult } from '../engine'
import type { AudioOp, AudioResult } from '../engine/audio'
import type { TextOp, TextResult } from '../engine/text'
import { spans } from '../engine'
import { formatClock, isolateLtr } from '../i18n'
import type { ProjectProblem } from '../project/codec'
import { ProjectFormatError } from '../project/codec'
import { applyProjectAudio, applyProjectEdit, applyProjectText, type Project, redoProject, renameProject, undoProject } from '../project/model'
import { ProjectNotFoundError } from '../storage/project-store'
import { removeUnusedMedia } from '../storage/unused-media'
import { useServices, useTranslation } from './context'
import { Dialog } from './Dialog'
import { RenameForm } from './Home'
import { Editor } from './Editor'
import { ExportDialog } from './ExportDialog'
import { ImportStatus } from './ImportStatus'
import { PROBLEM_TEXT } from './messages'
import { hrefOf } from './route'
import { useImport } from './useImport'

type Loaded =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly project: Project }
  | { readonly kind: 'missing' }
  | { readonly kind: 'unreadable'; readonly problem: ProjectProblem }

/** A project's page: its videos and its clips, with undo and redo. The editor itself is the next stage. */
export function ProjectPage({ id }: { id: string }) {
  const { projects, media, now } = useServices()
  const { t } = useTranslation()
  const [loaded, setLoaded] = useState<Loaded>({ kind: 'loading' })
  const [renaming, setRenaming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [saveProblem, setSaveProblem] = useState(false)
  const picker = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let current = true
    setLoaded({ kind: 'loading' })
    projects.load(id).then(
      (project) => {
        if (!current) return
        setLoaded({ kind: 'ready', project })
        // This tab has the project, so no other tab is adding a file to it: what nothing can bring back is taken away.
        void removeUnusedMedia(media, project, now()).catch(() => undefined)
      },
      (error: unknown) => {
        if (!current) return
        if (error instanceof ProjectNotFoundError) setLoaded({ kind: 'missing' })
        else setLoaded({ kind: 'unreadable', problem: error instanceof ProjectFormatError ? error.problem : 'Corrupt' })
      },
    )
    return () => {
      current = false
    }
  }, [id, projects, media, now])

  const project = loaded.kind === 'ready' ? loaded.project : null

  // The project as last shown, kept where the handlers of keys and gestures can reach it without waiting for a render.
  const latest = useRef<Project | null>(null)
  latest.current = project
  // Saves go one after another, so that a quick run of edits is never written out of order. One that finds nothing waiting
  // starts at once, in the same turn as the edit, so that a reload right after it does not lose it.
  const waiting = useRef(0)
  const saving = useRef<Promise<void>>(Promise.resolve())
  // How many saves have not finished, shown on the page as data-saving so that the tests can wait for the writes.
  const [pending, setPending] = useState(0)

  /** Shows a changed project at once and saves it. A save that fails is reported, and the next edit tries again. */
  const commit = (next: Project): void => {
    latest.current = next
    setLoaded({ kind: 'ready', project: next })
    const write = (): Promise<void> => projects.save(next).then(() => setSaveProblem(false), () => setSaveProblem(true))
    waiting.current++
    setPending(waiting.current)
    const run = waiting.current === 1 ? write() : saving.current.then(write)
    saving.current = run.then(() => {
      waiting.current--
      setPending(waiting.current)
    })
  }

  const applyEditOp = (op: EditOp): EditResult => {
    const base = latest.current
    if (!base) return { kind: 'rejected', error: 'UnknownClip' }
    const step = applyProjectEdit(base, op, now())
    if (step.result.kind === 'changed') commit(step.project)
    return step.result
  }
  const applyTextOp = (op: TextOp): TextResult => {
    const base = latest.current
    if (!base) return { kind: 'rejected', error: 'Invalid' }
    const step = applyProjectText(base, op, now())
    if (step.result.kind === 'changed') commit(step.project)
    return step.result
  }
  const applyAudioOp = (op: AudioOp): AudioResult => {
    const base = latest.current
    if (!base) return { kind: 'rejected', error: 'Invalid' }
    const step = applyProjectAudio(base, op, now())
    if (step.result.kind === 'changed') commit(step.project)
    return step.result
  }
  const undo = (): void => {
    const next = latest.current && undoProject(latest.current, now())
    if (next) commit(next)
  }
  const redo = (): void => {
    const next = latest.current && redoProject(latest.current, now())
    if (next) commit(next)
  }

  const imported = useCallback((outcome: { project: Project | null }) => {
    if (outcome.project) setLoaded({ kind: 'ready', project: outcome.project })
  }, [])
  const { progress, problems, start } = useImport(project, imported)

  const remove = async (): Promise<void> => {
    await projects.delete(id)
    await media.removeProject(id).catch(() => undefined)
    location.hash = hrefOf({ name: 'home' })
  }

  const back = (
    <p>
      <a href={hrefOf({ name: 'home' })}>← {t('back')}</a>
    </p>
  )

  if (loaded.kind === 'loading') return <main>{back}<p>{t('loading')}</p></main>
  if (loaded.kind === 'missing') return <main>{back}<p role="alert">{t('notFound')}</p></main>
  if (loaded.kind === 'unreadable') {
    return (
      <main>
        {back}
        <h1>{t('projectUnreadable')}</h1>
        <p>{t(PROBLEM_TEXT[loaded.problem])}</p>
      </main>
    )
  }

  const current = loaded.project
  const sourceName = (sourceId: string): string => current.sources.find((s) => s.id === sourceId)?.displayName ?? ''
  const edit = current.edit

  return (
    <main data-saving={pending > 0}>
      <div class="shell">
        <div class="project-bar">
          <a href={hrefOf({ name: 'home' })}>← {t('back')}</a>
          <h1>
            <span class="name">{current.name}</span>{' '}
            <button type="button" onClick={() => setRenaming(true)}>
              {t('rename')}
            </button>
          </h1>
          <span class="buttons">
            <button type="button" disabled={edit.undoStack.length === 0} onClick={undo}>
              {t('undo')}
            </button>
            <button type="button" disabled={edit.redoStack.length === 0} onClick={redo}>
              {t('redo')}
            </button>
            <button type="button" disabled={progress !== null} onClick={() => picker.current?.click()}>
              {t('addVideos')}
            </button>
            <button type="button" class="primary" data-testid="export" disabled={edit.timeline.clips.length === 0} onClick={() => setExporting(true)}>
              {t('exportButton')}
            </button>
            <button type="button" class="danger" onClick={() => setDeleting(true)}>
              {t('deleteProject')}
            </button>
          </span>
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
        </div>
        <ExportDialog project={current} open={exporting} onClose={() => setExporting(false)} />
        <ImportStatus progress={progress} problems={problems} />
        {saveProblem && <p role="alert">{t('saveFailed')}</p>}

        <Editor project={current} onEdit={applyEditOp} onText={applyTextOp} onAudio={applyAudioOp} onUndo={undo} onRedo={redo} />
      </div>
      <p class="hint">{t('selectHint')}</p>

      <h2>{t('timelineHeading')}</h2>
      <ol class="clips" data-testid="clips">
        {spans(edit.timeline).map((span, index) => (
          <li key={span.clip.id}>
            {t('clipLine', { n: index + 1, from: isolateLtr(formatClock(span.startMs)), to: isolateLtr(formatClock(span.endMs)) })} <span class="facts">{sourceName(span.clip.sourceId)}</span>
          </li>
        ))}
      </ol>

      <h2>{t('recordings')}</h2>
      <ul class="sources">
        {current.sources.map((source) => (
          <li key={source.id}>
            <strong>{source.displayName}</strong>
            <span class="facts">
              {' '}
              {t('sourceDetails', {
                width: source.rotationDegrees % 180 === 0 ? source.width : source.height,
                height: source.rotationDegrees % 180 === 0 ? source.height : source.width,
                time: isolateLtr(formatClock(source.durationMs)),
              })}
              , {source.hasAudio ? t('sourceSound') : t('sourceSilent')}
            </span>
          </li>
        ))}
      </ul>

      <Dialog open={renaming} title={t('renameTitle')} onClose={() => setRenaming(false)}>
        <RenameForm
          project={current}
          onCancel={() => setRenaming(false)}
          onSave={(name) => {
            setRenaming(false)
            commit(renameProject(current, name, now()))
          }}
        />
      </Dialog>
      <Dialog open={deleting} title={t('deleteTitle')} onClose={() => setDeleting(false)}>
        <p>{t('deleteMessage')}</p>
        <div class="buttons">
          <button type="button" onClick={() => setDeleting(false)}>
            {t('cancel')}
          </button>
          <button type="button" class="danger" onClick={() => void remove()}>
            {t('deleteProject')}
          </button>
        </div>
      </Dialog>
    </main>
  )
}
