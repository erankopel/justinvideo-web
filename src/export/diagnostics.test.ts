import { describe, expect, it } from 'vitest'
import { startingProject, type Source } from '../project/model'
import { type BrowserFacts, describeError, diagnosticsText } from './diagnostics'
import { defaultExportSettings } from './settings'

const source: Source = { id: 's1', file: 'media/secret-holiday.mp4', displayName: 'secret-holiday.mp4', durationMs: 4_000, width: 1920, height: 1080, rotationDegrees: 90, hasAudio: true }
const project = startingProject('p1', 'My private project', source, 0)
if (!project) throw new Error('The test project is not made')
const browser: BrowserFacts = { userAgent: 'TestBrowser/1.0', language: 'he', cores: 8, memoryGb: 4, usedMb: 12, quotaMb: 3000, storage: 'files', offscreenCanvas: true, videoEncoder: true, audioEncoder: false }

describe('what is copied about an export that failed', () => {
  const text = diagnosticsText({ failure: 'EncoderFailed', detail: 'EncodingError: no', settings: defaultExportSettings(project), mode: 'worker', project, browser, at: new Date('2026-10-25T19:00:00Z') })

  it('says what failed, how, and what the project and the browser are like', () => {
    expect(text).toContain('Problem: EncoderFailed')
    expect(text).toContain('Detail: EncodingError: no')
    expect(text).toContain('Made in: a worker')
    expect(text).toContain('When: 2026-10-25T19:00:00.000Z')
    expect(text).toContain('Project: 1 clips, 4.0 s, 0 titles and captions, 0 pieces of music and voiceover')
    // A recording turned a quarter round is told in the shape that is seen.
    expect(text).toContain('Recordings: 1080x1920, 4.0 s, with sound')
    expect(text).toContain('Browser: TestBrowser/1.0')
    expect(text).toContain('Storage: files, 12 MB used of 3000 MB')
    expect(text).toContain('Features: OffscreenCanvas yes, VideoEncoder yes, AudioEncoder no')
  })

  it('never tells the name of a file or of the project', () => {
    expect(text).not.toContain('secret')
    expect(text).not.toContain('My private project')
  })
})

describe('describing an error in a line', () => {
  it('gives its name and message, and what caused it, on one line of limited length', () => {
    const error = new Error('could not\nwrite', { cause: new DOMException('full', 'QuotaExceededError') })
    expect(describeError(error)).toBe('Error: could not write caused by QuotaExceededError: full')
    expect(describeError(new Error('x'.repeat(1000))).length).toBe(300)
    expect(describeError(42)).toBe('')
  })
})
