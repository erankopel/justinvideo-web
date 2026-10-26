import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import type { CaptionCue } from '../engine/text'
import { drawCaptions } from '../render/captions'

/** A picture of the titles and captions that are on screen, laid over the video and the same size. Drawn by the code that the export uses. */
export function CaptionOverlay({ active, appIsRightToLeft }: { active: readonly CaptionCue[]; appIsRightToLeft: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })

  useLayoutEffect(() => {
    const element = canvas.current
    if (!element) return
    const measure = (): void => {
      const scale = window.devicePixelRatio || 1
      setSize({ width: Math.round(element.clientWidth * scale), height: Math.round(element.clientHeight * scale) })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const key = active.map((cue) => `${cue.id}\u0000${cue.text}\u0000${cue.direction}\u0000${cue.position}\u0000${cue.size}`).join('\u0001')
  useEffect(() => {
    const element = canvas.current
    const context = element?.getContext('2d')
    if (!element || !context || size.width < 2) return
    if (element.width !== size.width) element.width = size.width
    if (element.height !== size.height) element.height = size.height
    const drawn = drawCaptions(context, active, size.width, size.height, appIsRightToLeft)
    element.dataset['drawn'] = String(drawn)
    // The cues are what the key says they are, so only the key stands for them.
  }, [key, size.width, size.height, appIsRightToLeft])

  return <canvas class="captions" ref={canvas} aria-hidden="true" data-testid="captions" />
}
