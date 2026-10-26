import { useEffect, useRef, useState } from 'preact/hooks'
import { type ExportFailure, failureOf, isCancelled } from '../export/failure'
import { type ExportMode, runExport } from '../export/client'
import { describeError, diagnosticsText, gatherBrowserFacts } from '../export/diagnostics'
import type { ExportResult } from '../export/runner'
import {
  defaultExportSettings,
  EXPORT_FRAME_RATES,
  EXPORT_FRAMINGS,
  EXPORT_QUALITIES,
  EXPORT_SHAPES,
  type ExportFraming,
  type ExportQuality,
  type ExportSettings,
  type ExportShape,
} from '../export/settings'
import { formatBytes, isolateLtr, isolateName, isRightToLeft } from '../i18n'
import type { Project } from '../project/model'
import type { StringKey } from '../strings'
import { useServices, useTranslation } from './context'
import { Dialog } from './Dialog'

type Phase =
  | { readonly kind: 'options' }
  | { readonly kind: 'running'; readonly percent: number }
  | { readonly kind: 'done'; readonly result: ExportResult; readonly url: string }
  | { readonly kind: 'failed'; readonly failure: ExportFailure; readonly detail: string }

/** Whether this browser can hand a file to the share sheet of the device. */
const canShare = (file: File): boolean => typeof navigator.share === 'function' && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })

const SHAPE_TEXT: Readonly<Record<ExportShape, StringKey>> = { vertical: 'exportShapeVertical', wide: 'exportShapeWide', square: 'exportShapeSquare' }
const FRAMING_TEXT: Readonly<Record<ExportFraming, StringKey>> = { fill: 'exportFramingFill', fit: 'exportFramingFit' }
const QUALITY_TEXT: Readonly<Record<ExportQuality, string>> = { p720: '720p', p1080: '1080p' }

const FAILURE_TEXT: Readonly<Record<ExportFailure, StringKey>> = {
  NothingToExport: 'exportFailedNothing',
  SourceMissing: 'exportFailedMissing',
  AudioMissing: 'exportFailedAudio',
  NoSpace: 'exportFailedSpace',
  EncoderFailed: 'exportFailedEncoder',
  DecoderFailed: 'exportFailedDecode',
  Failed: 'exportFailedOther',
}

function Group<T extends string | number>({ name, legend, options, value, onChange }: { name: string; legend: string; options: readonly (readonly [T, string])[]; value: T; onChange: (value: T) => void }) {
  return (
    <fieldset class="choice">
      <legend>{legend}</legend>
      {options.map(([option, label]) => (
        <label key={option}>
          <input type="radio" name={name} value={String(option)} checked={value === option} data-testid={`${name}-${option}`} onChange={() => onChange(option)} />
          <span>{label}</span>
        </label>
      ))}
    </fieldset>
  )
}

/**
 * The export, from choosing how to make the video to downloading it. One dialog follows the export through its steps. The
 * video is made in this browser from the project as it was when the export started, and never leaves it.
 */
