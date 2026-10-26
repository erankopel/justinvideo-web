import { describe, expect, it } from 'vitest'
import { HISTORY_LIMIT, isValidId } from '../engine'
import { decodeProject, encodeProject, type ProjectProblem, ProjectFormatError } from './codec'
import { applyProjectEdit, MAX_NAME_LENGTH, PROJECT_FORMAT, undoProject } from './model'
import { testProject, testProjectWithHistory } from './test-projects'

function problemOf(text: string): ProjectProblem {
  try {
    decodeProject(text)
  } catch (error) {
    if (error instanceof ProjectFormatError) return error.problem
    throw error
  }
  throw new Error('Expected the project to be refused')
}

const encoded = (change: (text: string) => string = (t) => t): string => change(encodeProject(testProjectWithHistory()))

describe('the project file', () => {
  it('round trips a project with history exactly', () => {
    const project = testProjectWithHistory()
    expect(project.edit.undoStack.length).toBeGreaterThan(0)
    expect(project.edit.redoStack.length).toBeGreaterThan(0)
    expect(decodeProject(encodeProject(project))).toEqual(project)
  })

  it('round trips Hebrew and Arabic names', () => {
    const project = testProject({ name: 'סרט חופשה مرحبا' })
    expect(decodeProject(encodeProject(project)).name).toBe(project.name)
  })

  it('writes the same shape as the Android app, in the same order', () => {
    const text = encodeProject(testProject())
    expect(Object.keys(JSON.parse(text))).toEqual([
      'format', 'id', 'name', 'createdAtMs', 'modifiedAtMs', 'fps', 'sources', 'timeline', 'undo', 'redo',
      'textSets', 'texts', 'undoTexts', 'redoTexts', 'mixSets', 'mix', 'undoMixes', 'redoMixes',
    ])
    expect(text).toContain('"timeline":[{"id":"one","source":"s1","sourceStartMs":0,"durationMs":4000,"volume":100}')
    expect(text).toContain('"sources":[{"id":"s1","file":"media/s1.mp4","displayName":"clip.mp4","durationMs":20000,"width":1280,"height":720,"rotationDegrees":0,"hasAudio":true}]')
  })

  it('ignores fields from a later minor version', () => {
    const text = encoded((t) => t.replace('{', '{"someNewField":{"a":1},'))
    expect(decodeProject(text)).toEqual(testProjectWithHistory())
  })

  it('calls text that is not a project corrupt', () => {
    for (const text of ['', 'not json at all', '[1,2,3]', '{}', '{"format":"one"}']) {
      expect(problemOf(text), text).toBe('Corrupt')
    }
    expect(problemOf(encoded((t) => t.slice(0, -40)))).toBe('Corrupt')
    expect(problemOf(encoded((t) => t.replaceAll('"timeline"', '"timelime"')))).toBe('Corrupt')
    expect(problemOf(encoded((t) => t.replaceAll('"fps":30', '"fps":"30"')))).toBe('Corrupt')
  })

  it('recognises a newer format whatever it contains', () => {
    expect(problemOf(`{"format":${PROJECT_FORMAT + 1},"somethingElse":true}`)).toBe('NewerFormat')
    expect(problemOf(encoded((t) => t.replace(`"format":${PROJECT_FORMAT}`, `"format":${PROJECT_FORMAT + 1}`)))).toBe('NewerFormat')
  })

  it('refuses a clip that runs past its recording', () => {
    expect(problemOf(encoded((t) => t.replaceAll('"durationMs":20000', '"durationMs":9000')))).toBe('Invalid')
  })

  it('refuses a clip of an unknown recording', () => {
    expect(problemOf(encoded((t) => t.replaceAll('"source":"s1"', '"source":"nope"')))).toBe('Invalid')
  })

  it('refuses repeated clip ids', () => {
    const text = encodeProject(testProject()).replaceAll('"id":"two"', '"id":"one"')
    expect(problemOf(text)).toBe('Invalid')
  })

  it('refuses unsafe ids, paths and settings', () => {
    const base = encodeProject(testProject())
    for (const path of ['../outside.mp4', '/etc/passwd', 'media/../../x', 'media//x.mp4', 'a\\\\b.mp4', '', '.']) {
      expect(problemOf(base.replaceAll('"file":"media/s1.mp4"', `"file":"${path}"`)), path).toBe('Invalid')
    }
    expect(problemOf(base.replaceAll('"id":"p1"', '"id":"../p1"'))).toBe('Invalid')
    expect(problemOf(base.replaceAll('"fps":30', '"fps":29'))).toBe('Invalid')
    expect(problemOf(base.replaceAll('"rotationDegrees":0', '"rotationDegrees":45'))).toBe('Invalid')
    expect(problemOf(base.replaceAll('"width":1280', '"width":-5'))).toBe('Invalid')
    expect(problemOf(base.replaceAll('"name":"Holiday"', `"name":"${'x'.repeat(MAX_NAME_LENGTH + 1)}"`))).toBe('Invalid')
  })

  it('refuses a history longer than the limit', () => {
    const snapshot = '[{"id":"one","source":"s1","sourceStartMs":0,"durationMs":4000}]'
    const long = `[${Array.from({ length: HISTORY_LIMIT + 1 }, () => snapshot).join(',')}]`
    expect(problemOf(encodeProject(testProject()).replace('"undo":[]', `"undo":${long}`))).toBe('Invalid')
  })

  it('checks a snapshot in the history like the timeline', () => {
    const project = applyProjectEdit(testProject(), { type: 'split', timeMs: 1_000 }, 2_000).project
    expect(problemOf(encodeProject(project).replaceAll('"durationMs":4000', '"durationMs":4'))).toBe('Invalid')
  })

  it('accepts only safe ids', () => {
    for (const good of ['p0123456789abcdef', 'a-b_C9']) expect(isValidId(good)).toBe(true)
    for (const bad of ['', 'a/b', '..', 'a b', 'x'.repeat(65), 'é', 'a.b']) expect(isValidId(bad), bad).toBe(false)
  })

  it('gives undo and redo of the saved project back after a round trip', () => {
    const back = decodeProject(encodeProject(testProjectWithHistory()))
    expect(undoProject(back, 9)).not.toBeNull()
  })
})
