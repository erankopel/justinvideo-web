import { AudioSample, AudioSampleSource, BlobSource, CanvasSink, CanvasSource, type InputVideoTrack, Input, Mp4OutputFormat, Output, WebMOutputFormat } from 'mediabunny'
import { randomId } from '../engine'
import { masterEnvelope } from '../engine/audio'
import { activeAt, type CaptionCue, resolveCues } from '../engine/text'
import { VIDEO_FORMATS } from '../import/formats'
import type { Project } from '../project/model'
import { drawCaptions } from '../render/captions'
import { hasRoomFor, type MediaStore } from '../storage/media-store'
import { AUDIO_BITRATE, chooseEncoding, videoBitrate } from './encoding'
import { ExportError, failureOf, isCancelled } from './failure'
import { FrameRetimer } from './frames'
import { EXPORT_RATE } from './mix'
import { frameCountOf, mixBlocks } from './mixer'
import { soundLayers } from './plan'
import { openAudioReader } from './readers'
import { estimateExportBytes, exportFileName, exportPieces, type ExportSettings, frameDropTarget, outputSize, pieceDurationMs } from './settings'
import { clearStaleExports, type ExportTarget, openTarget } from './target'

/** What the export needs of the project's storage: to read the files of a project. A media store does, and so does a worker's. */
export type ProjectFiles = Pick<MediaStore, 'read'>

export interface ExportOptions {
  readonly signal?: AbortSignal
  /** From 0 to 1, how much of the export is done. */
  readonly onProgress?: (fraction: number) => void
  /** Whether the site is shown right to left, which decides which way a title with no letters of its own reads. */
  readonly rightToLeft: boolean
  readonly now?: () => Date
}

/** A finished export. The file stays in the browser's storage until discard is called. */
export interface ExportResult {
  readonly file: File
  readonly fileName: string
  readonly width: number
  readonly height: number
  readonly durationMs: number
  readonly frameCount: number
  readonly container: 'mp4' | 'webm'
  /** The name of the file in the private file system, when it is kept there, so that it can be discarded from the page. */
  readonly tempName?: string
  discard(): Promise<void>
}

type AnyCanvas = OffscreenCanvas | HTMLCanvasElement
type Context2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

function makeCanvas(width: number, height: number): AnyCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

function contextOf(canvas: AnyCanvas): Context2D {
  const context = canvas.getContext('2d') as Context2D | null
  if (!context) throw new ExportError('Failed')
  return context
}

/** The same cues, on screen, give the same key, so the titles are drawn again only when they change. */
const cueKey = (active: readonly CaptionCue[]): string => active.map((cue) => `${cue.id}\u0000${cue.startMs}`).join('\u0001')

/** The file of a recording or a piece of sound, from the project's folder in the browser's storage. */
async function readFile(media: ProjectFiles, projectId: string, path: string | undefined, failure: 'SourceMissing' | 'AudioMissing'): Promise<File> {
  if (path === undefined) throw new ExportError(failure)
  try {
    return await media.read(projectId, path)
  } catch (error) {
    throw new ExportError(failure, { cause: error })
  }
}

/**
 * Exports a whole project to one video file: every piece of every recording in order, each fitted to the chosen shape,
 * the titles and captions burned in with the code that draws them in the preview, and the sound mixed from the clips, the
 * music and the voiceovers at the levels of the preview. It works from the project as it is when called, so editing can
 * go on meanwhile. Throws an ExportError that says why it did not finish, or an AbortError when the signal is aborted;
 * nothing is kept then.
 */
