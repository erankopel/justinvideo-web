import { sameData } from '../equal'
import { captionSourceId, type TextItem, validateTexts } from './model'

/** A change to the project's titles and captions. Like a change to the clips, one is one undo step. */
export type TextOp =
  | { readonly type: 'add'; readonly item: TextItem }
  /** Replaces the text that has the same id. */
  | { readonly type: 'replace'; readonly item: TextItem }
  | { readonly type: 'remove'; readonly id: string }
  /** Adds several at once, such as the captions of a subtitle file. */
  | { readonly type: 'addAll'; readonly items: readonly TextItem[] }
  /** Removes every caption that belongs to a recording, to make way for a new set. */
  | { readonly type: 'removeCaptionsOf'; readonly sourceId: string }
  /** Replaces the captions of a recording with items, as one change: importing a subtitle file again. */
  | { readonly type: 'replaceCaptionsOf'; readonly sourceId: string; readonly items: readonly TextItem[] }

export type TextError =
  /** There is no text with that id. */
  | 'UnknownText'
  /** The result would break a rule: an empty or too long text, a bad time, a repeated id, too many. */
  | 'Invalid'

export type TextResult =
  | { readonly kind: 'changed'; readonly texts: readonly TextItem[] }
  /** The change would leave everything as it is. */
  | { readonly kind: 'unchanged' }
  | { readonly kind: 'rejected'; readonly error: TextError }

/** Applies a change to the texts, keeping the rules of validateTexts. sourceLengths maps recording ids to lengths. */
export function changeTexts(
  texts: readonly TextItem[],
  op: TextOp,
  sourceLengths: ReadonlyMap<string, number>,
): TextResult {
  let next: readonly TextItem[]
  switch (op.type) {
    case 'add':
      next = [...texts, op.item]
      break
    case 'addAll':
      if (op.items.length === 0) return { kind: 'unchanged' }
      next = [...texts, ...op.items]
      break
    case 'replace':
      if (!texts.some((item) => item.id === op.item.id)) return { kind: 'rejected', error: 'UnknownText' }
      next = texts.map((item) => (item.id === op.item.id ? op.item : item))
      break
    case 'remove':
      if (!texts.some((item) => item.id === op.id)) return { kind: 'rejected', error: 'UnknownText' }
      next = texts.filter((item) => item.id !== op.id)
      break
    case 'replaceCaptionsOf':
      next = [...texts.filter((item) => captionSourceId(item) !== op.sourceId), ...op.items]
      break
    case 'removeCaptionsOf': {
      const kept = texts.filter((item) => captionSourceId(item) !== op.sourceId)
      if (kept.length === texts.length) return { kind: 'unchanged' }
      next = kept
      break
    }
  }
  if (sameData(next, texts)) return { kind: 'unchanged' }
  if (validateTexts(next, sourceLengths) !== null) return { kind: 'rejected', error: 'Invalid' }
  return { kind: 'changed', texts: next }
}
