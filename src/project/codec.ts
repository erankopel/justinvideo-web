import { type AudioItem, type AudioKind, type AudioMix, EMPTY_MIX, validateMix } from '../engine/audio'
import {
  type Clip,
  clip,
  DEFAULT_VOLUME_PERCENT,
  EXPORT_FPS_CHOICES,
  HISTORY_LIMIT,
  editState,
  isSafeRelativePath,
  isValidId,
  MAX_TIMELINE_MS,
  timeline,
  validateClips,
  type Snapshot,
  type Timeline,
} from '../engine'
import { sameData } from '../engine/equal'
import {
  onOutput,
  onSource,
  type TextDirection,
  type TextItem,
  type TextPosition,
  type TextSize,
  validateTexts,
} from '../engine/text'
import { MAX_NAME_LENGTH, MAX_SOURCES, PROJECT_FORMAT, projectContext, type Project, type Source } from './model'

/** Why a saved project could not be read. */
export type ProjectProblem =
  /** The file is not readable JSON of the expected shape. */
  | 'Corrupt'
  /** The file was written by a newer version. */
  | 'NewerFormat'
  /** The file reads, but its contents break a rule, such as a clip that runs past its recording. */
  | 'Invalid'

export class ProjectFormatError extends Error {
  constructor(
    readonly problem: ProjectProblem,
    message: string,
  ) {
    super(message)
  }
}

const MAX_DIMENSION = 16384
const NO_TEXTS = -1
const NO_MIX = -1

// The names the Android app writes for each setting, so a project file means the same in both.
const DIRECTIONS: readonly [string, TextDirection][] = [['Auto', 'auto'], ['LeftToRight', 'ltr'], ['RightToLeft', 'rtl']]
const POSITIONS: readonly [string, TextPosition][] = [['Bottom', 'bottom'], ['Middle', 'middle'], ['Top', 'top']]
const SIZES: readonly [string, TextSize][] = [['Small', 'small'], ['Medium', 'medium'], ['Large', 'large']]
const KINDS: readonly [string, AudioKind][] = [['Music', 'music'], ['Voiceover', 'voiceover']]

const nameOf = <T>(table: readonly [string, T][], value: T): string => table.find(([, v]) => v === value)?.[0] ?? table[0]![0]

// ---- Reading: every field is checked, and a wrong shape is Corrupt ----

type Obj = Readonly<Record<string, unknown>>

function corrupt(message = 'The project file is not valid'): never {
  throw new ProjectFormatError('Corrupt', message)
}

function invalid(message: string): never {
  throw new ProjectFormatError('Invalid', message)
}

const isInt = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value)

function record(value: unknown): Obj {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) corrupt()
  return value as Obj
}

function int(o: Obj, key: string, fallback?: number): number {
  const value = o[key]
  if (value === undefined || value === null) return fallback ?? corrupt()
  return isInt(value) ? value : corrupt()
}

function str(o: Obj, key: string): string {
  const value = o[key]
  return typeof value === 'string' ? value : corrupt()
}

function bool(o: Obj, key: string): boolean {
  const value = o[key]
  return typeof value === 'boolean' ? value : corrupt()
}

function nullableStr(o: Obj, key: string): string | null {
  const value = o[key]
  if (value === undefined || value === null) return null
  return typeof value === 'string' ? value : corrupt()
}

/** A setting that a newer version wrote and this one does not know becomes its default instead of an error. */
function setting<T>(o: Obj, key: string, table: readonly [string, T][]): T {
  const value = o[key]
  const found = typeof value === 'string' ? table.find(([name]) => name === value) : undefined
  return found ? found[1] : table[0]![1]
}

function list<T>(o: Obj, key: string, read: (item: unknown) => T, required = false): T[] {
  const value = o[key]
  if (value === undefined || value === null) return required ? corrupt() : []
  if (!Array.isArray(value)) corrupt()
  return value.map(read)
}

const intItem = (item: unknown): number => (isInt(item) ? item : corrupt())

