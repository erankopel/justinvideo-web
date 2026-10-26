import { ADTS, BlobSource, FLAC, Input, MATROSKA, MP3, MP4, OGG, QTFF, WAVE, WEBM } from 'mediabunny'
import { MAX_TIMELINE_MS } from '../engine'
import { type AudioItem, audioItem, MAX_AUDIO_NAME_LENGTH, MIN_AUDIO_ITEM_MS } from '../engine/audio'
import { randomAudioId } from '../engine'
import { extensionFor, newMediaPath } from '../import/paths'
import { hasRoomFor, type MediaStore, StorageFullError } from '../storage/media-store'

/** The sound files the site reads: MP3, WAV, OGG, FLAC, AAC, and the sound of MP4, MOV, WebM and MKV files. */
export const AUDIO_FORMATS = [MP3, WAVE, OGG, FLAC, ADTS, MP4, QTFF, WEBM, MATROSKA]

export type AudioFailure =
  /** The file could not be opened or read. */
  | 'Unreadable'
  /** The file opened but holds no sound. */
  | 'NotAudio'
  /** There is not enough free storage to keep a copy. */
  | 'NoSpace'
  /** The sound is shorter than a tenth of a second or longer than 24 hours. */
  | 'Unusable'
  /** The sound is in a form that this browser cannot decode. */
  | 'UnsupportedFormat'

export class AudioImportError extends Error {
  constructor(
    readonly failure: AudioFailure,
    options?: { cause?: unknown },
  ) {
    super(failure, options)
  }
}

export interface AudioProbe {
  readonly displayName: string
  /** Rounded down, so that a piece can never reach past the end of its file. */
  readonly durationMs: number
}

const isReadFailure = (error: unknown): boolean =>
  error instanceof DOMException && ['NotReadableError', 'NotFoundError', 'SecurityError', 'AbortError'].includes(error.name)

/** Reads the length of a sound file without copying it, and checks that this browser can decode it. */
export async function probeAudio(file: File): Promise<AudioProbe> {
  if (file.size === 0) throw new AudioImportError('Unusable')
  const input = new Input({ source: new BlobSource(file), formats: AUDIO_FORMATS })
  try {
    let track
    try {
      track = await input.getPrimaryAudioTrack()
    } catch (error) {
      throw new AudioImportError(isReadFailure(error) ? 'Unreadable' : 'NotAudio', { cause: error })
    }
    if (track === null) throw new AudioImportError('NotAudio')
    if (!(await track.canDecode())) throw new AudioImportError('UnsupportedFormat')
    const durationMs = Math.floor((await track.computeDuration()) * 1000)
    if (!Number.isFinite(durationMs) || durationMs < MIN_AUDIO_ITEM_MS || durationMs > MAX_TIMELINE_MS) throw new AudioImportError('Unusable')
    return { displayName: file.name || 'audio', durationMs }
  } catch (error) {
    if (error instanceof AudioImportError) throw error
    throw new AudioImportError(isReadFailure(error) ? 'Unreadable' : 'NotAudio', { cause: error })
  } finally {
    input.dispose()
  }
}

interface Stored {
  readonly id: string
  readonly file: string
  readonly displayName: string
  readonly fileDurationMs: number
}

/** A piece of music that plays the whole of its file from atMs, as far as the longest possible edit allows. */
export function musicItem(stored: Stored, atMs: number): AudioItem {
  return audioItem({
    ...stored,
    kind: 'music',
    displayName: stored.displayName.slice(0, MAX_AUDIO_NAME_LENGTH),
    startMs: atMs,
    lengthMs: Math.min(stored.fileDurationMs, MAX_TIMELINE_MS - atMs),
  })
}

/** A voiceover laid where its recording began. It ends where the edit does: the recording may run a moment past it. */
export function voiceoverItem(stored: Stored, atMs: number, editDurationMs: number): AudioItem {
  const room = Math.max(editDurationMs - atMs, MIN_AUDIO_ITEM_MS)
  return audioItem({
    ...stored,
    kind: 'voiceover',
    displayName: stored.displayName.slice(0, MAX_AUDIO_NAME_LENGTH),
    startMs: atMs,
    lengthMs: Math.min(stored.fileDurationMs, MAX_TIMELINE_MS - atMs, room),
  })
}

export interface AudioDeps {
  readonly media: MediaStore
  readonly probe?: (file: File) => Promise<AudioProbe>
  readonly hasRoom?: (bytes: number) => Promise<boolean>
}

/** Copies a blob into the project's folder under a new name and says where. */
export async function storeAudio(deps: AudioDeps, projectId: string, blob: Blob, extension: string): Promise<string> {
  if (!(await (deps.hasRoom ?? hasRoomFor)(blob.size))) throw new AudioImportError('NoSpace')
  const path = newMediaPath(extension)
  try {
    await deps.media.write(projectId, path, blob)
  } catch (error) {
    throw new AudioImportError(error instanceof StorageFullError ? 'NoSpace' : 'Unreadable', { cause: error })
  }
  return path
}

/**
 * Copies a piece of music the person picked into the project, so that it still plays after the original is moved, and
 * makes the piece that plays the whole file from atMs. The copy stays in the project's folder; the caller adds the piece
 * to the mix, and takes the copy away again with removeAudioFile if the mix will not have it.
 */
export async function prepareMusic(deps: AudioDeps, projectId: string, file: File, atMs: number): Promise<AudioItem> {
  const facts = await (deps.probe ?? probeAudio)(file)
  const path = await storeAudio(deps, projectId, file, extensionFor(file, 'm4a'))
  return musicItem({ id: randomAudioId(), file: path, displayName: facts.displayName, fileDurationMs: facts.durationMs }, atMs)
}

/** Takes a copy away that no piece of the mix uses. Never fails: a leftover file is not worth a message. */
export async function removeAudioFile(media: MediaStore, projectId: string, path: string): Promise<void> {
  await media.remove(projectId, path).catch(() => undefined)
}
