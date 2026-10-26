import { describe, expect, it } from 'vitest'
import {
  activeAt,
  changeTexts,
  clip,
  firstStrongIsRightToLeft,
  MAX_TEXT_ITEMS,
  MAX_TEXT_LENGTH,
  movedTitle,
  newTitleAt,
  onOutput,
  onSource,
  parseSrt,
  readsRightToLeft,
  resizedTitle,
  resolveCues,
  textItem,
  type TextItem,
  type TextOp,
  type TextResult,
  TITLE_STEP_MS,
  timeline,
  validateTexts,
  withDirectionMarks,
} from '../index'

describe('subtitle files', () => {
  const plain = ['1', '00:00:01,000 --> 00:00:03,500', 'Hello there', '', '2', '00:00:04,000 --> 00:00:06,250', 'Second line', 'and a third'].join('\n')

  it('reads numbered cues with times and text', () => {
    const result = parseSrt(plain)
    expect(result.cues).toEqual([
      { startMs: 1_000, endMs: 3_500, text: 'Hello there' },
      { startMs: 4_000, endMs: 6_250, text: 'Second line\nand a third' },
    ])
    expect(result.skipped).toBe(0)
  })

  it('reads Windows line endings and a byte order mark', () => {
    const file = String.fromCodePoint(0xfeff) + plain.replaceAll('\n', '\r\n')
    expect(parseSrt(file).cues.length).toBe(2)
    expect(parseSrt(file).cues[0]?.text).toBe('Hello there')
  })

  it('reads old Mac line endings', () => {
    expect(parseSrt(plain.replaceAll('\n', '\r')).cues.length).toBe(2)
  })

  it('does not need numbers', () => {
    expect(parseSrt('00:00:01,000 --> 00:00:02,000\nOnly this\n').cues).toEqual([{ startMs: 1_000, endMs: 2_000, text: 'Only this' }])
  })

  it('lets a dot replace the comma and reads the fraction as a decimal', () => {
    const result = parseSrt('00:00:01.5 --> 00:00:02.25\nA\n\n00:00:03,05 --> 00:00:04,500\nB\n')
    expect(result.cues).toEqual([
      { startMs: 1_500, endMs: 2_250, text: 'A' },
      { startMs: 3_050, endMs: 4_500, text: 'B' },
    ])
  })

  it('reads hours, minutes and seconds', () => {
    const cue = parseSrt('01:02:03,004 --> 01:02:04,005\nLate\n').cues[0]
    expect(cue?.startMs).toBe(((1 * 60 + 2) * 60 + 3) * 1000 + 4)
    expect(cue?.endMs).toBe(((1 * 60 + 2) * 60 + 4) * 1000 + 5)
  })

  it('removes markup and positioning', () => {
    const result = parseSrt('1\n00:00:01,000 --> 00:00:02,000\n<i>Italic</i> and <font color="#fff">colour</font>\n{\\an8}Top line\n')
    expect(result.cues[0]?.text).toBe('Italic and colour\nTop line')
  })

  it('decodes common entities, an escaped one only once', () => {
    const result = parseSrt('00:00:01,000 --> 00:00:02,000\nTom &amp; Jerry &lt;3&nbsp;you &amp;lt;\n')
    expect(result.cues[0]?.text).toBe('Tom & Jerry <3 you &lt;')
  })

  it('skips and counts a cue whose end is not after its start, or that has no text', () => {
    const file = [
      '1', '00:00:05,000 --> 00:00:04,000', 'Backwards', '',
      '2', '00:00:06,000 --> 00:00:07,000', '',
      '3', '00:00:08,000 --> 00:00:09,000', 'Good',
    ].join('\n')
    const result = parseSrt(file)
    expect(result.cues).toEqual([{ startMs: 8_000, endMs: 9_000, text: 'Good' }])
    expect(result.skipped).toBe(2)
  })

  it('still reads cues run together without blank lines', () => {
    const file = '1\n00:00:01,000 --> 00:00:02,000\nOne\n2\n00:00:03,000 --> 00:00:04,000\nTwo\n'
    expect(parseSrt(file).cues).toEqual([
      { startMs: 1_000, endMs: 2_000, text: 'One' },
      { startMs: 3_000, endMs: 4_000, text: 'Two' },
    ])
  })

  it('keeps a number that is the whole text of a cue', () => {
    const result = parseSrt('1\n00:00:01,000 --> 00:00:02,000\n1984\n\n2\n00:00:03,000 --> 00:00:04,000\nNext\n')
    expect(result.cues[0]?.text).toBe('1984')
  })

  it('keeps Hebrew and Arabic as they are', () => {
    const result = parseSrt('1\n00:00:01,000 --> 00:00:02,000\nשלום עולם\n\n2\n00:00:03,000 --> 00:00:04,000\nمرحبا بالعالم 123\n')
    expect(result.cues[0]?.text).toBe('שלום עולם')
    expect(result.cues[1]?.text).toBe('مرحبا بالعالم 123')
  })

  it('reads WebVTT with its header, identifiers and short times', () => {
    const file = 'WEBVTT\n\nintro\n00:01.000 --> 00:02.500 line:90%\nFirst\n\n00:03.000 --> 00:04.000\nSecond\n'
    const result = parseSrt(file)
    expect(result.cues).toEqual([
      { startMs: 1_000, endMs: 2_500, text: 'First' },
      { startMs: 3_000, endMs: 4_000, text: 'Second' },
    ])
    expect(result.skipped).toBe(0)
  })

  it('cuts a very long cue at the text limit', () => {
    const result = parseSrt('00:00:01,000 --> 00:00:02,000\n' + 'x'.repeat(2_000) + '\n')
    expect(result.cues[0]?.text.length).toBe(MAX_TEXT_LENGTH)
  })

  it('keeps the first cues of a file with more than a project holds', () => {
    const file = Array.from({ length: MAX_TEXT_ITEMS + 5 }, (_, i) => `${i + 1}\n00:00:00,000 --> 00:00:01,000\nCue ${i}`).join('\n\n')
    const result = parseSrt(file)
    expect(result.cues.length).toBe(MAX_TEXT_ITEMS)
    expect(result.skipped).toBe(5)
  })

  it('gives nothing for text that is not a subtitle file', () => {
    const result = parseSrt('just some words\nand more words\n')
    expect(result.cues).toEqual([])
    expect(result.skipped).toBe(0)
  })

  it('gives nothing for an empty file', () => {
    expect(parseSrt('')).toEqual({ cues: [], skipped: 0 })
  })
})

