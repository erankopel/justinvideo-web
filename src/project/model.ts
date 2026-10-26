import { type AudioOp, type AudioResult, changeMix, type AudioMix } from '../engine/audio'
import {
  applyToState,
  type Clip,
  clip,
  DEFAULT_FPS,
  type EditContext,
  type EditOp,
  type EditResult,
  type EditState,
  editContext,
  editState,
  randomClipId,
  randomId,
  redone,
  timeline,
  type Timeline,
  undone,
  validateClips,
  withMix,
  withTexts,
} from '../engine'
import { changeTexts, type TextItem, type TextOp, type TextResult } from '../engine/text'

/** The version of the saved project file. A file with a higher number is from a newer version and is not opened. */
export const PROJECT_FORMAT = 1

export const MAX_SOURCES = 50
export const MAX_NAME_LENGTH = 200

/**
 * A recording that clips refer to. The site keeps its own copy of the video in the browser's private file system, so a
 * project still opens after the original is moved or deleted. file is relative to the project's folder. width and
 * height are as the video is coded, before rotationDegrees is applied, as in the Android app.
 */
export interface Source {
  readonly id: string
  readonly file: string
  readonly displayName: string
  readonly durationMs: number
  readonly width: number
  readonly height: number
  readonly rotationDegrees: number
  readonly hasAudio: boolean
}

export interface Project {
  readonly id: string
  readonly name: string
  readonly createdAtMs: number
  readonly modifiedAtMs: number
  readonly fps: number
  readonly sources: readonly Source[]
  readonly edit: EditState
}

export const newProjectId = (): string => randomId('p')
export const newSourceId = (): string => randomId('s')

export const projectTimeline = (project: Project): Timeline => project.edit.timeline
export const projectTexts = (project: Project): readonly TextItem[] => project.edit.texts
export const projectMix = (project: Project): AudioMix => project.edit.mix
export const sourceOf = (project: Project, id: string): Source | undefined => project.sources.find((s) => s.id === id)

export function projectContext(project: Project, newId: () => string = randomClipId): EditContext {
  return editContext(new Map(project.sources.map((s) => [s.id, s.durationMs])), { fps: project.fps, newId })
}

const sourceLengths = (project: Project): Map<string, number> => new Map(project.sources.map((s) => [s.id, s.durationMs]))

/** The result of an edit and the project after it: the same project unless the timeline changed. */
export function applyProjectEdit(
  project: Project,
  op: EditOp,
  nowMs: number,
  newId: () => string = randomClipId,
): { project: Project; result: EditResult } {
  const { state, result } = applyToState(project.edit, op, projectContext(project, newId))
  if (result.kind !== 'changed') return { project, result }
  return { project: { ...project, edit: state, modifiedAtMs: nowMs }, result }
}

/** The result of a change to the titles and captions and the project after it: the same project unless they changed. */
export function applyProjectText(project: Project, op: TextOp, nowMs: number): { project: Project; result: TextResult } {
  const result = changeTexts(project.edit.texts, op, sourceLengths(project))
  if (result.kind !== 'changed') return { project, result }
  return { project: { ...project, edit: withTexts(project.edit, result.texts), modifiedAtMs: nowMs }, result }
}

/** The result of a change to the music, the voiceovers or the master fades and the project after it. */
export function applyProjectAudio(project: Project, op: AudioOp, nowMs: number): { project: Project; result: AudioResult } {
  const result = changeMix(project.edit.mix, op)
  if (result.kind !== 'changed') return { project, result }
  return { project: { ...project, edit: withMix(project.edit, result.mix), modifiedAtMs: nowMs }, result }
}

export function undoProject(project: Project, nowMs: number): Project | null {
  const state = undone(project.edit)
  return state === null ? null : { ...project, edit: state, modifiedAtMs: nowMs }
}

export function redoProject(project: Project, nowMs: number): Project | null {
  const state = redone(project.edit)
  return state === null ? null : { ...project, edit: state, modifiedAtMs: nowMs }
}

export const renameProject = (project: Project, name: string, nowMs: number): Project => ({
  ...project,
  name: name.trim().slice(0, MAX_NAME_LENGTH),
  modifiedAtMs: nowMs,
})

/** Registers a recording. Putting it on the timeline is a separate, undoable edit. */
export function projectWithSource(project: Project, source: Source): Project {
  if (project.sources.length >= MAX_SOURCES) throw new RangeError(`A project holds at most ${MAX_SOURCES} recordings`)
  return { ...project, sources: [...project.sources, source] }
}

/** A project that plays the whole of source, or null when the recording cannot be used as a clip. */
export function startingProject(
  id: string,
  name: string,
  source: Source,
  nowMs: number,
  options: { fps?: number; newId?: () => string } = {},
): Project | null {
  const clips: Clip[] = [clip((options.newId ?? randomClipId)(), source.id, 0, source.durationMs)]
  const project: Project = {
    id,
    name: name.trim().slice(0, MAX_NAME_LENGTH),
    createdAtMs: nowMs,
    modifiedAtMs: nowMs,
    fps: options.fps ?? DEFAULT_FPS,
    sources: [source],
    edit: editState({ timeline: timeline(clips) }),
  }
  return validateClips(projectContext(project), clips) === null ? project : null
}
