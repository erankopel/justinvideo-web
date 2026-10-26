import type { Project } from '../project/model'
import type { MediaStore } from '../storage/media-store'
import type { ExportMode } from './client'
import type { ExportFailure } from './failure'
import type { ExportSettings } from './settings'

/** What the browser is like, as far as it bears on an export that did not work. */
export interface BrowserFacts {
  userAgent: string
  language: string
  cores?: number
  memoryGb?: number
  usedMb?: number
  quotaMb?: number
  storage: string
  offscreenCanvas: boolean
  videoEncoder: boolean
  audioEncoder: boolean
}

/** What can be told of the browser without asking the person anything. Nothing here leaves the page by itself. */
export async function gatherBrowserFacts(media: MediaStore): Promise<BrowserFacts> {
  const scope = globalThis as unknown as { navigator?: Navigator & { deviceMemory?: number }; OffscreenCanvas?: unknown; VideoEncoder?: unknown; AudioEncoder?: unknown }
  const nav = scope.navigator
  let usedMb: number | undefined
  let quotaMb: number | undefined
  try {
    const estimate = await nav?.storage?.estimate?.()
    if (estimate?.usage !== undefined) usedMb = Math.round(estimate.usage / 1_048_576)
    if (estimate?.quota !== undefined) quotaMb = Math.round(estimate.quota / 1_048_576)
  } catch {
    // The browser would not say.
  }
  return {
    userAgent: nav?.userAgent ?? '',
    language: nav?.language ?? '',
    ...(nav?.hardwareConcurrency ? { cores: nav.hardwareConcurrency } : {}),
    ...(nav?.deviceMemory ? { memoryGb: nav.deviceMemory } : {}),
    ...(usedMb !== undefined ? { usedMb } : {}),
    ...(quotaMb !== undefined ? { quotaMb } : {}),
    storage: media.kind,
    offscreenCanvas: scope.OffscreenCanvas !== undefined,
    videoEncoder: scope.VideoEncoder !== undefined,
    audioEncoder: scope.AudioEncoder !== undefined,
  }
}

export interface DiagnosticsFacts {
  failure: ExportFailure
  /** What the error said, in a line or two. */
  detail: string
  settings: ExportSettings
  mode: ExportMode | null
  project: Project
  browser: BrowserFacts
  at: Date
}

const yesNo = (value: boolean): string => (value ? 'yes' : 'no')
const seconds = (ms: number): string => `${(ms / 1000).toFixed(1)} s`

/**
 * A few lines about an export that failed, for the person to paste into a message when they ask for help. It tells how the
 * project is made and what the browser is, and never the names of the files, the texts of the titles or anything of the
 * pictures and the sound.
 */
export function diagnosticsText(facts: DiagnosticsFacts): string {
  const { project, settings, browser } = facts
  const edit = project.edit
  const recordings = project.sources.map((source) => {
    const turned = source.rotationDegrees % 180 !== 0
    return `${turned ? source.height : source.width}x${turned ? source.width : source.height}, ${seconds(source.durationMs)}, ${source.hasAudio ? 'with sound' : 'no sound'}`
  })
  const lines = [
    'JustInVideo export problem',
    `When: ${facts.at.toISOString()}`,
    `Problem: ${facts.failure}`,
    `Detail: ${facts.detail || 'none'}`,
    `Made in: ${facts.mode === 'worker' ? 'a worker' : facts.mode === 'main' ? 'the page' : 'not known'}`,
    `Settings: ${settings.shape}, ${settings.quality}, ${settings.framing}, ${settings.fps} frames a second`,
    `Project: ${edit.timeline.clips.length} clips, ${seconds(edit.timeline.durationMs)}, ${edit.texts.length} titles and captions, ${edit.mix.items.length} pieces of music and voiceover`,
    `Recordings: ${recordings.length > 0 ? recordings.join('; ') : 'none'}`,
    `Browser: ${browser.userAgent || 'not known'}`,
    `Language: ${browser.language || 'not known'}`,
    `Device: ${browser.cores ?? '?'} cores, ${browser.memoryGb !== undefined ? `${browser.memoryGb} GB of memory` : 'memory not known'}`,
    `Storage: ${browser.storage}${browser.usedMb !== undefined && browser.quotaMb !== undefined ? `, ${browser.usedMb} MB used of ${browser.quotaMb} MB` : ''}`,
    `Features: OffscreenCanvas ${yesNo(browser.offscreenCanvas)}, VideoEncoder ${yesNo(browser.videoEncoder)}, AudioEncoder ${yesNo(browser.audioEncoder)}`,
  ]
  return `${lines.join('\n')}\n`
}

/** What an error says, in one line and not longer than a line should be. */
export function describeError(error: unknown): string {
  const one = (value: unknown): string => {
    if (value instanceof Error) return `${value.name}: ${value.message}`
    return typeof value === 'string' ? value : ''
  }
  const text = [one(error), error instanceof Error && error.cause ? `caused by ${one(error.cause)}` : ''].filter(Boolean).join(' ')
  return text.replace(/\s+/g, ' ').slice(0, 300)
}
