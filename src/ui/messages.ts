import type { AudioFailure } from '../audio/files'
import type { ImportFailure } from '../import/failure'
import type { ProjectProblem } from '../project/codec'
import type { StringKey } from '../strings'

export const IMPORT_FAILURE_TEXT: Readonly<Record<ImportFailure, StringKey>> = {
  Unreadable: 'importUnreadable',
  NotVideo: 'importNotVideo',
  NoSpace: 'importNoSpace',
  Unusable: 'importUnusable',
  UnsupportedFormat: 'importUnsupportedFormat',
  TooManyRecordings: 'importTooManyRecordings',
  ProjectFull: 'importProjectFull',
}

/** A project that breaks a rule reads as damaged to the person: the detail is for developers. */
export const PROBLEM_TEXT: Readonly<Record<ProjectProblem, StringKey>> = {
  Corrupt: 'unreadableCorrupt',
  Invalid: 'unreadableCorrupt',
  NewerFormat: 'unreadableNewer',
}

export const AUDIO_FAILURE_TEXT: Readonly<Record<AudioFailure, StringKey>> = {
  Unreadable: 'audioUnreadable',
  NotAudio: 'importNotAudio',
  NoSpace: 'audioNoSpace',
  Unusable: 'audioUnusable',
  UnsupportedFormat: 'audioUnsupported',
}