describe('where texts are shown', () => {
  const title = (id: string, start: number, end: number, text = id): TextItem => textItem(id, text, onOutput(start, end))
  const caption = (id: string, source: string, start: number, end: number, text = id): TextItem =>
    textItem(id, text, onSource(source, start, end))

  // Two seconds of s1 from 0, then two seconds of s1 from 5 s: the middle of the recording is cut out.
  const cut = timeline([clip('a', 's1', 0, 2_000), clip('b', 's1', 5_000, 2_000)])

  const times = (items: TextItem[], t = cut): [string, number, number][] =>
    resolveCues(t, items).map((cue) => [cue.id, cue.startMs, cue.endMs])

  it('keeps a title where it was placed and cuts it at the end of the edit', () => {
    expect(times([title('t1', 500, 1_500)])).toEqual([['t1', 500, 1_500]])
    expect(times([title('t1', 3_000, 9_000)])).toEqual([['t1', 3_000, 4_000]])
    expect(times([title('t1', 4_000, 9_000)])).toEqual([])
  })

  it('shows a caption on a part that is kept where that part is', () => {
    // The caption is on 1.0 to 1.5 s of the recording, in the first clip; and 5.5 to 6.0 s, in the second.
    expect(times([caption('c1', 's1', 1_000, 1_500), caption('c2', 's1', 5_500, 6_000)])).toEqual([
      ['c1', 1_000, 1_500],
      ['c2', 2_500, 3_000],
    ])
  })

  it('does not show a caption on a part that was cut out', () => {
    expect(times([caption('c1', 's1', 2_500, 4_500)])).toEqual([])
  })

  it('shows a caption that a cut falls inside for the kept part only, as one cue', () => {
    // 1.5 to 5.5 s of the recording: 1.5 to 2 s is kept at the end of the first clip, 5 to 5.5 s at the start of the
    // second. The two pieces meet on the edit's clock, so they are one cue.
    expect(times([caption('c1', 's1', 1_500, 5_500)])).toEqual([['c1', 1_500, 2_500]])
  })

  it('shows a caption of a repeated part each time', () => {
    const repeated = timeline([clip('a', 's1', 0, 1_000), clip('b', 's1', 0, 1_000)])
    expect(times([caption('c1', 's1', 200, 800)], repeated)).toEqual([
      ['c1', 200, 800],
      ['c1', 1_200, 1_800],
    ])
  })

  it('makes a caption follow its footage when clips are reordered', () => {
    const swapped = timeline([clip('b', 's1', 5_000, 2_000), clip('a', 's1', 0, 2_000)])
    expect(times([caption('c1', 's1', 1_000, 1_500), caption('c2', 's1', 5_500, 6_000)], swapped)).toEqual([
      ['c2', 500, 1_000],
      ['c1', 3_000, 3_500],
    ])
  })

  it('makes a caption belong to its own recording only', () => {
    const two = timeline([clip('a', 's1', 0, 2_000), clip('b', 's2', 0, 2_000)])
    expect(times([caption('c1', 's2', 500, 1_000)], two)).toEqual([['c1', 2_500, 3_000]])
  })

  it('joins the two halves of a split into one cue again', () => {
    const split = timeline([clip('a', 's1', 0, 1_000), clip('b', 's1', 1_000, 2_000)])
    expect(times([caption('c1', 's1', 500, 1_800)], split)).toEqual([['c1', 500, 1_800]])
  })

  it('puts cues in order of time', () => {
    const result = times([title('late', 3_000, 3_500), title('early', 100, 200), caption('mid', 's1', 1_000, 1_100)])
    expect(result.map(([id]) => id)).toEqual(['early', 'mid', 'late'])
  })

  it('carries what the renderer needs', () => {
    const item = textItem('t1', 'Hi', onOutput(0, 1_000), { direction: 'rtl', position: 'top', size: 'large' })
    const [cue] = resolveCues(cut, [item])
    expect(cue).toMatchObject({ text: 'Hi', direction: 'rtl', position: 'top', size: 'large', id: 't1' })
  })

  it('shows nothing for an empty edit', () => {
    expect(resolveCues(timeline(), [title('t1', 0, 1_000), caption('c1', 's1', 0, 1_000)])).toEqual([])
  })

  it('finds the cues on screen at a time', () => {
    const cues = resolveCues(cut, [title('a', 0, 1_000), title('b', 500, 1_500)])
    expect(activeAt(cues, 100).map((c) => c.id)).toEqual(['a'])
    expect(activeAt(cues, 700).map((c) => c.id)).toEqual(['a', 'b'])
    expect(activeAt(cues, 1_000).map((c) => c.id)).toEqual(['b'])
    expect(activeAt(cues, 1_500)).toEqual([])
  })
})

