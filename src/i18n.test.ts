import { describe, expect, it } from 'vitest'
import { fill, formatBytes, formatClock, formatTimecode, isRightToLeft, LANGUAGES, pickLanguage } from './i18n'
import { STRINGS, type StringKey } from './strings'

describe('the language of the site', () => {
  it('takes the first preferred language the site has', () => {
    expect(pickLanguage(['fr-FR', 'he-IL', 'en'])).toBe('he')
    expect(pickLanguage(['ar-EG'])).toBe('ar')
    expect(pickLanguage(['EN-us'])).toBe('en')
  })

  it('knows the old code for Hebrew', () => {
    expect(pickLanguage(['iw'])).toBe('he')
  })

  it('falls back to English', () => {
    expect(pickLanguage([])).toBe('en')
    expect(pickLanguage(['de', 'ja'])).toBe('en')
  })

  it('reads Hebrew and Arabic right to left', () => {
    expect(LANGUAGES.map(isRightToLeft)).toEqual([false, true, true])
  })
})

describe('the texts', () => {
  const keys = Object.keys(STRINGS.en) as StringKey[]
  const placesOf = (text: string): string[] => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? '').sort()

  it('has every text in every language, none empty', () => {
    for (const language of LANGUAGES) {
      expect(Object.keys(STRINGS[language]).sort(), language).toEqual([...keys].sort())
      for (const key of keys) expect(STRINGS[language][key].trim(), `${language} ${key}`).not.toBe('')
    }
  })

  it('has the same places to fill in every language', () => {
    for (const language of LANGUAGES) {
      for (const key of keys) expect(placesOf(STRINGS[language][key]), `${language} ${key}`).toEqual(placesOf(STRINGS.en[key]))
    }
  })

  it('fills places and leaves an unknown one showing', () => {
    expect(fill('Clips: {n} of {total}', { n: 3 })).toBe('Clips: 3 of {total}')
    expect(fill('No places')).toBe('No places')
  })
})

describe('numbers', () => {
  it('writes times as m:ss and h:mm:ss with plain digits', () => {
    expect(formatClock(0)).toBe('0:00')
    expect(formatClock(5_999)).toBe('0:05')
    expect(formatClock(65_000)).toBe('1:05')
    expect(formatClock(3_600_000)).toBe('1:00:00')
    expect(formatClock(24 * 3_600_000)).toBe('24:00:00')
    expect(formatClock(-5)).toBe('0:00')
  })

  it('writes a position as hours, minutes, seconds and frames', () => {
    expect(formatTimecode(0, 30)).toBe('00:00:00:00')
    expect(formatTimecode(1_000, 30)).toBe('00:00:01:00')
    expect(formatTimecode(1_500, 30)).toBe('00:00:01:15')
    expect(formatTimecode(3_661_000, 25)).toBe('01:01:01:00')
    // Just under a second rounds to the next second, never to frame 30 of 30.
    expect(formatTimecode(999, 30)).toBe('00:00:01:00')
    expect(formatTimecode(-5, 30)).toBe('00:00:00:00')
  })

  it('writes sizes in the unit that suits them', () => {
    expect(formatBytes(500, 'en')).toMatch(/500/)
    expect(formatBytes(5 * 1024 * 1024, 'en')).toMatch(/5.*MB/)
    expect(formatBytes(3 * 1024 ** 3, 'en')).toMatch(/3.*GB/)
  })
})
