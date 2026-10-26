import { type CaptionCue, readsRightToLeft, TEXT_SIZE_FRACTION, type TextPosition } from '../engine/text'

type Canvas2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

/** The typeface of every title and caption, in the preview and, later, in the export, so that what is seen is what is burned in. */
export const FONT_FAMILY = 'system-ui, "Segoe UI", Roboto, "Noto Sans", "Noto Sans Hebrew", "Noto Sans Arabic", sans-serif'

const MAX_WIDTH_FRACTION = 0.9
const EDGE_MARGIN_FRACTION = 0.07
const PADDING_IN_TEXT_HEIGHTS = 0.4
const BACKGROUND = 'rgba(0, 0, 0, 0.667)'

export interface Line {
  readonly text: string
  /** Whether the line reads right to left. A line that is wrapped keeps the direction of the line it came from. */
  readonly rtl: boolean
}

const graphemesOf = (text: string): string[] =>
  typeof Intl.Segmenter === 'function' ? [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].map((part) => part.segment) : Array.from(text)

/**
 * The line cut into lines no wider than maxWidth, at spaces. A word wider than that is cut between letters. measure gives
 * the width of a piece of text.
 */
export function wrapLine(line: string, maxWidth: number, measure: (text: string) => number): string[] {
  if (line === '') return ['']
  const lines: string[] = []
  let current = ''
  for (const word of line.split(' ')) {
    const candidate = current === '' ? word : `${current} ${word}`
    if (measure(candidate) <= maxWidth) {
      current = candidate
      continue
    }
    if (current !== '') {
      lines.push(current)
      current = ''
    }
    if (measure(word) <= maxWidth) {
      current = word
      continue
    }
    for (const letter of graphemesOf(word)) {
      if (current === '' || measure(current + letter) <= maxWidth) {
        current += letter
      } else {
        lines.push(current)
        current = letter
      }
    }
  }
  if (current !== '' || lines.length === 0) lines.push(current)
  return lines
}

export interface BlockLayout {
  readonly lines: readonly Line[]
  readonly textPx: number
  readonly padding: number
  readonly lineHeight: number
  readonly ascent: number
  readonly left: number
  readonly top: number
  readonly boxWidth: number
  readonly boxHeight: number
}

/** Where one block of text goes on a picture of width by height pixels, and how it is cut into lines. */
export function layoutBlock(
  lines: readonly Line[],
  textPx: number,
  position: TextPosition,
  width: number,
  height: number,
  measure: (text: string) => number,
  metrics: { ascent: number; descent: number },
): BlockLayout {
  const padding = textPx * PADDING_IN_TEXT_HEIGHTS
  const maxWidth = Math.max(1, width * MAX_WIDTH_FRACTION - 2 * padding)
  const wrapped = lines.flatMap((line) => wrapLine(line.text, maxWidth, measure).map((text) => ({ text, rtl: line.rtl })))
  const widest = Math.max(...wrapped.map((line) => measure(line.text)))
  const lineHeight = metrics.ascent + metrics.descent
  const boxWidth = widest + 2 * padding
  const boxHeight = wrapped.length * lineHeight + 2 * padding
  const margin = height * EDGE_MARGIN_FRACTION
  const top = position === 'bottom' ? height - margin - boxHeight : position === 'top' ? margin : (height - boxHeight) / 2
  return { lines: wrapped, textPx, padding, lineHeight, ascent: metrics.ascent, left: (width - boxWidth) / 2, top, boxWidth, boxHeight }
}

function roundedRectangle(ctx: Canvas2D, x: number, y: number, width: number, height: number, radius: number): void {
  const r = Math.min(radius, width / 2, height / 2)
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + width, y, x + width, y + height, r)
  ctx.arcTo(x + width, y + height, x, y + height, r)
  ctx.arcTo(x, y + height, x, y, r)
  ctx.arcTo(x, y, x + width, y, r)
  ctx.closePath()
}

/**
 * Draws the titles and captions that are on screen onto a canvas of the picture's size, which is cleared first. The preview
 * lays that canvas over the video and the export over each frame. The browser's own text layout joins the Arabic letters
 * and orders mixed-direction lines, and a line's direction is set for the line, so a chosen direction holds whatever the
 * first letter is. Returns whether anything was drawn.
 */
export function drawCaptions(ctx: Canvas2D, active: readonly CaptionCue[], width: number, height: number, appIsRightToLeft: boolean): boolean {
  ctx.clearRect(0, 0, width, height)
  if (active.length === 0 || width < 2 || height < 2) return false
  const shortSide = Math.min(width, height)
  const groups = new Map<TextPosition, CaptionCue[]>()
  for (const cue of active) groups.set(cue.position, [...(groups.get(cue.position) ?? []), cue])

  for (const [position, group] of groups) {
    const textPx = Math.max(8, shortSide * Math.max(...group.map((cue) => TEXT_SIZE_FRACTION[cue.size])))
    const lines = group.flatMap((cue) => cue.text.split('\n').map((text) => ({ text, rtl: readsRightToLeft(text, cue.direction, appIsRightToLeft) })))
    ctx.font = `500 ${textPx}px ${FONT_FAMILY}`
    const sample = ctx.measureText('Hg')
    const metrics = {
      ascent: sample.fontBoundingBoxAscent ?? textPx * 0.93,
      descent: sample.fontBoundingBoxDescent ?? textPx * 0.25,
    }
    const block = layoutBlock(lines, textPx, position, width, height, (text) => ctx.measureText(text).width, metrics)
    ctx.fillStyle = BACKGROUND
    roundedRectangle(ctx, block.left, block.top, block.boxWidth, block.boxHeight, block.padding)
    ctx.fill()
    ctx.fillStyle = '#ffffff'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'alphabetic'
    block.lines.forEach((line, index) => {
      ctx.direction = line.rtl ? 'rtl' : 'ltr'
      ctx.fillText(line.text, block.left + block.boxWidth / 2, block.top + block.padding + index * block.lineHeight + block.ascent)
    })
  }
  return true
}

