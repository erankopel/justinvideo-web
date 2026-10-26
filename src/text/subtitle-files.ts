import { randomTextId } from '../engine'
import { MAX_TEXT_ITEMS, onSource, type SrtParse, type TextItem } from '../engine/text'

/** The largest subtitle file that is read, in bytes. A feature film's SRT is about a hundred kilobytes. */
export const MAX_SUBTITLE_BYTES = 5 * 1024 * 1024

/** The old code page that subtitle files in a language were commonly saved in before UTF-8, or Western European for the rest. */
export function legacyCharsetFor(language: string): string {
  switch (language.toLowerCase().slice(0, 2)) {
    case 'he':
    case 'iw':
      return 'windows-1255'
    case 'ar':
    case 'fa':
    case 'ur':
      return 'windows-1256'
    case 'ru':
    case 'bg':
    case 'uk':
    case 'sr':
      return 'windows-1251'
    case 'el':
      return 'windows-1253'
    case 'tr':
      return 'windows-1254'
    case 'pl':
    case 'cs':
    case 'sk':
    case 'hu':
    case 'ro':
    case 'hr':
    case 'sl':
      return 'windows-1250'
    default:
      return 'windows-1252'
  }
}

/** The old code pages of the right-to-left and Cyrillic scripts, whose bytes can be told apart by what they make of themselves. */
const SCRIPT_CODE_PAGES = ['windows-1255', 'windows-1256', 'windows-1251']

/** Whether a decoded character is a letter of the script that the code page is for. */
function isScriptLetter(codePage: string, code: number): boolean {
  if (codePage === 'windows-1255') return code >= 0x05d0 && code <= 0x05ea
  if (codePage === 'windows-1256') return code >= 0x0621 && code <= 0x064a
  return (code >= 0x0410 && code <= 0x044f) || code === 0x0401 || code === 0x0451
}

/** The letters that Hebrew writes differently at the end of a word. They are never followed by another letter of the word. */
const isHebrewFinalLetter = (code: number): boolean => code === 0x05da || code === 0x05dd || code === 0x05df || code === 0x05e3 || code === 0x05e5

/**
 * Whether the bytes read as running text in the script of codePage: nearly everything beyond ASCII is a letter of that
 * script, those letters are a large part of all the letters (an accent in a Western European word is not), and Hebrew has
 * its final letters only at the ends of words, which a Cyrillic file read as Hebrew does not.
 */
function readsAs(codePage: string, bytes: Uint8Array): boolean {
  const text = new TextDecoder(codePage).decode(bytes)
  let beyondAscii = 0
  let script = 0
  let ascii = 0
  let misplacedFinals = 0
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code >= 0x80) {
      beyondAscii++
      if (isScriptLetter(codePage, code)) {
        script++
        if (codePage === 'windows-1255' && isHebrewFinalLetter(code) && i + 1 < text.length && isScriptLetter(codePage, text.charCodeAt(i + 1))) {
          misplacedFinals++
        }
      }
    } else if ((code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a)) {
      ascii++
    }
  }
  return script >= 4 && script >= 0.9 * beyondAscii && script >= 0.4 * (script + ascii) && misplacedFinals <= 0.02 * script
}

/**
 * The code page to read a file that is not UTF-8 in. The one for the person's language, preferred, is tried first, so a
 * Hebrew visitor reads an old Hebrew file as Hebrew; then the others whose script the bytes fit, so a Hebrew file for a
 * visitor in English is not read as Western European. When none fits, preferred stands.
 */
export function guessLegacyCharset(bytes: Uint8Array, preferred: string): string {
  // Cyrillic is tried last whatever the language: any run of bytes above 0xC0 is Cyrillic letters, so it fits everything.
  const order = [...new Set([preferred, ...SCRIPT_CODE_PAGES])]
    .filter((page) => SCRIPT_CODE_PAGES.includes(page))
    .sort((a, b) => Number(a === 'windows-1251') - Number(b === 'windows-1251'))
  for (const codePage of order) if (readsAs(codePage, bytes)) return codePage
  return preferred
}

/**
 * Turns the bytes of a subtitle file into text. A byte-order mark says UTF-8 or UTF-16; without one the bytes are read as
 * UTF-8 if they are valid UTF-8, which almost every modern file is, and otherwise in the old code page that fits them,
 * starting with legacy, the one that files in the person's language were saved in.
 */
export function decodeSubtitleBytes(bytes: Uint8Array, legacy: string): string {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2))
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2))
  const start = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0
  const body = bytes.subarray(start)
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(body)
  } catch {
    return new TextDecoder(guessLegacyCharset(body, legacy)).decode(body)
  }
}

/**
 * The captions that a subtitle file gives a recording. Times are the file's, which are the recording's own; a cue that
 * starts after the recording ends is dropped and one that runs past the end is cut at it. Returns the captions and the
 * number of cues that could not be used.
 */
export function captionsFor(
  sourceId: string,
  sourceLengthMs: number,
  parse: SrtParse,
  newId: () => string = randomTextId,
): { items: TextItem[]; unusable: number } {
  let unusable = parse.skipped
  const items: TextItem[] = []
  for (const cue of parse.cues) {
    if (cue.startMs >= sourceLengthMs || items.length >= MAX_TEXT_ITEMS) {
      unusable++
      continue
    }
    items.push({
      id: newId(),
      text: cue.text,
      placement: onSource(sourceId, cue.startMs, Math.min(cue.endMs, sourceLengthMs)),
      direction: 'auto',
      position: 'bottom',
      size: 'medium',
    })
  }
  return { items, unusable }
}