describe('changes to the texts', () => {
  const lengths = new Map([['s1', 20_000], ['s2', 5_000]])
  const title = (id: string, text = id, start = 0, end = 1_000): TextItem => textItem(id, text, onOutput(start, end))
  const caption = (id: string, source: string, start: number, end: number): TextItem => textItem(id, id, onSource(source, start, end))
  const change = (texts: readonly TextItem[], op: TextOp): TextResult => changeTexts(texts, op, lengths)
  const changed = (result: TextResult): readonly TextItem[] => {
    if (result.kind !== 'changed') throw new Error(`Expected a change, got ${JSON.stringify(result)}`)
    return result.texts
  }

  it('appends and keeps the order', () => {
    expect(changed(change([title('a')], { type: 'add', item: title('b') })).map((t) => t.id)).toEqual(['a', 'b'])
  })

  it('replaces the text with that id', () => {
    const result = changed(change([title('a'), title('b')], { type: 'replace', item: title('b', 'new') }))
    expect(result.map((t) => t.text)).toEqual(['a', 'new'])
  })

  it('changes nothing when replaced with the same text', () => {
    expect(change([title('a')], { type: 'replace', item: title('a') })).toEqual({ kind: 'unchanged' })
  })

  it('refuses to replace or remove a text that is not there', () => {
    expect(change([title('a')], { type: 'replace', item: title('zzz') })).toEqual({ kind: 'rejected', error: 'UnknownText' })
    expect(change([title('a')], { type: 'remove', id: 'zzz' })).toEqual({ kind: 'rejected', error: 'UnknownText' })
  })

  it('takes a text away', () => {
    expect(changed(change([title('a'), title('b')], { type: 'remove', id: 'a' })).map((t) => t.id)).toEqual(['b'])
  })

  it('adds several at once as one change', () => {
    const result = changed(change([], { type: 'addAll', items: [title('a'), title('b')] }))
    expect(result.length).toBe(2)
    expect(change(result, { type: 'addAll', items: [] })).toEqual({ kind: 'unchanged' })
  })

  it('removes the captions of one recording together and leaves titles', () => {
    const items = [title('t'), caption('c1', 's1', 0, 100), caption('c2', 's2', 0, 100), caption('c3', 's1', 200, 300)]
    const result = changed(change(items, { type: 'removeCaptionsOf', sourceId: 's1' }))
    expect(result.map((t) => t.id)).toEqual(['t', 'c2'])
    expect(change(result, { type: 'removeCaptionsOf', sourceId: 's1' })).toEqual({ kind: 'unchanged' })
  })

  it('refuses a change that breaks a rule and leaves nothing half done', () => {
    const items = [title('a')]
    const invalid: TextResult = { kind: 'rejected', error: 'Invalid' }
    expect(change(items, { type: 'add', item: title('a') })).toEqual(invalid) // repeated id
    expect(change(items, { type: 'add', item: title('b', ' ') })).toEqual(invalid)
    expect(change(items, { type: 'add', item: caption('c', 's2', 4_000, 6_000) })).toEqual(invalid)
    expect(change(items, { type: 'add', item: caption('c', 'nope', 0, 100) })).toEqual(invalid)
    expect(change(items, { type: 'addAll', items: [title('x'), title('x')] })).toEqual(invalid)
  })

  it('keeps the limit on how many texts a project holds', () => {
    const full = Array.from({ length: MAX_TEXT_ITEMS }, (_, i) => title(`t${i}`))
    expect(change(full, { type: 'add', item: title('one-more') })).toEqual({ kind: 'rejected', error: 'Invalid' })
    expect(change(full, { type: 'remove', id: 't0' }).kind).toBe('changed')
  })

  it('replaces the captions of a recording in one change when a subtitle file is imported again', () => {
    const items = [title('t'), caption('c1', 's1', 0, 100), caption('c2', 's2', 0, 100)]
    const fresh = [caption('n1', 's1', 0, 50), caption('n2', 's1', 60, 90)]
    const result = changed(change(items, { type: 'replaceCaptionsOf', sourceId: 's1', items: fresh }))
    expect(result.map((t) => t.id)).toEqual(['t', 'c2', 'n1', 'n2'])
  })

  it('changes nothing when replacing with nothing where there was nothing', () => {
    expect(change([title('t')], { type: 'replaceCaptionsOf', sourceId: 's1', items: [] })).toEqual({ kind: 'unchanged' })
  })

  it('refuses to replace with captions that break a rule', () => {
    const tooLate = [caption('n1', 's2', 4_000, 6_000)]
    expect(change([], { type: 'replaceCaptionsOf', sourceId: 's2', items: tooLate })).toEqual({ kind: 'rejected', error: 'Invalid' })
  })
})

