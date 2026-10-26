// Runs in the browser, from scripts/make-fixtures.mjs: makes the small test videos in test-data/media with WebCodecs.
import { AudioBufferSource, BufferTarget, CanvasSource, Mp4OutputFormat, Output, WebMOutputFormat } from 'mediabunny'

interface Options {
  format: 'webm' | 'mp4'
  width: number
  height: number
  seconds: number
  fps: number
  rotation?: 0 | 90 | 180 | 270
  audio: boolean
  label: string
}

async function makeVideo(options: Options): Promise<number[]> {
  const { format, width, height, seconds, fps, rotation = 0, audio, label } = options
  const output = new Output({ format: format === 'webm' ? new WebMOutputFormat() : new Mp4OutputFormat(), target: new BufferTarget() })
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('No canvas')
  const video = new CanvasSource(canvas, { codec: 'vp9', bitrate: 300_000 })
  output.addVideoTrack(video, { frameRate: fps, rotation })
  const sound = audio ? new AudioBufferSource({ codec: 'opus', bitrate: 32_000 }) : null
  if (sound) output.addAudioTrack(sound)
  await output.start()

  const frames = seconds * fps
  for (let i = 0; i < frames; i++) {
    // The grey level names the frame: it rises from 40 by 180 over the video. Brightness reads the same in every browser, where a colour depends on the matrix a decoder assumes.
    const level = Math.round(40 + (180 * i) / frames)
    context.fillStyle = `rgb(${level}, ${level}, ${level})`
    context.fillRect(0, 0, width, height)
    context.fillStyle = '#fff'
    context.font = `${Math.round(height / 5)}px sans-serif`
    context.fillText(`${label} ${i}`, 8, height / 2)
    await video.add(i / fps, 1 / fps)
  }
  if (sound) {
    const sampleRate = 48_000
    const buffer = new AudioBuffer({ length: sampleRate * seconds, sampleRate, numberOfChannels: 1 })
    const data = buffer.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = 0.3 * Math.sin((2 * Math.PI * 440 * i) / sampleRate)
    await sound.add(buffer)
  }
  await output.finalize()
  const bytes = new Uint8Array((output.target as BufferTarget).buffer ?? new ArrayBuffer(0))
  return [...bytes]
}

;(window as unknown as { makeVideo: typeof makeVideo }).makeVideo = makeVideo
