/** Why an export did not produce a video. */
export type ExportFailure =
  /** The edit is empty. */
  | 'NothingToExport'
  /** A recording of the project is not in the browser's storage any more. */
  | 'SourceMissing'
  /** A piece of music or a voiceover of the project is not in the browser's storage any more. */
  | 'AudioMissing'
  /** There is not enough free storage for the export. */
  | 'NoSpace'
  /** This browser cannot make video of the chosen size, in any format that the site writes. */
  | 'EncoderFailed'
  /** This browser could not read a recording or a sound of the project. */
  | 'DecoderFailed'
  /** Anything else. */
  | 'Failed'

export class ExportError extends Error {
  constructor(
    readonly failure: ExportFailure,
    options?: { cause?: unknown },
  ) {
    super(failure, options)
  }
}

/** What an error that came out of the export means for the person using the site. */
export function failureOf(error: unknown): ExportFailure {
  if (error instanceof ExportError) return error.failure
  if (error instanceof DOMException) {
    if (error.name === 'QuotaExceededError') return 'NoSpace'
    if (error.name === 'EncodingError' || error.name === 'NotSupportedError') return 'EncoderFailed'
    if (error.name === 'NotFoundError' || error.name === 'NotReadableError') return 'SourceMissing'
  }
  return 'Failed'
}

export const isCancelled = (error: unknown): boolean => error instanceof DOMException && error.name === 'AbortError'