export function decodeProject(text: string): Project {
  let root: Obj
  try {
    root = record(JSON.parse(text))
  } catch (error) {
    if (error instanceof ProjectFormatError) throw error
    throw new ProjectFormatError('Corrupt', 'The project file is not valid')
  }
  const format = root['format']
  if (!isInt(format)) corrupt('The project file has no valid format')
  if (format > PROJECT_FORMAT) throw new ProjectFormatError('NewerFormat', 'The project was saved by a newer version')

  const readClip = (item: unknown): Clip => {
    const o = record(item)
    return clip(str(o, 'id'), str(o, 'source'), int(o, 'sourceStartMs'), int(o, 'durationMs'), int(o, 'volume', DEFAULT_VOLUME_PERCENT))
  }
  const readText = (item: unknown): TextItem => {
    const o = record(item)
    const source = nullableStr(o, 'source')
    const startMs = int(o, 'startMs')
    const endMs = int(o, 'endMs')
    return {
      id: str(o, 'id'),
      text: str(o, 'text'),
      placement: source === null ? onOutput(startMs, endMs) : onSource(source, startMs, endMs),
      direction: setting(o, 'direction', DIRECTIONS),
      position: setting(o, 'position', POSITIONS),
      size: setting(o, 'size', SIZES),
    }
  }
  const readAudioItem = (item: unknown): AudioItem => {
    const o = record(item)
    return {
      id: str(o, 'id'),
      kind: setting(o, 'kind', KINDS),
      file: str(o, 'file'),
      displayName: str(o, 'name'),
      fileDurationMs: int(o, 'fileDurationMs'),
      startMs: int(o, 'startMs'),
      lengthMs: int(o, 'lengthMs'),
      trimStartMs: int(o, 'trimStartMs', 0),
      volumePercent: int(o, 'volume', DEFAULT_VOLUME_PERCENT),
      fadeInMs: int(o, 'fadeInMs', 0),
      fadeOutMs: int(o, 'fadeOutMs', 0),
    }
  }
  const readMix = (item: unknown): AudioMix => {
    const o = record(item)
    return {
      items: list(o, 'items', readAudioItem),
      masterFadeInMs: int(o, 'masterFadeInMs', 0),
      masterFadeOutMs: int(o, 'masterFadeOutMs', 0),
    }
  }
  const readSource = (item: unknown): Source => {
    const o = record(item)
    return {
      id: str(o, 'id'),
      file: str(o, 'file'),
      displayName: str(o, 'displayName'),
      durationMs: int(o, 'durationMs'),
      width: int(o, 'width'),
      height: int(o, 'height'),
      rotationDegrees: int(o, 'rotationDegrees'),
      hasAudio: bool(o, 'hasAudio'),
    }
  }
  const readClips = (item: unknown): Clip[] => {
    if (!Array.isArray(item)) corrupt()
    return item.map(readClip)
  }

  const id = str(root, 'id')
  const name = str(root, 'name')
  const createdAtMs = int(root, 'createdAtMs')
  const modifiedAtMs = int(root, 'modifiedAtMs')
  const fps = int(root, 'fps')
  const rawSources = list(root, 'sources', readSource, true)
  const rawTimeline = list(root, 'timeline', readClip, true)
  const undoSteps = list(root, 'undo', readClips)
  const redoSteps = list(root, 'redo', readClips)
  const rawTextSets = list(root, 'textSets', (set) => {
    if (!Array.isArray(set)) corrupt()
    return set.map(readText)
  })
  const textsIndex = int(root, 'texts', NO_TEXTS)
  const undoTexts = list(root, 'undoTexts', intItem)
  const redoTexts = list(root, 'redoTexts', intItem)
  const rawMixSets = list(root, 'mixSets', readMix)
  const mixIndex = int(root, 'mix', NO_MIX)
  const undoMixes = list(root, 'undoMixes', intItem)
  const redoMixes = list(root, 'redoMixes', intItem)

  // ---- Checking: the same rules the editor itself enforces ----
  if (!isValidId(id)) invalid('The project id is not valid')
  if (name.length > MAX_NAME_LENGTH) invalid('The project name is too long')
  if (!EXPORT_FPS_CHOICES.includes(fps)) invalid(`The frame rate ${fps} is not supported`)
  if (rawSources.length > MAX_SOURCES) invalid('Too many recordings')
  const sourceIds = new Set<string>()
  for (const source of rawSources) {
    if (!isValidId(source.id) || sourceIds.has(source.id)) invalid('A recording id is not valid or is repeated')
    sourceIds.add(source.id)
    if (!isSafeRelativePath(source.file)) invalid('A recording file path is not valid')
    if (source.durationMs < 1 || source.durationMs > MAX_TIMELINE_MS) invalid('A recording length is not valid')
    if (source.width < 0 || source.width > MAX_DIMENSION || source.height < 0 || source.height > MAX_DIMENSION) {
      invalid('A recording size is not valid')
    }
    if (![0, 90, 180, 270].includes(source.rotationDegrees)) invalid('A recording rotation is not valid')
  }
  if (undoSteps.length > HISTORY_LIMIT || redoSteps.length > HISTORY_LIMIT) invalid('The edit history is too long')

  const context = projectContext({ id, name, createdAtMs, modifiedAtMs, fps, sources: rawSources, edit: editState() })
  const timelineOf = (clips: Clip[]): Timeline => {
    const problem = validateClips(context, clips)
    if (problem !== null) invalid(`The edit breaks a rule: ${problem}`)
    return timeline(clips)
  }

  const lengths = new Map(rawSources.map((s) => [s.id, s.durationMs]))
  for (const set of rawTextSets) {
    const problem = validateTexts(set, lengths)
    if (problem !== null) invalid(`The titles and captions break a rule: ${problem}`)
  }
  const textsAt = (index: number): readonly TextItem[] => {
    if (index === NO_TEXTS) return []
    return rawTextSets[index] ?? invalid('A list of titles and captions is missing')
  }
  if (undoTexts.length > 0 && undoTexts.length !== undoSteps.length) invalid('The history of titles and captions does not match')
  if (redoTexts.length > 0 && redoTexts.length !== redoSteps.length) invalid('The history of titles and captions does not match')

  for (const mix of rawMixSets) {
    const problem = validateMix(mix)
    if (problem !== null) invalid(`The music and voiceover break a rule: ${problem}`)
  }
  const mixAt = (index: number): AudioMix => {
    if (index === NO_MIX) return EMPTY_MIX
    return rawMixSets[index] ?? invalid('A mix of music and voiceover is missing')
  }
  if (undoMixes.length > 0 && undoMixes.length !== undoSteps.length) invalid('The history of music and voiceover does not match')
  if (redoMixes.length > 0 && redoMixes.length !== redoSteps.length) invalid('The history of music and voiceover does not match')

  const snapshots = (steps: Clip[][], textIndexes: number[], mixIndexes: number[]): Snapshot[] =>
    steps.map((step, i) => ({
      timeline: timelineOf(step),
      texts: textsAt(textIndexes[i] ?? NO_TEXTS),
      mix: mixAt(mixIndexes[i] ?? NO_MIX),
    }))

  return {
    id,
    name,
    createdAtMs,
    modifiedAtMs,
    fps,
    sources: rawSources,
    edit: {
      timeline: timelineOf(rawTimeline),
      undoStack: snapshots(undoSteps, undoTexts, undoMixes),
      redoStack: snapshots(redoSteps, redoTexts, redoMixes),
      texts: textsAt(textsIndex),
      mix: mixAt(mixIndex),
    },
  }
}

