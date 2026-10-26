export type ImportFailure =
  /** The file could not be opened or read. */
  | 'Unreadable'
  /** The file opened but holds no video. */
  | 'NotVideo'
  /** There is not enough free storage to keep a copy. */
  | 'NoSpace'
  /** The video is empty or longer than the site accepts. */
  | 'Unusable'
  /** The video is in a form that this browser cannot decode, such as H.264 where the browser lacks it. */
  | 'UnsupportedFormat'
  /** The project already holds as many recordings as it may. */
  | 'TooManyRecordings'
  /** Adding the video would make the project longer than 24 hours or give it more than 500 clips. */
  | 'ProjectFull'

export class ImportError extends Error {
  constructor(
    readonly failure: ImportFailure,
    options?: { cause?: unknown },
  ) {
    super(failure, options)
  }
}
