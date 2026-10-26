import { randomId } from '../engine'

const EXTENSIONS_BY_TYPE: Readonly<Record<string, string>> = {
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'video/x-matroska': 'mkv',
  'video/3gpp': '3gp',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
  'audio/wav': 'wav',
  'audio/ogg': 'ogg',
  'audio/webm': 'webm',
}

/** The extension to give the copy of a file, from its name or its type, and a safe one whatever the file is called. */
export function extensionFor(file: { name: string; type: string }, fallback = 'mp4'): string {
  const dot = file.name.lastIndexOf('.')
  const fromName = dot >= 0 ? file.name.slice(dot + 1) : ''
  const raw = fromName || EXTENSIONS_BY_TYPE[file.type] || fallback
  return raw.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) || fallback
}

/** A new, unique place for a recording to be copied to, as a path relative to the project's folder. */
export function newMediaPath(extension: string): string {
  const safe = extension.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) || 'mp4'
  return `media/${randomId('').slice(0, 16)}.${safe}`
}