describe('the rules for texts', () => {
  const lengths = new Map([['s1', 10_000]])
  const title = (id = 't1', text = 'Hi', start = 0, end = 1_000): TextItem => textItem(id, text, onOutput(start, end))

  it('passes fine texts', () => {
    expect(validateTexts([title(), textItem('c1', 'Hi', onSource('s1', 0, 10_000))], lengths)).toBeNull()
    expect(validateTexts([], lengths)).toBeNull()
  })

  it('needs an id that is valid and unique', () => {
    expect(validateTexts([title('bad id')], lengths)).not.toBeNull()
    expect(validateTexts([title('a'), title('a')], lengths)).not.toBeNull()
  })

  it('needs text of a limited length', () => {
    expect(validateTexts([title('t1', '   ')], lengths)).not.toBeNull()
    expect(validateTexts([title('t1', 'x'.repeat(MAX_TEXT_LENGTH + 1))], lengths)).not.toBeNull()
    expect(validateTexts([title('t1', 'x'.repeat(MAX_TEXT_LENGTH))], lengths)).toBeNull()
  })

  it('needs a text to end after it starts and not before zero', () => {
    expect(validateTexts([title('t1', 'Hi', 500, 500)], lengths)).not.toBeNull()
    expect(validateTexts([title('t1', 'Hi', -1, 500)], lengths)).not.toBeNull()
  })

  it('needs a caption to have its recording and stay inside it', () => {
    expect(validateTexts([textItem('c1', 'Hi', onSource('missing', 0, 100))], lengths)).not.toBeNull()
    expect(validateTexts([textItem('c1', 'Hi', onSource('s1', 9_000, 10_001))], lengths)).not.toBeNull()
  })

  it('holds a limited number of texts', () => {
    const many = Array.from({ length: MAX_TEXT_ITEMS + 1 }, (_, i) => title(`t${i}`))
    expect(validateTexts(many, lengths)).not.toBeNull()
  })
})

