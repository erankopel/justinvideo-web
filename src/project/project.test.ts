import { describe, expect, it } from 'vitest'
import { type AudioItem, audioItem, EMPTY_MIX, MAX_TIMELINE_MS, mixItem, onOutput, onSource, textItem, type TextItem } from '../engine'
import { decodeProject, encodeProject, type ProjectProblem, ProjectFormatError } from './codec'
import {
  applyProjectAudio,
  applyProjectEdit,
  applyProjectText,
  MAX_NAME_LENGTH,
  MAX_SOURCES,
  type Project,
  projectWithSource,
  redoProject,
  renameProject,
  startingProject,
  undoProject,
} from './model'
import { projectNameFor } from './name'
import { testProject, testProjectWithHistory, testSource } from './test-projects'

const problemOf = (text: string): ProjectProblem => {
  try {
    decodeProject(text)
  } catch (error) {
    if (error instanceof ProjectFormatError) return error.problem
    throw error
  }
  throw new Error('Expected the project to be refused')
}

describe('a project', () => {
  it('plays the whole recording at first and has no history', () => {
    const project = startingProject('p1', '  My video  ', testSource({ durationMs: 8_000 }), 100, { newId: () => 'first' })
    expect(project?.name).toBe('My video')
    expect(project?.edit.timeline.clips.map((c) => c.id)).toEqual(['first'])
    expect(project?.edit.timeline.durationMs).toBe(8_000)
    expect(project?.createdAtMs).toBe(100)
    expect(project?.modifiedAtMs).toBe(100)
    expect(project?.edit.undoStack).toEqual([])
    expect(project?.edit.redoStack).toEqual([])
  })

  it('is not made from a recording that cannot be a clip', () => {
    expect(startingProject('p1', 'x', testSource({ durationMs: 5 }), 0)).toBeNull()
    expect(startingProject('p1', 'x', testSource({ durationMs: MAX_TIMELINE_MS + 1 }), 0)).toBeNull()
    expect(startingProject('p1', 'x', testSource({ durationMs: MAX_TIMELINE_MS }), 0)).not.toBeNull()
  })

  it('moves the modified time only when the edit changes something', () => {
    const project = testProject({ modifiedAtMs: 1_000 })
    const changed = applyProjectEdit(project, { type: 'split', timeMs: 1_000 }, 9_000)
    expect(changed.result.kind).toBe('changed')
    expect(changed.project.modifiedAtMs).toBe(9_000)

    const unchanged = applyProjectEdit(project, { type: 'split', timeMs: 0 }, 9_000)
    expect(unchanged.result).toEqual({ kind: 'unchanged' })
    expect(unchanged.project).toBe(project)

    const refused = applyProjectEdit(project, { type: 'split', timeMs: -1 }, 9_000)
    expect(refused.result).toEqual({ kind: 'rejected', error: 'OutsideTimeline' })
    expect(refused.project).toBe(project)
  })

  it('moves the modified time with undo and redo too', () => {
    const edited = applyProjectEdit(testProject(), { type: 'split', timeMs: 1_000 }, 2_000).project
    const undone = undoProject(edited, 3_000)
    expect(undone?.modifiedAtMs).toBe(3_000)
    expect(undone && redoProject(undone, 4_000)?.modifiedAtMs).toBe(4_000)
    expect(undoProject(testProject(), 1)).toBeNull()
  })

  it('takes a new recording, then places it on the timeline as an undoable edit', () => {
    const withSource = projectWithSource(testProject(), testSource({ id: 's2', durationMs: 3_000 }))
    const step = applyProjectEdit(withSource, { type: 'insertSource', sourceId: 's2', sourceStartMs: 0, sourceEndMs: 3_000, atMs: withSource.edit.timeline.durationMs }, 5_000)
    expect(step.project.edit.timeline.durationMs).toBe(13_000)
    expect(step.project.edit.timeline.clips.at(-1)?.sourceId).toBe('s2')
    expect(undoProject(step.project, 6_000)?.edit.timeline.durationMs).toBe(10_000)
  })

  it('holds at most fifty recordings', () => {
    let project = testProject()
    for (let i = 0; i < MAX_SOURCES - 1; i++) project = projectWithSource(project, testSource({ id: `x${i}` }))
    expect(project.sources.length).toBe(MAX_SOURCES)
    expect(() => projectWithSource(project, testSource({ id: 'one-too-many' }))).toThrow(RangeError)
  })

  it('trims and caps the name when renamed', () => {
    const renamed = renameProject(testProject(), '  ' + 'x'.repeat(300) + '  ', 7)
    expect(renamed.name.length).toBe(MAX_NAME_LENGTH)
    expect(renamed.modifiedAtMs).toBe(7)
  })
})

