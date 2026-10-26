export const LANGUAGES = ['en', 'he', 'ar'] as const
export type Language = (typeof LANGUAGES)[number]

const RIGHT_TO_LEFT: ReadonlySet<Language> = new Set<Language>(['he', 'ar'])

export const isRightToLeft = (language: Language): boolean => RIGHT_TO_LEFT.has(language)

/** The first of the browser's preferred languages that the site has, English when none matches. Hebrew's old code iw counts. */
export function pickLanguage(preferred: readonly string[]): Language {
  for (const tag of preferred) {
    const base = tag.toLowerCase().split('-')[0]
    const normal = base === 'iw' ? 'he' : base
    const match = LANGUAGES.find((language) => language === normal)
    if (match) return match
  }
  return 'en'
}

/** Fills {name} places in a text. A place with no value is left as it is, so a mistake shows. */
export function fill(template: string, values: Readonly<Record<string, string | number>> = {}): string {
  return template.replace(/\{(\w+)\}/g, (place, name: string) => (name in values ? String(values[name]) : place))
}

/** A time as m:ss, or h:mm:ss from an hour on. Digits are plain so that it reads the same in every language. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const seconds = total % 60
  const minutes = Math.floor(total / 60) % 60
  const hours = Math.floor(total / 3600)
  const two = (n: number): string => String(n).padStart(2, '0')
  return hours > 0 ? `${hours}:${two(minutes)}:${two(seconds)}` : `${minutes}:${two(seconds)}`
}

/** A position as HH:MM:SS:FF for a whole frame rate, rounded to the nearest frame, so a time just under a second never shows a frame number equal to the frame rate. */
export function formatTimecode(ms: number, fps: number): string {
  const totalFrames = Math.round((Math.max(0, ms) / 1000) * fps)
  const frame = totalFrames % fps
  const totalSeconds = Math.floor(totalFrames / fps)
  const two = (n: number): string => String(n).padStart(2, '0')
  return `${two(Math.floor(totalSeconds / 3600))}:${two(Math.floor(totalSeconds / 60) % 60)}:${two(totalSeconds % 60)}:${two(frame)}`
}

/** A size in bytes in the unit that suits it, written the way the language writes it. */
export function formatBytes(bytes: number, language: Language): string {
  const units: [number, string][] = [[1024 ** 3, 'gigabyte'], [1024 ** 2, 'megabyte'], [1024, 'kilobyte']]
  const [size, unit] = units.find(([least]) => bytes >= least) ?? [1, 'byte']
  return new Intl.NumberFormat(language, { style: 'unit', unit, unitDisplay: 'short', maximumFractionDigits: size >= 1024 ** 3 ? 1 : 0 }).format(bytes / size)
}

// Unicode isolates keep a piece that is inserted into a sentence from reordering the words around it.
const LEFT_TO_RIGHT_ISOLATE = String.fromCodePoint(0x2066)
const FIRST_STRONG_ISOLATE = String.fromCodePoint(0x2068)
const POP_ISOLATE = String.fromCodePoint(0x2069)

/** A time or number to put inside a sentence of either direction: it always reads left to right, in place. */
export const isolateLtr = (text: string): string => LEFT_TO_RIGHT_ISOLATE + text + POP_ISOLATE

/** A name that a person typed or a file carries, which may read either way, to put inside a sentence. */
export const isolateName = (text: string): string => FIRST_STRONG_ISOLATE + text + POP_ISOLATE
