/** An id that a project file may hold: letters, digits, underscore and hyphen, at most 64 characters. */
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

export function isValidId(id: string): boolean {
  return ID_PATTERN.test(id)
}

/**
 * A path inside the project's own storage: not empty, at most 256 characters, relative, with no backslash or NUL and no
 * empty, dot or dot-dot segment, so a stored path can never reach outside the project.
 */
export function isSafeRelativePath(path: string): boolean {
  if (path.length === 0 || path.length > 256 || path.startsWith('/') || path.includes('\\') || path.includes('\u0000')) {
    return false
  }
  return path.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..')
}

export function randomId(prefix: string): string {
  return prefix + globalThis.crypto.randomUUID().replaceAll('-', '').slice(0, 16)
}

export const randomClipId = (): string => randomId('c')
export const randomTextId = (): string => randomId('t')
export const randomAudioId = (): string => randomId('a')
