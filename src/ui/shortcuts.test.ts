import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { steppedFrame } from '../timeline/transport'
import { type KeyEvent, type KeyFacts, readKey } from './shortcuts'

/** A stand-in for an element of the page, which these tests run without: it answers closest for the selectors it is told it matches. */
class FakeElement {
  constructor(private readonly matches: string[]) {}
  closest(selector: string): FakeElement | null {
    return this.matches.some((match) => selector.includes(match)) ? this : null
  }
}

const original = (globalThis as { Element?: unknown }).Element
beforeAll(() => {
  ;(globalThis as { Element?: unknown }).Element = FakeElement
})
afterAll(() => {
  ;(globalThis as { Element?: unknown }).Element = original
})

const facts = (change: Partial<KeyFacts> = {}): KeyFacts => ({ recording: false, hasSelection: false, selectedIndex: -1, clipCount: 3, hasRange: false, empty: false, positionMs: 1_000, fps: 25, durationMs: 3_000, ...change })
const key = (name: string, change: Partial<KeyEvent> = {}): KeyEvent => ({ key: name, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, target: null, ...change })

describe('the keys of the editor', () => {
  it('play and pause on Space, unless the focus is on a button, which uses Space itself', () => {
    expect(readKey(key(' '), facts())).toEqual({ command: { type: 'toggle' }, preventDefault: true })
    expect(readKey(key(' ', { target: new FakeElement(['button']) as never }), facts())).toBeNull()
  })

  it('step a frame with the arrows, and a second with Shift, and go to the ends with Home and End', () => {
    expect(readKey(key('ArrowRight'), facts())?.command).toEqual({ type: 'seek', ms: steppedFrame(1_000, 25, 1, 3_000) })
    expect(readKey(key('ArrowLeft'), facts())?.command).toEqual({ type: 'seek', ms: steppedFrame(1_000, 25, -1, 3_000) })
    expect(steppedFrame(1_000, 25, 1, 3_000)).toBeGreaterThan(1_000)
    expect(readKey(key('ArrowRight', { shiftKey: true }), facts())?.command).toEqual({ type: 'seek', ms: 2_000 })
    expect(readKey(key('ArrowLeft', { shiftKey: true }), facts())?.command).toEqual({ type: 'seek', ms: 0 })
    expect(readKey(key('Home'), facts())?.command).toEqual({ type: 'seek', ms: 0 })
    expect(readKey(key('End'), facts())?.command).toEqual({ type: 'seek', ms: 3_000 })
  })

  it('split on S, and take the key even where there is nothing to split', () => {
    expect(readKey(key('s'), facts())).toEqual({ command: { type: 'split' }, preventDefault: true })
    expect(readKey(key('S'), facts())?.command).toEqual({ type: 'split' })
    expect(readKey(key('s'), facts({ empty: true }))).toEqual({ command: null, preventDefault: true })
  })

  it('remove the selected clip on Delete or Backspace, or else the range', () => {
    expect(readKey(key('Delete'), facts({ hasSelection: true, selectedIndex: 1 }))?.command).toEqual({ type: 'removeClip' })
    expect(readKey(key('Backspace'), facts())?.command).toEqual({ type: 'removeRange' })
  })

  it('trim the start on Q and the end on W', () => {
    expect(readKey(key('q'), facts())?.command).toEqual({ type: 'trim', edge: 'start' })
    expect(readKey(key('W'), facts())?.command).toEqual({ type: 'trim', edge: 'end' })
  })

  it('move the selected clip earlier and later with the brackets, only where there is room, and leave the browser the key', () => {
    expect(readKey(key('['), facts({ hasSelection: true, selectedIndex: 1 }))).toEqual({ command: { type: 'earlier' }, preventDefault: false })
    expect(readKey(key('['), facts({ hasSelection: true, selectedIndex: 0 }))).toBeNull()
    expect(readKey(key(']'), facts({ hasSelection: true, selectedIndex: 1 }))).toEqual({ command: { type: 'later' }, preventDefault: false })
    expect(readKey(key(']'), facts({ hasSelection: true, selectedIndex: 2 }))).toBeNull()
    expect(readKey(key(']'), facts())).toBeNull()
  })

  it('let go of the selection on Escape, or else of the range', () => {
    expect(readKey(key('Escape'), facts({ hasSelection: true, selectedIndex: 0, hasRange: true }))?.command).toEqual({ type: 'clearSelection' })
    expect(readKey(key('Escape'), facts({ hasRange: true }))?.command).toEqual({ type: 'clearRange' })
    expect(readKey(key('Escape'), facts())).toBeNull()
  })

  it('undo and redo with Control or Command, duplicate with D when a clip is selected, and leave other combinations alone', () => {
    expect(readKey(key('z', { ctrlKey: true }), facts())).toEqual({ command: { type: 'undo' }, preventDefault: true })
    expect(readKey(key('Z', { metaKey: true, shiftKey: true }), facts())?.command).toEqual({ type: 'redo' })
    expect(readKey(key('y', { ctrlKey: true }), facts())?.command).toEqual({ type: 'redo' })
    expect(readKey(key('d', { ctrlKey: true }), facts({ hasSelection: true, selectedIndex: 0 }))?.command).toEqual({ type: 'duplicate' })
    expect(readKey(key('d', { ctrlKey: true }), facts())).toBeNull()
    expect(readKey(key('s', { ctrlKey: true }), facts())).toBeNull()
  })

  it('are not the editor’s with Alt, in a box that is typed in, in a dialog, or while a voiceover is recorded', () => {
    expect(readKey(key('s', { altKey: true }), facts())).toBeNull()
    expect(readKey(key('s', { target: new FakeElement(['textarea']) as never }), facts())).toBeNull()
    expect(readKey(key('s', { target: new FakeElement(['dialog']) as never }), facts())).toBeNull()
    expect(readKey(key('s'), facts({ recording: true }))).toBeNull()
  })

  it('ignore the other keys', () => {
    expect(readKey(key('a'), facts())).toBeNull()
    expect(readKey(key('Enter'), facts())).toBeNull()
  })
})
