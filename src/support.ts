/** The parts of the browser that the editor cannot work without, and what to look for to know that each is there. */
const REQUIRED: readonly (readonly [string, (scope: Scope) => boolean])[] = [
  ['WebCodecs video decoder', (scope) => typeof scope.VideoDecoder === 'function'],
  ['WebCodecs video encoder', (scope) => typeof scope.VideoEncoder === 'function'],
  ['WebCodecs audio decoder', (scope) => typeof scope.AudioDecoder === 'function'],
  ['WebCodecs audio encoder', (scope) => typeof scope.AudioEncoder === 'function'],
  ['Web Audio', (scope) => typeof scope.AudioContext === 'function' || typeof scope.OfflineAudioContext === 'function'],
  ['Web Workers', (scope) => typeof scope.Worker === 'function'],
  ['IndexedDB', (scope) => scope.indexedDB !== undefined],
]

/** The pieces of the browser that the site looks at: a window, or a stand-in for one. */
export interface Scope {
  readonly VideoDecoder?: unknown
  readonly VideoEncoder?: unknown
  readonly AudioDecoder?: unknown
  readonly AudioEncoder?: unknown
  readonly AudioContext?: unknown
  readonly OfflineAudioContext?: unknown
  readonly Worker?: unknown
  readonly indexedDB?: unknown
}

/** What this browser lacks of what the editor needs, by name. Empty when it has it all. */
export function missingFeatures(scope: Scope = globalThis as unknown as Scope): string[] {
  return REQUIRED.filter(([, present]) => !present(scope)).map(([name]) => name)
}
