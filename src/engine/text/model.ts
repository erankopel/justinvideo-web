import { isValidId } from '../ids'
import { MAX_TIMELINE_MS } from '../timeline'

/** The longest text one title or caption may hold, in characters. */
export const MAX_TEXT_LENGTH = 500

/** The most titles and captions a project may hold. A feature film's subtitles come to about two thousand. */
export const MAX_TEXT_ITEMS = 3000

/** Which way a text reads. Auto follows its first letter that has a direction, and the app's language when it has none. */
export type TextDirection = 'auto' | 'ltr' | 'rtl'

/** Where on the picture a text sits. */
export type TextPosition = 'bottom' | 'middle' | 'top'

export type TextSize = 'small' | 'medium' | 'large'

/** How large the letters are, as a part of the picture's shorter side, so a vertical and a wide export look alike. */
export const TEXT_SIZE_FRACTION: Readonly<Record<TextSize, number>> = { small: 0.04, medium: 0.055, large: 0.08 }

/**
 * When a text is shown. A title that a person places is on the edited video's own clock. A caption that comes with a
 * recording, such as one from a subtitle file, is on the recording's clock, so it follows its footage when the edit
 * cuts, moves or repeats it. Times are whole milliseconds, from startMs up to but not including endMs.
 */
export type TextPlacement =
  | { readonly type: 'onOutput'; readonly startMs: number; readonly endMs: number }
  | { readonly type: 'onSource'; readonly sourceId: string; readonly startMs: number; readonly endMs: number }

export type OnOutput = Extract<TextPlacement, { type: 'onOutput' }>

export const onOutput = (startMs: number, endMs: number): OnOutput => ({ type: 'onOutput', startMs, endMs })

export const onSource = (sourceId: string, startMs: number, endMs: number): TextPlacement => ({
  type: 'onSource',
  sourceId,
  startMs,
  endMs,
})

export interface TextItem {
  readonly id: string
  readonly text: string
  readonly placement: TextPlacement
  readonly direction: TextDirection
  readonly position: TextPosition
  readonly size: TextSize
}

export function textItem(
  id: string,
  text: string,
  placement: TextPlacement,
  options: { direction?: TextDirection; position?: TextPosition; size?: TextSize } = {},
): TextItem {
  return {
    id,
    text,
    placement,
    direction: options.direction ?? 'auto',
    position: options.position ?? 'bottom',
    size: options.size ?? 'medium',
  }
}

/** The recording a caption belongs to, or undefined for a title. */
export function captionSourceId(item: TextItem): string | undefined {
  return item.placement.type === 'onSource' ? item.placement.sourceId : undefined
}

/**
 * The first rule that the texts break, or null when they are fine. sourceLengths maps each recording's id to its
 * length, so a caption cannot sit past the end of its recording.
 */
export function validateTexts(items: readonly TextItem[], sourceLengths: ReadonlyMap<string, number>): string | null {
  if (items.length > MAX_TEXT_ITEMS) return `A project holds at most ${MAX_TEXT_ITEMS} texts`
  const ids = new Set<string>()
  for (const item of items) {
    if (!isValidId(item.id) || ids.has(item.id)) return 'A text id is not valid or is repeated'
    ids.add(item.id)
    if (item.text.trim() === '') return 'A text is empty'
    if (item.text.length > MAX_TEXT_LENGTH) return `A text is longer than ${MAX_TEXT_LENGTH} characters`
    const placement = item.placement
    if (placement.startMs < 0 || placement.endMs <= placement.startMs) return 'A text does not end after it starts'
    if (placement.endMs > MAX_TIMELINE_MS) return 'A text runs past the longest possible edit'
    if (placement.type === 'onSource') {
      const length = sourceLengths.get(placement.sourceId)
      if (length === undefined) return 'A caption belongs to a recording the project does not have'
      if (placement.endMs > length) return 'A caption runs past the end of its recording'
    }
  }
  return null
}
