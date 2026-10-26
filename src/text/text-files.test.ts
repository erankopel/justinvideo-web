import { describe, expect, it } from 'vitest'
import { parseSrt } from '../engine/text'
import { lanesOf } from '../timeline/lanes'
import { captionsFor, decodeSubtitleBytes, legacyCharsetFor } from './subtitle-files'

/** Bytes in a single-byte code page, made by inverting what the decoder makes of every byte. */
function encodeIn(label: string, text: string): Uint8Array {
  const decoder = new TextDecoder(label)
  const byChar = new Map<string, number>()
  for (let byte = 0; byte < 256; byte++) byChar.set(decoder.decode(Uint8Array.of(byte)), byte)
  return Uint8Array.from([...text].map((char) => byChar.get(char) ?? 0x3f))
}

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text)
const utf16 = (text: string, little: boolean): Uint8Array => {
  const bytes: number[] = little ? [0xff, 0xfe] : [0xfe, 0xff]
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i)
    bytes.push(...(little ? [unit & 0xff, unit >> 8] : [unit >> 8, unit & 0xff]))
  }
  return Uint8Array.from(bytes)
}

const hebrew = 'שלום עולם'
const arabic = 'مرحبا بالعالم'
const latin1 = 'iso-8859-1'

describe('reading the bytes of a subtitle file', () => {
  it('reads UTF-8 as it is', () => {
    expect(decodeSubtitleBytes(utf8(`${hebrew} ${arabic}`), latin1)).toBe(`${hebrew} ${arabic}`)
  })

  it('drops a UTF-8 byte order mark', () => {
    expect(decodeSubtitleBytes(Uint8Array.from([0xef, 0xbb, 0xbf, ...utf8(hebrew)]), latin1)).toBe(hebrew)
  })

  it('reads UTF-16 with a byte order mark', () => {
    expect(decodeSubtitleBytes(utf16(arabic, true), latin1)).toBe(arabic)
    expect(decodeSubtitleBytes(utf16(hebrew, false), latin1)).toBe(hebrew)
  })

  it('reads an old Hebrew file with the Hebrew code page', () => {
    const bytes = encodeIn(legacyCharsetFor('iw'), hebrew)
    expect(decodeSubtitleBytes(bytes, legacyCharsetFor('iw'))).toBe(hebrew)
    // The same bytes are not valid UTF-8, and for a visitor in English the content still says they are Hebrew.
    expect(decodeSubtitleBytes(bytes, legacyCharsetFor('en'))).toBe(hebrew)
  })

  const hebrewSentences = 'זהו משפט ארוך בעברית כדי לבדוק את הזיהוי של דף הקוד\nוגם שורה שנייה עם מילים נוספות'
  const arabicSentences = 'هذه جملة طويلة بالعربية لاختبار التعرف على صفحة الترميز\nوهذا سطر ثان بكلمات إضافية'
  const russianSentences = 'Это длинное предложение по-русски для проверки кодировки\nи вторая строка с другими словами'

  it('reads an old Hebrew file as Hebrew whatever the visitor’s language', () => {
    const bytes = encodeIn('windows-1255', hebrewSentences)
    for (const language of ['en', 'ar', 'ru']) expect(decodeSubtitleBytes(bytes, legacyCharsetFor(language)), language).toBe(hebrewSentences)
  })

  it('reads an old Arabic file as Arabic whatever the visitor’s language', () => {
    const bytes = encodeIn('windows-1256', arabicSentences)
    for (const language of ['en', 'iw']) expect(decodeSubtitleBytes(bytes, legacyCharsetFor(language)), language).toBe(arabicSentences)
  })

  it('does not take an old Russian file for Hebrew or Arabic', () => {
    const bytes = encodeIn('windows-1251', russianSentences)
    for (const language of ['en', 'iw', 'ar', 'ru']) expect(decodeSubtitleBytes(bytes, legacyCharsetFor(language)), language).toBe(russianSentences)
  })

  it('keeps the accents of a Western European file', () => {
    const french = "Où est-ce que l'été commence ? À côté de l'église, près de la forêt.\nIl était déjà très tard."
    const german = 'Schöne Grüße aus München, wir fahren über die Straße zur Küche.\nGrößere Äpfel gibt es nicht.'
    const polish = 'Zażółć gęślą jaźń, to jest zdanie testowe o łące i żółwiu.'
    expect(decodeSubtitleBytes(encodeIn('windows-1252', french), legacyCharsetFor('en'))).toBe(french)
    expect(decodeSubtitleBytes(encodeIn('windows-1252', german), legacyCharsetFor('en'))).toBe(german)
    expect(decodeSubtitleBytes(encodeIn('windows-1250', polish), legacyCharsetFor('pl'))).toBe(polish)
  })

  it('needs more than a few bytes to change the code page', () => {
    const cafe = "un café, s'il vous plaît"
    expect(decodeSubtitleBytes(encodeIn('windows-1252', cafe), legacyCharsetFor('en'))).toBe(cafe)
  })

  it('reads an old Arabic file with the Arabic code page', () => {
    expect(decodeSubtitleBytes(encodeIn(legacyCharsetFor('ar'), arabic), legacyCharsetFor('ar'))).toBe(arabic)
  })

  it('names the code page from the language', () => {
    expect(legacyCharsetFor('he')).toBe('windows-1255')
    expect(legacyCharsetFor('iw')).toBe('windows-1255')
    expect(legacyCharsetFor('ar')).toBe('windows-1256')
    expect(legacyCharsetFor('ru')).toBe('windows-1251')
    expect(legacyCharsetFor('en')).toBe('windows-1252')
    expect(legacyCharsetFor('')).toBe('windows-1252')
  })

  it('gives empty text for an empty file', () => {
    expect(decodeSubtitleBytes(new Uint8Array(0), latin1)).toBe('')
  })
})