export async function exportProject(media: ProjectFiles, project: Project, settings: ExportSettings, options: ExportOptions): Promise<ExportResult> {
  const edit = project.edit
  const pieces = exportPieces(edit.timeline)
  if (pieces.length === 0) throw new ExportError('NothingToExport')
  const durationMs = edit.timeline.durationMs
  const size = outputSize(settings)
  const layers = soundLayers(project, pieces)
  const signal = options.signal
  // A cancel is honoured at every stage, from the first: one that comes while the files are still being read or the encoder
  // is still being chosen has already happened by the time anything listens for it, so it is looked for, not waited for.
  const stopIfCancelled = (): void => {
    if (signal?.aborted) throw new DOMException('The export was cancelled', 'AbortError')
  }
  stopIfCancelled()

  // Every file is found before any work is done, so a missing one is reported at once.
  const sourceFiles = new Map<string, File>()
  for (const id of new Set(pieces.map((piece) => piece.sourceId))) {
    sourceFiles.set(id, await readFile(media, project.id, project.sources.find((s) => s.id === id)?.file, 'SourceMissing'))
    stopIfCancelled()
  }
  const audioFiles = new Map<string, File>()
  for (const layer of layers) {
    if (layer.file.kind !== 'audio' || audioFiles.has(layer.file.id)) continue
    const id = layer.file.id
    audioFiles.set(id, await readFile(media, project.id, edit.mix.items.find((item) => item.id === id)?.file, 'AudioMissing'))
  }
  stopIfCancelled()
  if (!(await hasRoomFor(estimateExportBytes(durationMs, settings)))) throw new ExportError('NoSpace')
  await clearStaleExports()
  stopIfCancelled()

  const inputs: Input[] = []
  const tracks = new Map<string, InputVideoTrack>()
  const rates: number[] = []
  let output: Output | null = null
  let target: ExportTarget | null = null
  // The two tasks stop each other: when one fails or the export is cancelled, the other is told to give up.
  const inner = new AbortController()
  const abort = (): void => inner.abort()
  signal?.addEventListener('abort', abort)
  if (signal?.aborted) abort()
  try {
    for (const [id, file] of sourceFiles) {
      const input = new Input({ source: new BlobSource(file), formats: VIDEO_FORMATS })
      inputs.push(input)
      stopIfCancelled()
      try {
        const track = await input.getPrimaryVideoTrack()
        if (!track || !(await track.canDecode())) throw new ExportError('DecoderFailed')
        const stats = await track.computePacketStats(200).catch(() => null)
        if (stats && Number.isFinite(stats.averagePacketRate)) rates.push(stats.averagePacketRate)
        tracks.set(id, track)
      } catch (error) {
        throw error instanceof ExportError ? error : new ExportError('DecoderFailed', { cause: error })
      }
    }
    const dropTo = frameDropTarget(rates, settings.fps)
    const encoding = await chooseEncoding(size, settings.fps, layers.length > 0)
    stopIfCancelled()
    if (!encoding) throw new ExportError('EncoderFailed')
    const fileName = exportFileName(project.name, (options.now ?? (() => new Date()))(), encoding.extension)
    target = await openTarget(`export-${randomId('')}.${encoding.extension}`, fileName, encoding.mime)
    stopIfCancelled()
    output = new Output({
      format: encoding.container === 'mp4' ? new Mp4OutputFormat({ fastStart: target.fastStart }) : new WebMOutputFormat(),
      target: target.target,
    })
    const canvas = makeCanvas(size.width, size.height)
    const context = contextOf(canvas)
    const overlay = makeCanvas(size.width, size.height)
    const overlayContext = contextOf(overlay)
    const video = new CanvasSource(canvas, { codec: encoding.video, bitrate: videoBitrate(size, settings.fps) })
    output.addVideoTrack(video, { frameRate: settings.fps })
    const sound = encoding.audio ? new AudioSampleSource({ codec: encoding.audio, bitrate: AUDIO_BITRATE }) : null
    if (sound) output.addAudioTrack(sound)
    await output.start()

    let videoDone = 0
    let audioDone = sound ? 0 : 1
    let frameCount = 0
    const report = (): void => options.onProgress?.(Math.min(0.99, (videoDone + audioDone) / 2))
    const stopIfAborted = (): void => {
      if (inner.signal.aborted) throw new DOMException('The export was cancelled', 'AbortError')
    }

    const cues = resolveCues(edit.timeline, edit.texts)
    let shown = ''
    const videoTask = async (): Promise<void> => {
      let offsetS = 0
      for (const piece of pieces) {
        const track = tracks.get(piece.sourceId)
        if (!track) throw new ExportError('DecoderFailed')
        const sink = new CanvasSink(track, { width: size.width, height: size.height, fit: settings.framing === 'fill' ? 'cover' : 'contain' })
        const startS = piece.startMs / 1000
        const retimer = new FrameRetimer(startS, piece.endMs / 1000, offsetS, dropTo)
        try {
          for await (const frame of sink.canvases(startS, piece.endMs / 1000)) {
            stopIfAborted()
            const place = retimer.place(frame.timestamp, frame.duration)
            if (!place) continue
            context.fillStyle = '#000'
            context.fillRect(0, 0, size.width, size.height)
            context.drawImage(frame.canvas, (size.width - frame.canvas.width) / 2, (size.height - frame.canvas.height) / 2)
            const active = activeAt(cues, place.timestamp * 1000)
            if (active.length > 0) {
              const key = cueKey(active)
              if (key !== shown) {
                drawCaptions(overlayContext, active, size.width, size.height, options.rightToLeft)
                shown = key
              }
              context.drawImage(overlay, 0, 0)
            }
            await video.add(place.timestamp, place.duration)
            frameCount++
            videoDone = Math.min(1, (place.timestamp * 1000) / durationMs)
            report()
          }
        } catch (error) {
          throw isCancelled(error) || error instanceof ExportError ? error : new ExportError('DecoderFailed', { cause: error })
        }
        offsetS += pieceDurationMs(piece) / 1000
      }
      videoDone = 1
      video.close()
    }

    const totalFrames = frameCountOf(durationMs)
    const audioTask = async (): Promise<void> => {
      if (!sound) return
      const blocks = mixBlocks({
        layers,
        master: masterEnvelope(edit.mix, durationMs),
        durationMs,
        signal: inner.signal,
        openReader: (layer) => openAudioReader((layer.file.kind === 'source' ? sourceFiles : audioFiles).get(layer.file.id) as File),
      })
      for await (const block of blocks) {
        // The two channels one after the other, as planar samples are, with the time of the block's first frame.
        const planar = new Float32Array(block.left.length * 2)
        planar.set(block.left, 0)
        planar.set(block.right, block.left.length)
        const sample = new AudioSample({ data: planar, format: 'f32-planar', numberOfChannels: 2, sampleRate: EXPORT_RATE, timestamp: block.startFrame / EXPORT_RATE })
        try {
          await sound.add(sample)
        } finally {
          sample.close()
        }
        audioDone = Math.min(1, (block.startFrame + block.left.length) / totalFrames)
        report()
      }
      sound.close()
    }

    // The two run together: the file takes sound and picture in step, so one that ran first would wait for the other.
    const guarded = (task: () => Promise<void>): Promise<void> =>
      task().catch((error: unknown) => {
        inner.abort()
        throw error
      })
    await Promise.all([guarded(videoTask), guarded(audioTask)])
    stopIfAborted()
    await output.finalize()
    const file = await target.finish()
    options.onProgress?.(1)
    const finished = target
    return {
      file,
      fileName,
      width: size.width,
      height: size.height,
      durationMs,
      frameCount,
      container: encoding.container,
      ...(finished.tempName === undefined ? {} : { tempName: finished.tempName }),
      discard: () => finished.discard(),
    }
  } catch (error) {
    await output?.cancel().catch(() => undefined)
    await target?.discard().catch(() => undefined)
    if (isCancelled(error) || signal?.aborted) throw new DOMException('The export was cancelled', 'AbortError')
    throw error instanceof ExportError ? error : new ExportError(failureOf(error), { cause: error })
  } finally {
    signal?.removeEventListener('abort', abort)
    for (const input of inputs) input.dispose()
  }
}
