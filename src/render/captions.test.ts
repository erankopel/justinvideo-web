import { describe, expect, it } from 'vitest'
import { layoutBlock, type Line, wrapLine } from './captions'

// Every character is half the letter size wide, so the widths are easy to work out.
const measure = (text: string): number => [...text].length * 10

describe('cutting a line into lines', () => {
  it('leaves a line that fits as it is', () => {
    expect(wrapLine('hello world', 200, measure)).toEqual(['hello world'])
  })

  it('cuts at spaces so that no line is too wide', () => {
    expect(wrapLine('one two three four', 90, measure)).toEqual(['one two', 'three', 'four'])
  })

  it('keeps an empty line', () => {
    expect(wrapLine('', 100, measure)).toEqual([''])
  })

  it('cuts a word that is too wide between letters', () => {
    expect(wrapLine('abcdefghij', 40, measure)).toEqual(['abcd', 'efgh', 'ij'])
  })

  it('starts the long word on a line of its own after the words before it', () => {
    expect(wrapLine('hi abcdefghij', 40, measure)).toEqual(['hi', 'abcd', 'efgh', 'ij'])
  })

  it('cuts Hebrew and Arabic at spaces too, keeping their letters whole', () => {
    expect(wrapLine('שלום עולם יפה', 60, measure)).toEqual(['שלום', 'עולם', 'יפה'])
    expect(wrapLine('مرحبا بالعالم', 70, measure)).toEqual(['مرحبا', 'بالعالم'])
  })

  it('never makes a line out of nothing, even if one letter is too wide', () => {
    expect(wrapLine('abc', 5, measure)).toEqual(['a', 'b', 'c'])
  })
})

describe('where a block of text goes', () => {
  const lines: Line[] = [{ text: 'hello', rtl: false }]
  const metrics = { ascent: 8, descent: 2 }
  const at = (position: 'top' | 'middle' | 'bottom') => layoutBlock(lines, 10, position, 1_000, 500, measure, metrics)

  it('is centred across the picture, in a box a little larger than its text', () => {
    const block = at('bottom')
    // 5 letters are 50 wide, and the padding is 0.4 of the letter size on each side.
    expect(block.boxWidth).toBeCloseTo(58, 5)
    expect(block.left).toBeCloseTo((1_000 - 58) / 2, 5)
    expect(block.boxHeight).toBeCloseTo(10 + 8, 5)
  })

  it('sits above the bottom edge, at the top, or in the middle', () => {
    expect(at('bottom').top).toBeCloseTo(500 - 35 - 18, 5)
    expect(at('top').top).toBeCloseTo(35, 5)
    expect(at('middle').top).toBeCloseTo((500 - 18) / 2, 5)
  })

  it('wraps to nine tenths of the width, less the padding, and grows taller for it', () => {
    const long: Line[] = [{ text: 'word '.repeat(30).trim(), rtl: false }]
    const block = layoutBlock(long, 10, 'bottom', 400, 300, measure, metrics)
    expect(block.lines.length).toBeGreaterThan(3)
    for (const line of block.lines) expect(measure(line.text)).toBeLessThanOrEqual(400 * 0.9 - 8)
    expect(block.boxHeight).toBeCloseTo(block.lines.length * 10 + 8, 5)
  })

  it('keeps the direction of the line each wrapped line came from', () => {
    const mixed: Line[] = [{ text: 'שלום עולם יפה מאוד', rtl: true }, { text: 'one two three four five', rtl: false }]
    const block = layoutBlock(mixed, 10, 'bottom', 120, 300, measure, metrics)
    const directions = block.lines.map((line) => line.rtl)
    expect(directions[0]).toBe(true)
    expect(directions.at(-1)).toBe(false)
    expect(directions.filter(Boolean).length).toBeGreaterThan(1)
  })
})
