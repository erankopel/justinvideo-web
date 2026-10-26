import { parseSrt, type TextItem } from '../engine/text'
import type { Source } from '../project/model'
import { captionsFor, decodeSubtitleBytes, legacyCharsetFor, MAX_SUBTITLE_BYTES } from '../text/subtitle-files'
import type { Notice } from './notice'

/** What came of a subtitle file: the captions it holds for a recording, or the reason it was refused. */
export type SubtitleReading = { kind: 'refused'; notice: Notice } | { kind: 'ready'; items: TextItem[]; unusable: number }

/** Reads a subtitle file (SRT or WebVTT, in whichever encoding it was saved) into captions on a recording. */
export async function readSubtitleFile(file: File, source: Source, language: string): Promise<SubtitleReading> {
  if (file.size > MAX_SUBTITLE_BYTES) return { kind: 'refused', notice: { key: 'subtitleTooBig' } }
  let text: string
  try {
    text = decodeSubtitleBytes(new Uint8Array(await file.arrayBuffer()), legacyCharsetFor(language))
  } catch {
    return { kind: 'refused', notice: { key: 'subtitleUnreadable' } }
  }
  const { items, unusable } = captionsFor(source.id, source.durationMs, parseSrt(text))
  if (items.length === 0) return { kind: 'refused', notice: { key: 'captionsNone' } }
  return { kind: 'ready', items, unusable }
}

/** What to tell the person once captions have been put on the recording: how many, and how many cues could not be used. */
export function captionsAddedNotice(reading: { items: readonly unknown[]; unusable: number }): Notice {
  const n = reading.items.length
  return reading.unusable > 0 ? { key: 'captionsAddedSkipped', values: { n, skipped: reading.unusable }, ok: true } : { key: 'captionsAdded', values: { n }, ok: true }
}
