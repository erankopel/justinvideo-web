import { MAX_TEXT_ITEMS, MAX_TEXT_LENGTH } from './model'

/** One subtitle from a file: its text and the time it is shown, on the clock of the video the file was made for. */
export interface SrtCue {
  readonly startMs: number
  readonly endMs: number
  readonly text: string
}

/** What a subtitle file held: the cues that could be used, and how many that looked like cues could not. */
export interface SrtParse {
  readonly cues: readonly SrtCue[]
  readonly skipped: number
}

// Hours are optional so that WebVTT files read too. The fraction is read as a decimal: 5 is half a second.
const TIMING = /(?:(\d{1,3}):)?(\d{1,2}):(\d{2})[,.](\d{1,3})\s*-->\s*(?:(\d{1,3}):)?(\d{1,2}):(\d{2})[,.](\d{1,3})/
const TAG = /<[^>]*>/g
const OVERRIDE_BLOCK = /\{[^}]*\}/g
const ENTITIES: readonly (readonly [string, string])[] = [
  ['&nbsp;', ' '],
  ['&lt;', '<'],
  ['&gt;', '>'],
  ['&quot;', '"'],
  ['&amp;', '&'],
]

// Built from its code point, so the source never holds an invisible character.
const BYTE_ORDER_MARK = String.fromCodePoint(0xfeff)

function milliseconds(hours: string, minutes: string, seconds: string, fraction: string): number {
  return ((Number(hours || '0') * 60 + Number(minutes)) * 60 + Number(seconds)) * 1000 + Number(fraction.padEnd(3, '0'))
}

function cleaned(lines: readonly string[]): string {
  const joined = lines
    .map((line) => {
      let result = line.replace(TAG, '').replace(OVERRIDE_BLOCK, '')
      // The ampersand last, so that an escaped entity is not decoded twice.
      for (const [entity, plain] of ENTITIES) result = result.replaceAll(entity, plain)
      return result.trim()
    })
    .join('\n')
  const text = joined
    .split('\n')
    .filter((line) => line.trim() !== '')
    .join('\n')
  return text.slice(0, MAX_TEXT_LENGTH)
}

/**
 * Reads a SubRip (SRT) file, and WebVTT too. A cue is a line with two times joined by an arrow, and the lines after it
 * until a blank line. A number or a name before the times is ignored, markup such as italics and positioning is
 * removed, and a cue with no text or with an end that is not after its start is skipped and counted. A file with its
 * cues run together without blank lines still reads: the next times begin the next cue.
 */
export function parseSrt(raw: string): SrtParse {
  const text = raw.startsWith(BYTE_ORDER_MARK) ? raw.slice(BYTE_ORDER_MARK.length) : raw
  const lines = text
    .replaceAll('\r\n', '\n')
    .replaceAll('\r', '\n')
    .split('\n')
    .map((line) => (line.trim() === '' ? '' : line))
  const cues: SrtCue[] = []
  let skipped = 0

  let timing: RegExpExecArray | null = null
  let body: string[] = []

  const finish = (sawBlankLine: boolean): void => {
    const match = timing
    if (match === null) return
    const last = body[body.length - 1]
    if (!sawBlankLine && last !== undefined && /^\p{Nd}*$/u.test(last.trim())) {
      // No blank line before the next cue: the last line is that cue's number.
      body.pop()
    }
    const g = (index: number): string => match[index] ?? ''
    const start = milliseconds(g(1), g(2), g(3), g(4))
    const end = milliseconds(g(5), g(6), g(7), g(8))
    const cueText = cleaned(body)
    if (end > start && cueText !== '') {
      if (cues.length < MAX_TEXT_ITEMS) cues.push({ startMs: start, endMs: end, text: cueText })
      else skipped++
    } else {
      skipped++
    }
    timing = null
    body = []
  }

  for (const line of lines) {
    const match = TIMING.exec(line)
    if (match !== null) {
      finish(false)
      timing = match
    } else if (line === '') {
      finish(true)
    } else if (timing !== null) {
      body.push(line)
    }
  }
  finish(true)
  return { cues, skipped }
}
