import { useLayoutEffect, useRef } from 'preact/hooks'
import type { Peaks } from '../audio/peaks'
import type { AudioItem } from '../engine/audio'
import { COLUMN_PX, columnsOf } from '../timeline/waveform'

export interface WaveBarProps {
  peaks: Peaks
  item: Pick<AudioItem, 'trimStartMs' | 'lengthMs' | 'volumePercent' | 'fadeInMs' | 'fadeOutMs'>
  /** Where the piece starts, and where the drawn part begins and how wide it is, in CSS pixels on the timeline's ruler. */
  itemLeft: number
  originX: number
  width: number
  height: number
  pxPerMs: number
  /** Device pixels to a CSS pixel. */
  scale: number
}

const darkScheme = (): boolean => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches

/**
 * The waveform of a piece of music or voiceover, drawn on a canvas that lies behind its name: a column every few pixels,
 * as tall as the sound is loud as the piece plays it, so its volume and its fades show. Silence is a thin line.
 */
export function WaveBar({ peaks, item, itemLeft, originX, width, height, pxPerMs, scale }: WaveBarProps) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const drawn = useRef('')
  const pixelWidth = Math.max(1, Math.round(width * scale))
  const pixelHeight = Math.max(1, Math.round(height * scale))
  const columns = columnsOf(peaks, item, { itemLeft, originX, drawnWidth: width, pxPerMs })

  // Drawn again only when something that shows has changed: moving the view along the timeline moves the canvas, not the columns.
  const dark = darkScheme()
  const signature = `${pixelWidth}x${pixelHeight}:${dark ? 1 : 0}:${columns.map((column) => `${column.x},${Math.round(column.level * 255)}`).join(';')}`
  useLayoutEffect(() => {
    const element = canvas.current
    if (!element || drawn.current === signature) return
    const context = element.getContext('2d')
    if (!context) return
    drawn.current = signature
    context.clearRect(0, 0, element.width, element.height)
    // The colour the bar gives its text, read when drawing, which is when the scheme has changed or something else has.
    context.fillStyle = getComputedStyle(element).color
    context.globalAlpha = 0.75
    const inner = element.height - 2 * Math.round(scale)
    for (const column of columns) {
      const tall = Math.max(Math.round(scale), Math.round(column.level * inner))
      context.fillRect(Math.round(column.x * scale), Math.round((element.height - tall) / 2), Math.max(1, Math.round(COLUMN_PX * scale)), tall)
    }
  })

  return (
    <canvas
      ref={canvas}
      class="wave"
      width={pixelWidth}
      height={pixelHeight}
      style={{ width: `${width}px`, height: `${height}px` }}
      aria-hidden="true"
      data-testid="wave"
      data-columns={columns.length}
    />
  )
}