describe('the name of a new project', () => {
  const fallback = 'Untitled video'

  it('keeps a name with letters, without its extension', () => {
    expect(projectNameFor('holiday.mp4', fallback)).toBe('holiday')
    expect(projectNameFor('IMG_2026.MOV', fallback)).toBe('IMG_2026')
    expect(projectNameFor('a.b.mp4', fallback)).toBe('a.b')
    expect(projectNameFor('סרט.mp4', fallback)).toBe('סרט')
    expect(projectNameFor('no extension', fallback)).toBe('no extension')
  })

  it('gives a name of only digits or symbols the fallback', () => {
    for (const name of ['564.mp4', '2026-10-21.mp4', '.mp4', '', '   ']) expect(projectNameFor(name, fallback), name).toBe(fallback)
  })
})

describe('titles and captions in a project', () => {
  const title = (id: string, text = 'Hello', start = 0, end = 2_000): TextItem =>
    textItem(id, text, onOutput(start, end), { direction: 'rtl', position: 'top', size: 'large' })
  const caption = (id: string, start: number, end: number): TextItem => textItem(id, `Caption ${id}`, onSource('s1', start, end))
  const withText = (project: Project, item: TextItem, nowMs = 5_000): Project => applyProjectText(project, { type: 'add', item }, nowMs).project

  it('makes a text change one undo step that brings the texts back', () => {
    const step = applyProjectText(testProject(), { type: 'add', item: title('t1') }, 5_000)
    expect(step.result.kind).toBe('changed')
    expect(step.project.edit.texts.map((t) => t.id)).toEqual(['t1'])
    expect(step.project.modifiedAtMs).toBe(5_000)
    const undone = undoProject(step.project, 6_000)
    expect(undone?.edit.texts).toEqual([])
    expect(undone && redoProject(undone, 7_000)?.edit.texts.map((t) => t.id)).toEqual(['t1'])
  })

  it('costs no step for a refused or unchanged text change', () => {
    const project = withText(testProject(), title('t1'))
    expect(applyProjectText(project, { type: 'remove', id: 'nope' }, 9_000).project).toBe(project)
    expect(applyProjectText(project, { type: 'replace', item: title('t1') }, 9_000).project).toBe(project)
    expect(project.edit.undoStack.length).toBe(1)
  })

  it('walks undo back through clip edits and text edits in order', () => {
    let counter = 0
    const newId = (): string => `n${counter++}`
    let project = applyProjectEdit(testProject(), { type: 'split', timeMs: 2_000 }, 1_000, newId).project
    project = withText(project, title('t1'), 2_000)
    project = applyProjectEdit(project, { type: 'removeRange', startMs: 1_000, endMs: 3_000 }, 3_000, newId).project
    const back1 = undoProject(project, 4_000)
    expect(back1?.edit.texts.map((t) => t.id)).toEqual(['t1'])
    expect(back1?.edit.timeline.clips.length).toBe(3)
    const back2 = back1 && undoProject(back1, 5_000)
    expect(back2?.edit.texts).toEqual([])
    expect(back2?.edit.timeline.clips.length).toBe(3)
    const back3 = back2 && undoProject(back2, 6_000)
    expect(back3?.edit.timeline.clips.length).toBe(2)
    expect(back3 && undoProject(back3, 7_000)).toBeNull()
  })

  it('keeps the texts through a clip edit', () => {
    const project = applyProjectEdit(withText(testProject(), title('t1')), { type: 'split', timeMs: 2_000 }, 6_000).project
    expect(project.edit.texts.map((t) => t.id)).toEqual(['t1'])
  })

  it('round trips texts and their history through the file', () => {
    let project = withText(testProject(), title('t1', 'שלום עולם'), 2_000)
    project = withText(project, caption('c1', 500, 1_500), 3_000)
    project = applyProjectText(project, { type: 'replace', item: title('t1', 'مرحبا') }, 4_000).project
    const undone = undoProject(project, 5_000)
    if (!undone) throw new Error('nothing to undo')
    const back = decodeProject(encodeProject(undone))
    expect(back).toEqual(undone)
    expect(back.edit.texts.find((t) => t.id === 't1')?.text).toBe('שלום עולם')
    expect(back.edit.texts.find((t) => t.id === 't1')?.direction).toBe('rtl')
    expect(back.edit.redoStack.length).toBeGreaterThan(0)
  })

  it('opens a project saved before texts existed, with none', () => {
    const without = encodeProject(testProjectWithHistory()).replace(/,"textSets":.*/s, '}')
    const project = decodeProject(without)
    expect(project).toEqual(testProjectWithHistory())
    expect(project.edit.texts).toEqual([])
  })

  it('writes each list of texts once in a long history', () => {
    let project = testProject()
    for (let i = 0; i < 50; i++) project = withText(project, caption(`c${i}`, i * 100, i * 100 + 50), 2_000 + i)
    let counter = 0
    for (let i = 0; i < 10; i++) project = applyProjectEdit(project, { type: 'split', timeMs: 500 + i * 200 }, 9_000 + i, () => `n${counter++}`).project
    const text = encodeProject(project)
    // Ten steps keep an older list of texts and ten share the latest one, where one list for each of the twenty states
    // would repeat the first caption twenty times.
    const sets = text.match(/"Caption c0"/g)?.length ?? 0
    expect(sets).toBeLessThanOrEqual(12)
    expect(decodeProject(text)).toEqual(project)
  })

  it('refuses a caption past the end of its recording', () => {
    const bad = encodeProject(withText(testProject(), caption('c1', 500, 1_500))).replaceAll('"endMs":1500', '"endMs":99999')
    expect(problemOf(bad)).toBe('Invalid')
  })

  it('refuses a caption of a recording the project does not have', () => {
    const bad = encodeProject(withText(testProject(), caption('c1', 500, 1_500))).replaceAll('"source":"s1"', '"source":"s9"')
    expect(problemOf(bad)).toBe('Invalid')
  })

  it('refuses a list of texts that the file does not have', () => {
    const bad = encodeProject(withText(testProject(), title('t1'))).replace('"texts":0', '"texts":7')
    expect(problemOf(bad)).toBe('Invalid')
  })

  it('turns a setting that a newer version wrote into the default', () => {
    const future = encodeProject(withText(testProject(), title('t1'))).replace('"direction":"RightToLeft"', '"direction":"Sideways"')
    expect(decodeProject(future).edit.texts[0]?.direction).toBe('auto')
  })

  it('needs the history of texts to match the history of clips', () => {
    const project = applyProjectEdit(withText(testProject(), title('t1')), { type: 'split', timeMs: 2_000 }, 6_000).project
    const bad = encodeProject(project).replace(/"undoTexts":\[[^\]]*\]/, '"undoTexts":[0]')
    expect(problemOf(bad)).toBe('Invalid')
  })
})

