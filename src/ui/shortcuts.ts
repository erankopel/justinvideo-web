import type { Edge } from '../engine'
import { steppedFrame } from '../timeline/transport'

const SECOND_MS = 1_000

const isElement = (target: EventTarget | null): target is Element => typeof Element !== 'undefined' && target instanceof Element

/** What the person is typing into: the shortcuts must leave these keys alone. */
const isTyping = (target: EventTarget | null): boolean => isElement(target) && target.closest('input, textarea, select, [contenteditable="true"]') !== null

/** A button or a link, which uses Space and Enter itself: Space must activate it, not play the picture. */
const usesSpace = (target: EventTarget | null): boolean => isElement(target) && target.closest('button, a, summary') !== null

/** What a key asks the editor to do. */
export type KeyCommand =
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'duplicate' }
  | { type: 'toggle' }
  | { type: 'seek'; ms: number }
  | { type: 'split' }
  | { type: 'removeClip' }
  | { type: 'removeRange' }
  | { type: 'trim'; edge: Edge }
  | { type: 'earlier' }
  | { type: 'later' }
  | { type: 'clearSelection' }
  | { type: 'clearRange' }

/** What the editor is like at the moment a key is pressed. */
export interface KeyFacts {
  /** A voiceover is being recorded: the keys do nothing. */
  recording: boolean
  /** A clip is selected, and its place among the clips (-1 for none). */
  hasSelection: boolean
  selectedIndex: number
  clipCount: number
  hasRange: boolean
  /** The edit has no clips at all. */
  empty: boolean
  positionMs: number
  fps: number
  durationMs: number
}

export type KeyEvent = Pick<KeyboardEvent, 'key' | 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'target'>

export interface KeyReading {
  /** What to do, or nothing: some keys are taken (their default is stopped) and then change nothing. */
  command: KeyCommand | null
  /** Whether the browser's own answer to the key is stopped. */
  preventDefault: boolean
}

/**
 * What a key press means to the editor, or null where it is not the editor's: a key with Alt, one pressed in a box that is being
 * typed in or in a dialog, any key while a voiceover is recorded, and the keys that are not shortcuts.
 */
export function readKey(event: KeyEvent, facts: KeyFacts): KeyReading | null {
  if (event.altKey || isTyping(event.target) || facts.recording) return null
  if (isElement(event.target) && event.target.closest('dialog')) return null
  const taken = (command: KeyCommand | null): KeyReading => ({ command, preventDefault: true })
  const left = (command: KeyCommand): KeyReading => ({ command, preventDefault: false })
  if (event.ctrlKey || event.metaKey) {
    const key = event.key.toLowerCase()
    if (key === 'z') return taken({ type: event.shiftKey ? 'redo' : 'undo' })
    if (key === 'y') return taken({ type: 'redo' })
    if (key === 'd' && facts.hasSelection) return taken({ type: 'duplicate' })
    return null
  }
  const second = event.shiftKey ? SECOND_MS : 0
  const { positionMs, fps, durationMs } = facts
  switch (event.key) {
    case ' ':
      return usesSpace(event.target) ? null : taken({ type: 'toggle' })
    case 'ArrowLeft':
      return taken({ type: 'seek', ms: second ? positionMs - second : steppedFrame(positionMs, fps, -1, durationMs) })
    case 'ArrowRight':
      return taken({ type: 'seek', ms: second ? positionMs + second : steppedFrame(positionMs, fps, 1, durationMs) })
    case 'Home':
      return taken({ type: 'seek', ms: 0 })
    case 'End':
      return taken({ type: 'seek', ms: durationMs })
    case 's':
    case 'S':
      return taken(facts.empty ? null : { type: 'split' })
    case 'Delete':
    case 'Backspace':
      return taken({ type: facts.hasSelection ? 'removeClip' : 'removeRange' })
    case 'q':
    case 'Q':
      return taken({ type: 'trim', edge: 'start' })
    case 'w':
    case 'W':
      return taken({ type: 'trim', edge: 'end' })
    case '[':
      return facts.selectedIndex > 0 ? left({ type: 'earlier' }) : null
    case ']':
      return facts.selectedIndex >= 0 && facts.selectedIndex < facts.clipCount - 1 ? left({ type: 'later' }) : null
    case 'Escape':
      if (facts.hasSelection) return left({ type: 'clearSelection' })
      return facts.hasRange ? left({ type: 'clearRange' }) : null
    default:
      return null
  }
}