// ---- Writing ----

const clipDto = (c: Clip) => ({ id: c.id, source: c.sourceId, sourceStartMs: c.sourceStartMs, durationMs: c.durationMs, volume: c.volumePercent })

const textDto = (t: TextItem) => ({
  id: t.id,
  text: t.text,
  source: t.placement.type === 'onSource' ? t.placement.sourceId : null,
  startMs: t.placement.startMs,
  endMs: t.placement.endMs,
  direction: nameOf(DIRECTIONS, t.direction),
  position: nameOf(POSITIONS, t.position),
  size: nameOf(SIZES, t.size),
})

const audioItemDto = (a: AudioItem) => ({
  id: a.id,
  kind: nameOf(KINDS, a.kind),
  file: a.file,
  name: a.displayName,
  fileDurationMs: a.fileDurationMs,
  startMs: a.startMs,
  lengthMs: a.lengthMs,
  trimStartMs: a.trimStartMs,
  volume: a.volumePercent,
  fadeInMs: a.fadeInMs,
  fadeOutMs: a.fadeOutMs,
})

const mixDto = (m: AudioMix) => ({
  items: m.items.map(audioItemDto),
  masterFadeInMs: m.masterFadeInMs,
  masterFadeOutMs: m.masterFadeOutMs,
})

/**
 * The project as text, in the same form the Android app writes (format 1). Each different list of texts, and each
 * different mix, is written once, and the project and every step of its history say which one they had.
 */
export function encodeProject(project: Project): string {
  const edit = project.edit
  const textSets: (readonly TextItem[])[] = []
  const textIndex = (items: readonly TextItem[]): number => {
    if (items.length === 0) return NO_TEXTS
    const known = textSets.findIndex((set) => sameData(set, items))
    if (known >= 0) return known
    textSets.push(items)
    return textSets.length - 1
  }
  const texts = textIndex(edit.texts)
  const undoTexts = edit.undoStack.map((s) => textIndex(s.texts))
  const redoTexts = edit.redoStack.map((s) => textIndex(s.texts))

  const mixSets: AudioMix[] = []
  const mixIndex = (mix: AudioMix): number => {
    if (mix.items.length === 0 && mix.masterFadeInMs === 0 && mix.masterFadeOutMs === 0) return NO_MIX
    const known = mixSets.findIndex((set) => sameData(set, mix))
    if (known >= 0) return known
    mixSets.push(mix)
    return mixSets.length - 1
  }
  const mix = mixIndex(edit.mix)
  const undoMixes = edit.undoStack.map((s) => mixIndex(s.mix))
  const redoMixes = edit.redoStack.map((s) => mixIndex(s.mix))

  return JSON.stringify({
    format: PROJECT_FORMAT,
    id: project.id,
    name: project.name,
    createdAtMs: project.createdAtMs,
    modifiedAtMs: project.modifiedAtMs,
    fps: project.fps,
    sources: project.sources.map((s) => ({
      id: s.id,
      file: s.file,
      displayName: s.displayName,
      durationMs: s.durationMs,
      width: s.width,
      height: s.height,
      rotationDegrees: s.rotationDegrees,
      hasAudio: s.hasAudio,
    })),
    timeline: edit.timeline.clips.map(clipDto),
    undo: edit.undoStack.map((s) => s.timeline.clips.map(clipDto)),
    redo: edit.redoStack.map((s) => s.timeline.clips.map(clipDto)),
    textSets: textSets.map((set) => set.map(textDto)),
    texts,
    undoTexts,
    redoTexts,
    mixSets: mixSets.map(mixDto),
    mix,
    undoMixes,
    redoMixes,
  })
}
