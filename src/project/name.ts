/**
 * A name for a new project from the video's file name, without its extension. A file name that is only digits, such as
 * 564.mp4, says nothing, so a name without a single letter is replaced by fallback.
 */
export function projectNameFor(displayName: string, fallback: string): string {
  const dot = displayName.lastIndexOf('.')
  const base = (dot < 0 ? displayName : displayName.slice(0, dot)).trim()
  return /\p{L}/u.test(base) ? base : fallback
}
