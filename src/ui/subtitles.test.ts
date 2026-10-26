import { describe, expect, it } from 'vitest'
import type { Source } from '../project/model'
import { MAX_SUBTITLE_BYTES } from '../text/subtitle-files'
import { captionsAddedNotice, readSubtitleFile } from './subtitles'

const recording = { id: 'source-1', durationMs: 10_000 } as Source
const srt = (text: string): File => new File([text], 'cues.srt')
const TWO_CUES = '1\n00:00:01,000 --> 00:00:02,500\nHello\n\n2\n00:00:03,000 --> 00:00:04,000\nThere\n'

describe('reading a subtitle file for a recording', () => {
  it('gives the captions in the file, each on that recording', async () => {
    const reading = await readSubtitleFile(srt(TWO_CUES), recording, 'en')
    expect(reading.kind).toBe('ready')
    if (reading.kind !== 'ready') return
    expect(reading.items).toHaveLength(2)
    expect(reading.unusable).toBe(0)
    expect(reading.items.map((item) => item.text)).toEqual(['Hello', 'There'])
    for (const item of reading.items) expect(item.placement).toMatchObject({ type: 'onSource', sourceId: 'source-1' })
  })

  it('refuses a file that is too big to be subtitles, and one with no cues in it, with the reason', async () => {
    const big = new File([new Uint8Array(MAX_SUBTITLE_BYTES + 1)], 'big.srt')
    expect(await readSubtitleFile(big, recording, 'en')).toEqual({ kind: 'refused', notice: { key: 'subtitleTooBig' } })
    expect(await readSubtitleFile(srt('This is not a subtitle file.'), recording, 'en')).toEqual({ kind: 'refused', notice: { key: 'captionsNone' } })
  })

  it('reads a file saved in the old code page of the language, as Hebrew files often were', async () => {
    // Shalom in windows-1255 after a cue's timing.
    const head = new TextEncoder().encode('1\n00:00:01,000 --> 00:00:02,000\n')
    const word = Uint8Array.from([0xf9, 0xec, 0xe5, 0xed])
    const bytes = new Uint8Array(head.length + word.length + 1)
    bytes.set(head)
    bytes.set(word, head.length)
    bytes[bytes.length - 1] = 0x0a
    const reading = await readSubtitleFile(new File([bytes], 'he.srt'), recording, 'he')
    expect(reading.kind === 'ready' ? reading.items[0]?.text : null).toBe('שלום')
  })
})

describe('what the person is told once captions are on the recording', () => {
  it('says how many, and how many cues could not be used when there were some', () => {
    expect(captionsAddedNotice({ items: [1, 2, 3], unusable: 0 })).toEqual({ key: 'captionsAdded', values: { n: 3 }, ok: true })
    expect(captionsAddedNotice({ items: [1, 2, 3], unusable: 2 })).toEqual({ key: 'captionsAddedSkipped', values: { n: 3, skipped: 2 }, ok: true })
  })
})
