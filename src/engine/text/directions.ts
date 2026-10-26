import type { TextDirection } from './model'

// Direction marks, built from code points so the source never holds invisible characters.
const LEFT_TO_RIGHT_MARK = String.fromCodePoint(0x200e)
const RIGHT_TO_LEFT_MARK = String.fromCodePoint(0x200f)

// The scripts written right to left. A letter in one of them is strongly right to left; the digits and signs inside
// these blocks are not letters and so have no direction of their own, as in the Unicode bidirectional algorithm.
const RIGHT_TO_LEFT_BLOCKS: readonly (readonly [number, number])[] = [
  [0x0590, 0x08ff], // Hebrew, Arabic, Syriac, Thaana, N'Ko, Samaritan, Mandaic and the Arabic extensions
  [0xfb1d, 0xfdff], // Hebrew and Arabic presentation forms
  [0xfe70, 0xfeff],
  [0x10800, 0x10fff],
  [0x1e800, 0x1efff],
]

// Punctuation that Unicode gives a strong right-to-left direction although it is not a letter.
const RIGHT_TO_LEFT_SIGNS = new Set([0x05be, 0x05c0, 0x05c3, 0x05c6, 0x05f3, 0x05f4, 0x061c, 0x200f])

const LETTER_LIKE = /^[\p{L}\p{Nl}\p{Mc}]$/u

function directionOfCodePoint(codePoint: number, char: string): boolean | null {
  if (codePoint === 0x200e) return false
  if (RIGHT_TO_LEFT_SIGNS.has(codePoint)) return true
  if (!LETTER_LIKE.test(char)) return null
  return RIGHT_TO_LEFT_BLOCKS.some(([from, to]) => codePoint >= from && codePoint <= to) ? true : false
}

/**
 * Whether the text has a letter that reads right to left before any that reads left to right. Null when it has
 * neither. Emoji and digits have no direction, so a line that opens with one follows its first letter.
 */
export function firstStrongIsRightToLeft(text: string): boolean | null {
  for (const char of text) {
    const direction = directionOfCodePoint(char.codePointAt(0) ?? 0, char)
    if (direction !== null) return direction
  }
  return null
}

/**
 * Whether a text reads right to left. A chosen direction is used as it is. Auto follows the first letter that has a
 * direction, and falls back to appIsRightToLeft for a text of digits and signs only.
 */
export function readsRightToLeft(text: string, direction: TextDirection, appIsRightToLeft: boolean): boolean {
  switch (direction) {
    case 'ltr':
      return false
    case 'rtl':
      return true
    case 'auto':
      return firstStrongIsRightToLeft(text) ?? appIsRightToLeft
  }
}

/**
 * The text with each line fixed to its direction: a line's direction comes from its first letter that has one, so a
 * mark of the wanted direction in front of the line is what makes a chosen direction hold, and what makes Auto work
 * for a line of digits in a right-to-left app.
 */
export function withDirectionMarks(text: string, direction: TextDirection, appIsRightToLeft: boolean): string {
  return text
    .split('\n')
    .map((line) => (readsRightToLeft(line, direction, appIsRightToLeft) ? RIGHT_TO_LEFT_MARK : LEFT_TO_RIGHT_MARK) + line)
    .join('\n')
}
