import { BlobSource, CanvasSink, Input } from 'mediabunny'
import { VIDEO_FORMATS } from './formats'
import { MAX_TIMELINE_MS, MIN_CLIP_MS } from '../engine'
import { ImportError } from './failure'

/** What was learned about a video before it was copied. */
export interface VideoProbe {
  readonly displayName: string
  readonly durationMs: number
  /** As coded, before the rotation is applied, as on Android. */
  readonly width: number
  readonly height: number
  readonly rotationDegrees: number
  readonly hasAudio: boolean
}

const MAX_DIMENSION = 16384

const isReadFailure = (error: unknown): boolean =>
  error instanceof DOMException && ['NotReadableError', 'NotFoundError', 'SecurityError', 'AbortError'].includes(error.name)

/**
 * Reads the length, size, rotation and sound of a video from its file without copying it, and checks that this browser
 * can decode it. A video that cannot be decoded is refused here, with the reason, instead of failing later in the
 * preview or in the export.
 */
export async function probeVideo(file: File): Promise<VideoProbe> {
  if (file.size === 0) throw new ImportError('Unusable')
  const input = new Input({ source: new BlobSource(file), formats: VIDEO_FORMATS })
  try {
    let track
    try {
      track = await input.getPrimaryVideoTrack()
    } catch (error) {
      throw new ImportError(isReadFailure(error) ? 'Unreadable' : 'NotVideo', { cause: error })
    }
    if (track === null) throw new ImportError('NotVideo')
    if (!(await track.canDecode())) throw new ImportError('UnsupportedFormat')

    // Rounded down, so that no clip can reach past the last frame of the recording.
    const durationMs = Math.floor((await track.computeDuration()) * 1000)
    const width = await track.getCodedWidth()
    const height = await track.getCodedHeight()
    if (!Number.isFinite(durationMs) || durationMs < MIN_CLIP_MS || durationMs > MAX_TIMELINE_MS) throw new ImportError('Unusable')
    if (width < 1 || height < 1 || width > MAX_DIMENSION || height > MAX_DIMENSION) throw new ImportError('Unusable')

    const audio = await input.getPrimaryAudioTrack()
    return {
      displayName: file.name || 'video',
      durationMs,
      width,
      height,
      rotationDegrees: await track.getRotation(),
      hasAudio: audio !== null && (await audio.canDecode()),
    }
  } catch (error) {
    if (error instanceof ImportError) throw error
    throw new ImportError(isReadFailure(error) ? 'Unreadable' : 'NotVideo', { cause: error })
  } finally {
    input.dispose()
  }
}

async function canvasToBlob(canvas: HTMLCanvasElement | OffscreenCanvas): Promise<Blob | null> {
  if ('convertToBlob' in canvas) return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 })
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.8))
}

/** A small picture from the video for the project list, or null when one cannot be made. It is never worth failing for. */
export async function makeThumbnail(file: File, durationMs: number, width = 320): Promise<Blob | null> {
  const input = new Input({ source: new BlobSource(file), formats: VIDEO_FORMATS })
  try {
    const track = await input.getPrimaryVideoTrack()
    if (track === null) return null
    const sink = new CanvasSink(track, { width, fit: 'contain' })
    const frame = await sink.getCanvas(Math.min(1, durationMs / 2000))
    return frame ? await canvasToBlob(frame.canvas) : null
  } catch {
    return null
  } finally {
    input.dispose()
  }
}