describe('the captions a subtitle file gives a recording', () => {
  it('takes the file’s times as the recording’s own', () => {
    let n = 0
    const parse = { cues: [{ startMs: 1_000, endMs: 2_000, text: 'A' }, { startMs: 3_000, endMs: 4_000, text: 'B' }], skipped: 1 }
    const { items, unusable } = captionsFor('s1', 10_000, parse, () => `t${n++}`)
    expect(items.map((i) => i.id)).toEqual(['t0', 't1'])
    expect(items[0]?.placement).toEqual({ type: 'onSource', sourceId: 's1', startMs: 1_000, endMs: 2_000 })
    expect(unusable).toBe(1)
  })

  it('drops a cue after the end of the recording and cuts one that runs past it', () => {
    const parse = {
      cues: [{ startMs: 9_000, endMs: 12_000, text: 'Cut' }, { startMs: 10_000, endMs: 11_000, text: 'Gone' }, { startMs: 10_500, endMs: 11_000, text: 'Gone too' }],
      skipped: 0,
    }
    const { items, unusable } = captionsFor('s1', 10_000, parse)
    expect(items).toHaveLength(1)
    expect(items[0]?.placement).toEqual({ type: 'onSource', sourceId: 's1', startMs: 9_000, endMs: 10_000 })
    expect(unusable).toBe(2)
  })

  it('reads a real subtitle text through to captions', () => {
    const { items } = captionsFor('s1', 5_000, parseSrt('1\n00:00:01,000 --> 00:00:02,000\nשלום\n'))
    expect(items[0]?.text).toBe('שלום')
  })
})

describe('the lanes of the bars of a row', () => {
  const lanes = (...bars: [number, number][]): number[] => lanesOf(bars, (b) => b[0], (b) => b[1])

  it('puts bars that do not overlap in the first lane', () => {
    expect(lanes([0, 1_000], [1_000, 2_000], [3_000, 4_000])).toEqual([0, 0, 0])
  })

  it('puts a bar over another in the second lane', () => {
    expect(lanes([0, 4_000], [500, 5_500])).toEqual([0, 1])
  })

  it('frees a lane again once its bar ends', () => {
    expect(lanes([0, 4_000], [500, 1_500], [1_500, 2_500], [4_000, 5_000])).toEqual([0, 1, 1, 0])
  })

  it('shares the lane that frees up first when there are more bars than lanes', () => {
    expect(lanes([0, 9_000], [100, 2_000], [200, 3_000])).toEqual([0, 1, 1])
  })

  it('places bars by their start whatever the order given', () => {
    expect(lanes([5_000, 9_000], [0, 6_000], [6_000, 8_000])).toEqual([1, 0, 0])
  })

  it('needs no lanes for no bars', () => {
    expect(lanes()).toEqual([])
  })
})