export function ExportDialog({ project, open, onClose }: { project: Project; open: boolean; onClose: () => void }) {
  const { media } = useServices()
  const { t, language } = useTranslation()
  const [settings, setSettings] = useState<ExportSettings>(() => defaultExportSettings(project))
  const [phase, setPhase] = useState<Phase>({ kind: 'options' })
  // Where the export is made, which the page shows to the tests: away from the page in a worker, or in the page.
  const [mode, setMode] = useState<ExportMode | null>(null)
  const running = useRef<AbortController | null>(null)
  const latest = useRef(project)
  latest.current = project
  const kept = useRef<{ result: ExportResult; url: string } | null>(null)
  // What came of pressing Share, or of copying the details of a failure.
  const [shareFailed, setShareFailed] = useState(false)
  const [copied, setCopied] = useState<{ text: string; done: boolean } | null>(null)

  // Each time it opens, the options start from what suits the footage as it is now.
  useEffect(() => {
    if (open) setSettings(defaultExportSettings(latest.current))
  }, [open])

  const forget = (): void => {
    const done = kept.current
    kept.current = null
    if (done) {
      URL.revokeObjectURL(done.url)
      void done.result.discard()
    }
  }
  // Leaving the page stops an export that is running and lets go of one that is finished.
  useEffect(
    () => () => {
      running.current?.abort()
      forget()
    },
    [],
  )

  const start = async (): Promise<void> => {
    if (running.current) return
    const abort = new AbortController()
    running.current = abort
    setMode(null)
    setPhase({ kind: 'running', percent: 0 })
    let shown = -1
    try {
      const result = await runExport(media, latest.current, settings, {
        signal: abort.signal,
        rightToLeft: isRightToLeft(language),
        onMode: setMode,
        onProgress: (fraction) => {
          const percent = Math.floor(fraction * 100)
          if (percent === shown) return
          shown = percent
          setPhase({ kind: 'running', percent })
        },
      })
      const url = URL.createObjectURL(result.file)
      kept.current = { result, url }
      setPhase({ kind: 'done', result, url })
    } catch (error) {
      setPhase(isCancelled(error) ? { kind: 'options' } : { kind: 'failed', failure: failureOf(error), detail: describeError(error) })
    } finally {
      running.current = null
    }
  }

  const cancel = (): void => running.current?.abort()
  const reset = (): void => {
    forget()
    setShareFailed(false)
    setCopied(null)
    setPhase({ kind: 'options' })
  }
  const close = (): void => {
    cancel()
    reset()
    onClose()
  }
  const again = reset

  /** Hands the finished video to the share sheet of the device. The person leaving it is not a failure. */
  const share = async (result: ExportResult): Promise<void> => {
    setShareFailed(false)
    try {
      await navigator.share({ files: [result.file], title: result.fileName })
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) setShareFailed(true)
    }
  }

  /** Puts a few lines about the failure on the clipboard, for the person to send if they want help; the site sends nothing. */
  const copyDetails = async (failure: ExportFailure, detail: string): Promise<void> => {
    const text = diagnosticsText({ failure, detail, settings, mode, project: latest.current, browser: await gatherBrowserFacts(media), at: new Date() })
    try {
      await navigator.clipboard.writeText(text)
      setCopied({ text, done: true })
    } catch {
      setCopied({ text, done: false })
    }
  }

  return (
    <Dialog open={open} title={t('exportTitle')} onClose={close}>
      {phase.kind === 'options' && (
        <form
          class="dialog-form"
          method="dialog"
          onSubmit={(event) => {
            event.preventDefault()
            void start()
          }}
        >
          <Group name="export-shape" legend={t('exportShapeLabel')} options={EXPORT_SHAPES.map((shape) => [shape, t(SHAPE_TEXT[shape])] as const)} value={settings.shape} onChange={(shape) => setSettings({ ...settings, shape })} />
          <Group name="export-quality" legend={t('exportSizeLabel')} options={EXPORT_QUALITIES.map((quality) => [quality, QUALITY_TEXT[quality]] as const)} value={settings.quality} onChange={(quality) => setSettings({ ...settings, quality })} />
          <Group name="export-framing" legend={t('exportFramingLabel')} options={EXPORT_FRAMINGS.map((framing) => [framing, t(FRAMING_TEXT[framing])] as const)} value={settings.framing} onChange={(framing) => setSettings({ ...settings, framing })} />
          <Group name="export-fps" legend={t('exportFpsLabel')} options={EXPORT_FRAME_RATES.map((rate) => [rate, String(rate)] as const)} value={settings.fps} onChange={(fps) => setSettings({ ...settings, fps })} />
          <p class="hint">{t('exportFpsNote')}</p>
          <div class="buttons">
            <button type="button" data-testid="export-cancel" onClick={close}>
              {t('cancel')}
            </button>
            <button type="submit" class="primary" data-testid="export-start">
              {t('exportButton')}
            </button>
          </div>
        </form>
      )}
      {phase.kind === 'running' && (
        <div class="dialog-form" data-testid="export-running" data-mode={mode ?? undefined}>
          <p>{phase.percent === 0 ? t('exportPreparing') : t('exportRunning', { percent: isolateLtr(`${phase.percent}%`) })}</p>
          <progress max={100} value={phase.percent} aria-label={t('exportTitle')} data-testid="export-progress" />
          <p class="hint">{t('exportKeepOpen')}</p>
          <div class="buttons">
            <button type="button" data-testid="export-cancel" onClick={cancel}>
              {t('cancel')}
            </button>
          </div>
        </div>
      )}
      {phase.kind === 'done' && (
        <div class="dialog-form" data-testid="export-done" data-mode={mode ?? undefined}>
          <h3>{t('exportDoneTitle')}</h3>
          <p>{t('exportDoneMessage', { name: isolateName(phase.result.fileName), size: formatBytes(phase.result.file.size, language) })}</p>
          {phase.result.container === 'webm' && <p class="hint">{t('exportWebmNote')}</p>}
          <div class="buttons">
            <a class="button primary" href={phase.url} download={phase.result.fileName} data-testid="export-download">
              {t('exportDownload')}
            </a>
            {canShare(phase.result.file) && (
              <button type="button" data-testid="export-share" onClick={() => void share(phase.result)}>
                {t('exportShare')}
              </button>
            )}
            <button type="button" data-testid="export-close" onClick={close}>
              {t('exportClose')}
            </button>
          </div>
          {shareFailed && <p role="alert">{t('exportShareFailed')}</p>}
        </div>
      )}
      {phase.kind === 'failed' && (
        <div class="dialog-form" data-testid="export-failed">
          <h3>{t('exportFailedTitle')}</h3>
          <p role="alert">{t(FAILURE_TEXT[phase.failure])}</p>
          <div class="buttons">
            <button type="button" class="primary" data-testid="export-retry" onClick={again}>
              {t('exportTryAgain')}
            </button>
            <button type="button" data-testid="export-copy" onClick={() => void copyDetails(phase.failure, phase.detail)}>
              {t('exportCopyDetails')}
            </button>
            <button type="button" data-testid="export-close" onClick={close}>
              {t('exportClose')}
            </button>
          </div>
          {copied && (
            <p role="status" data-testid="export-copy-note">
              {copied.done ? t('exportCopied', { email: isolateLtr('justinvideo@medicom.vip') }) : t('exportCopyFailed')}
            </p>
          )}
          {copied && !copied.done && <textarea readOnly dir="ltr" rows={8} value={copied.text} data-testid="export-details" onFocus={(event) => event.currentTarget.select()} />}
        </div>
      )}
    </Dialog>
  )
}