describe('the direction of a text', () => {
  const lrm = String.fromCodePoint(0x200e)
  const rlm = String.fromCodePoint(0x200f)

  it('is decided by the first letter that has a direction', () => {
    expect(firstStrongIsRightToLeft('שלום world')).toBe(true)
    expect(firstStrongIsRightToLeft('world שלום')).toBe(false)
    expect(firstStrongIsRightToLeft('مرحبا')).toBe(true)
    expect(firstStrongIsRightToLeft('123 - שלום')).toBe(true)
  })

  it('has none for digits and signs alone', () => {
    expect(firstStrongIsRightToLeft('12:30 - 45!')).toBeNull()
    expect(firstStrongIsRightToLeft('')).toBeNull()
  })

  it('has none for Arabic digits and emoji, so the first letter decides', () => {
    expect(firstStrongIsRightToLeft('١٢٣')).toBeNull()
    expect(firstStrongIsRightToLeft('🎬 שלום')).toBe(true)
    expect(firstStrongIsRightToLeft('🎬 hello')).toBe(false)
  })

  it('uses a chosen direction whatever the text', () => {
    expect(readsRightToLeft('שלום', 'ltr', true)).toBe(false)
    expect(readsRightToLeft('Hello', 'rtl', false)).toBe(true)
  })

  it('follows the text and then the app when automatic', () => {
    expect(readsRightToLeft('שלום', 'auto', false)).toBe(true)
    expect(readsRightToLeft('Hello', 'auto', true)).toBe(false)
    expect(readsRightToLeft('2026', 'auto', true)).toBe(true)
    expect(readsRightToLeft('2026', 'auto', false)).toBe(false)
  })

  it('gives every line the mark of its own direction', () => {
    expect(withDirectionMarks('שלום\nHello', 'auto', false)).toBe(rlm + 'שלום' + '\n' + lrm + 'Hello')
  })

  it('marks every line the same for a chosen direction', () => {
    expect(withDirectionMarks('שלום\nHello', 'ltr', true)).toBe(lrm + 'שלום' + '\n' + lrm + 'Hello')
    expect(withDirectionMarks('a\nb', 'rtl', false)).toBe(rlm + 'a' + '\n' + rlm + 'b')
  })
})

describe('the timing of a title', () => {
  it('starts a new title at the playhead for three seconds', () => {
    expect(newTitleAt(1_000, 10_000)).toEqual(onOutput(1_000, 4_000))
  })

  it('moves a new title near the end earlier to fit', () => {
    expect(newTitleAt(9_000, 10_000)).toEqual(onOutput(7_000, 10_000))
    expect(newTitleAt(10_000, 10_000)).toEqual(onOutput(7_000, 10_000))
  })

  it('covers the whole of a short edit', () => {
    expect(newTitleAt(1_500, 2_000)).toEqual(onOutput(0, 2_000))
  })

  it('never starts a new title before the edit', () => {
    expect(newTitleAt(-50, 10_000)).toEqual(onOutput(0, 3_000))
  })

  it('keeps the length when moving', () => {
    expect(movedTitle(onOutput(1_000, 4_000), TITLE_STEP_MS, 10_000)).toEqual(onOutput(1_500, 4_500))
    expect(movedTitle(onOutput(1_000, 4_000), -TITLE_STEP_MS, 10_000)).toEqual(onOutput(500, 3_500))
  })

  it('stops at the edges of the edit when moving', () => {
    expect(movedTitle(onOutput(1_000, 4_000), -2_000, 10_000)).toEqual(onOutput(0, 3_000))
    expect(movedTitle(onOutput(7_000, 10_000), TITLE_STEP_MS, 10_000)).toEqual(onOutput(7_000, 10_000))
  })

  it('brings back a title that is past a shortened edit', () => {
    expect(movedTitle(onOutput(12_000, 15_000), 0, 5_000)).toEqual(onOutput(2_000, 5_000))
    expect(movedTitle(onOutput(1_000, 9_000), 0, 4_000)).toEqual(onOutput(0, 4_000))
  })

  it('changes the end and keeps the start when resizing', () => {
    expect(resizedTitle(onOutput(1_000, 4_000), TITLE_STEP_MS, 10_000)).toEqual(onOutput(1_000, 4_500))
    expect(resizedTitle(onOutput(1_000, 4_000), -TITLE_STEP_MS, 10_000)).toEqual(onOutput(1_000, 3_500))
  })

  it('cannot be made shorter than half a second', () => {
    expect(resizedTitle(onOutput(1_000, 4_000), -5_000, 10_000)).toEqual(onOutput(1_000, 1_500))
  })

  it('cannot be made longer than the edit', () => {
    expect(resizedTitle(onOutput(8_000, 10_000), TITLE_STEP_MS, 10_000)).toEqual(onOutput(8_000, 10_000))
    expect(resizedTitle(onOutput(8_000, 9_000), 5_000, 10_000)).toEqual(onOutput(8_000, 10_000))
  })

  it('keeps at least one millisecond for a title that starts past the end', () => {
    expect(resizedTitle(onOutput(12_000, 15_000), 0, 10_000)).toEqual(onOutput(9_999, 10_000))
  })
})