describe('music and voiceover in a project', () => {
  const music = (id: string, overrides: Partial<AudioItem> = {}): AudioItem =>
    audioItem({
      id,
      kind: 'music',
      file: `media/${id}.m4a`,
      displayName: 'Song',
      fileDurationMs: 60_000,
      startMs: 0,
      lengthMs: 8_000,
      trimStartMs: 1_000,
      volumePercent: 100,
      fadeInMs: 500,
      fadeOutMs: 1_500,
      ...overrides,
    })
  const withAudio = (project: Project, op: Parameters<typeof applyProjectAudio>[1], nowMs = 5_000): Project =>
    applyProjectAudio(project, op, nowMs).project

  it('makes an audio change one undo step that brings back the mix', () => {
    const step = applyProjectAudio(testProject(), { type: 'add', item: music('a1') }, 5_000)
    expect(step.result.kind).toBe('changed')
    expect(step.project.edit.mix.items.map((i) => i.id)).toEqual(['a1'])
    expect(step.project.modifiedAtMs).toBe(5_000)
    const undone = undoProject(step.project, 6_000)
    expect(undone?.edit.mix).toEqual(EMPTY_MIX)
    expect(undone && redoProject(undone, 7_000)?.edit.mix.items.map((i) => i.id)).toEqual(['a1'])
  })

  it('costs no step for a refused or unchanged audio change', () => {
    const project = withAudio(testProject(), { type: 'add', item: music('a1') })
    expect(applyProjectAudio(project, { type: 'remove', id: 'nope' }, 9_000).project).toBe(project)
    expect(applyProjectAudio(project, { type: 'replace', item: music('a1') }, 9_000).project).toBe(project)
    expect(project.edit.undoStack.length).toBe(1)
  })

  it('walks undo back through clip and audio edits in order', () => {
    let project = applyProjectEdit(testProject(), { type: 'setClipVolume', clipId: 'one', volumePercent: 50 }, 1_000).project
    project = withAudio(project, { type: 'add', item: music('a1') }, 2_000)
    project = withAudio(project, { type: 'setMasterFades', fadeInMs: 1_000, fadeOutMs: 1_000 }, 3_000)
    const back1 = undoProject(project, 4_000)
    expect(back1?.edit.mix.masterFadeInMs).toBe(0)
    expect(back1?.edit.mix.items.map((i) => i.id)).toEqual(['a1'])
    const back2 = back1 && undoProject(back1, 5_000)
    expect(back2?.edit.mix).toEqual(EMPTY_MIX)
    expect(back2?.edit.timeline.clips[0]?.volumePercent).toBe(50)
    const back3 = back2 && undoProject(back2, 6_000)
    expect(back3?.edit.timeline.clips[0]?.volumePercent).toBe(100)
    expect(back3 && undoProject(back3, 7_000)).toBeNull()
  })

  it('round trips clip volumes and the mix and their history through the file', () => {
    let project = applyProjectEdit(testProject(), { type: 'setClipVolume', clipId: 'two', volumePercent: 35 }, 1_500).project
    project = withAudio(project, { type: 'add', item: music('a1', { displayName: 'שיר' }) }, 2_000)
    project = withAudio(project, { type: 'add', item: music('a2', { startMs: 3_000, volumePercent: 150, displayName: 'أغنية' }) }, 3_000)
    project = withAudio(project, { type: 'setMasterFades', fadeInMs: 2_000, fadeOutMs: 3_000 }, 4_000)
    const undone = undoProject(project, 5_000)
    if (!undone) throw new Error('nothing to undo')
    const back = decodeProject(encodeProject(undone))
    expect(back).toEqual(undone)
    expect(back.edit.timeline.clips.at(-1)?.volumePercent).toBe(35)
    expect(mixItem(back.edit.mix, 'a1')?.displayName).toBe('שיר')
    expect(mixItem(back.edit.mix, 'a2')?.volumePercent).toBe(150)
    expect(back.edit.redoStack.length).toBeGreaterThan(0)
  })

  it('opens a project saved before audio existed, with none', () => {
    const without = encodeProject(testProjectWithHistory()).replace(/,"mixSets":.*/s, '}').replaceAll(',"volume":100', '')
    const project = decodeProject(without)
    expect(project).toEqual(testProjectWithHistory())
    expect(project.edit.mix).toEqual(EMPTY_MIX)
  })

  it('writes each mix once in a long history', () => {
    let project = testProject()
    for (let i = 0; i < 15; i++) project = withAudio(project, { type: 'add', item: music(`a${i}`, { startMs: i * 100, displayName: `Track number ${i}` }) }, 2_000 + i)
    let counter = 0
    for (let i = 0; i < 4; i++) project = applyProjectEdit(project, { type: 'split', timeMs: 500 + i * 200 }, 9_000 + i, () => `n${counter++}`).project
    const text = encodeProject(project)
    expect(text.match(/"Track number 0"/g)?.length ?? 0).toBeLessThanOrEqual(20)
    expect(decodeProject(text)).toEqual(project)
  })

  it('refuses a volume outside the range', () => {
    const bad = encodeProject(applyProjectEdit(testProject(), { type: 'setClipVolume', clipId: 'one', volumePercent: 50 }, 2_000).project).replaceAll('"volume":50', '"volume":900')
    expect(problemOf(bad)).toBe('Invalid')
  })

  it('refuses an audio file path outside the project', () => {
    const bad = encodeProject(withAudio(testProject(), { type: 'add', item: music('a1') })).replaceAll('"file":"media/a1.m4a"', '"file":"../a1.m4a"')
    expect(problemOf(bad)).toBe('Invalid')
  })

  it('refuses a piece that reaches past its file', () => {
    const bad = encodeProject(withAudio(testProject(), { type: 'add', item: music('a1') })).replaceAll('"lengthMs":8000', '"lengthMs":80000')
    expect(problemOf(bad)).toBe('Invalid')
  })

  it('refuses a mix that the file does not have', () => {
    const bad = encodeProject(withAudio(testProject(), { type: 'add', item: music('a1') })).replace('"mix":0', '"mix":7')
    expect(problemOf(bad)).toBe('Invalid')
  })

  it('needs the history of the mix to match the history of clips', () => {
    const project = applyProjectEdit(withAudio(testProject(), { type: 'add', item: music('a1') }), { type: 'split', timeMs: 2_000 }, 6_000).project
    const bad = encodeProject(project).replace(/"undoMixes":\[[^\]]*\]/, '"undoMixes":[0]')
    expect(problemOf(bad)).toBe('Invalid')
  })

  it('turns a kind that a newer version wrote into music', () => {
    const project = withAudio(testProject(), { type: 'add', item: music('a1', { kind: 'voiceover' }) })
    const future = encodeProject(project).replaceAll('"kind":"Voiceover"', '"kind":"Radio"')
    expect(decodeProject(future).edit.mix.items[0]?.kind).toBe('music')
  })

  it('does not write an empty mix at all', () => {
    const text = encodeProject(testProject())
    expect(text).toContain('"mixSets":[]')
    expect(decodeProject(text).edit.mix).toEqual(EMPTY_MIX)
  })
})
