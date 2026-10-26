import { sameData } from '../equal'
import { type AudioItem, type AudioMix, validateMix } from './model'

/** A change to the music, the voiceovers and the master fades. Like a change to the clips, one is one undo step. */
export type AudioOp =
  | { readonly type: 'add'; readonly item: AudioItem }
  /** Replaces the piece that has the same id. */
  | { readonly type: 'replace'; readonly item: AudioItem }
  | { readonly type: 'remove'; readonly id: string }
  /** Sets the fades over the whole edit: the sound rises at its start and falls at its end. */
  | { readonly type: 'setMasterFades'; readonly fadeInMs: number; readonly fadeOutMs: number }

export type AudioError =
  /** There is no piece with that id. */
  | 'UnknownItem'
  /** The result would break a rule: a bad time, volume or fade, a repeated id, too many pieces. */
  | 'Invalid'

export type AudioResult =
  | { readonly kind: 'changed'; readonly mix: AudioMix }
  /** The change would leave everything as it is. */
  | { readonly kind: 'unchanged' }
  | { readonly kind: 'rejected'; readonly error: AudioError }

/** Applies a change to the mix, keeping the rules of validateMix. */
export function changeMix(mix: AudioMix, op: AudioOp): AudioResult {
  let next: AudioMix
  switch (op.type) {
    case 'add':
      next = { ...mix, items: [...mix.items, op.item] }
      break
    case 'replace':
      if (!mix.items.some((item) => item.id === op.item.id)) return { kind: 'rejected', error: 'UnknownItem' }
      next = { ...mix, items: mix.items.map((item) => (item.id === op.item.id ? op.item : item)) }
      break
    case 'remove':
      if (!mix.items.some((item) => item.id === op.id)) return { kind: 'rejected', error: 'UnknownItem' }
      next = { ...mix, items: mix.items.filter((item) => item.id !== op.id) }
      break
    case 'setMasterFades':
      next = { ...mix, masterFadeInMs: op.fadeInMs, masterFadeOutMs: op.fadeOutMs }
      break
  }
  if (sameData(next, mix)) return { kind: 'unchanged' }
  if (validateMix(next) !== null) return { kind: 'rejected', error: 'Invalid' }
  return { kind: 'changed', mix: next }
}
