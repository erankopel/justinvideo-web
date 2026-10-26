import { useLayoutEffect, useRef } from 'preact/hooks'
import type { Filmstrip } from '../timeline/filmstrip'
import { STRIP_PX, type Tile } from '../timeline/tiles'

export interface FilmStripProps {
  film: Filmstrip
  sourceId: string
  tiles: readonly Tile[]
  /** How wide the strip is on screen, in CSS pixels. */
  width: number
  /** Device pixels to a CSS pixel, as the pictures were made for. */
  scale: number
}

/**
 * The pictures along a clip: one small frame of its recording in each tile, drawn on a canvas that lies behind the clip's
 * label. A tile whose frame has not been read yet shows the nearest one that has, or nothing, so the clip keeps its colour.
 */
export function FilmStrip({ film, sourceId, tiles, width, scale }: FilmStripProps) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const drawn = useRef('')
  const pixelWidth = Math.max(1, Math.round(width * scale))
  const pixelHeight = Math.round(STRIP_PX * scale)
  let exact = 0
  const pictures = tiles.map((tile) => {
    const found = film.get(sourceId, tile.timeMs)
    if (found) {
      exact++
      return found
    }
    return film.nearest(sourceId, tile.timeMs, tile.width * 2)
  })

  // Drawing again only when something that shows has changed: scrolling a clip along the timeline moves its canvas, not its pictures.
  const signature = `${pixelWidth}x${pixelHeight}:${film.revision}:${tiles.map((tile, i) => `${tile.x},${tile.width},${tile.timeMs},${pictures[i] ? 1 : 0}`).join(';')}`
  useLayoutEffect(() => {
    const element = canvas.current
    if (!element || drawn.current === signature) return
    const context = element.getContext('2d')
    if (!context) return
    drawn.current = signature
    context.clearRect(0, 0, element.width, element.height)
    tiles.forEach((tile, i) => {
      const picture = pictures[i]
      if (picture) context.drawImage(picture, Math.round(tile.x * scale), 0, Math.round(tile.width * scale), element.height)
    })
  })

  return (
    <canvas
      ref={canvas}
      class="strip"
      width={pixelWidth}
      height={pixelHeight}
      style={{ width: `${width}px`, height: `${STRIP_PX}px` }}
      aria-hidden="true"
      data-testid="strip"
      data-tiles={tiles.length}
      data-drawn={exact}
      data-times={tiles.map((tile) => tile.timeMs).join(',')}
      data-xs={tiles.map((tile) => tile.x).join(',')}
      data-widths={tiles.map((tile) => tile.width).join(',')}
    />
  )
}
