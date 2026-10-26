import type { StringKey } from '../strings'

/** The line under the editor that says what came of the last thing the person did, for a few seconds. */
export interface Notice {
  key: StringKey
  values?: Record<string, string | number>
  /** Good news, not a refusal: shown in the quiet colour. */
  ok?: boolean
}
