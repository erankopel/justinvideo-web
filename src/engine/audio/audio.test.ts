import { describe, expect, it } from 'vitest'
import {
  AUDIO_STEP_MS,
  type AudioItem,
  type AudioMix,
  type AudioOp,
  type AudioResult,
  audioItem,
  audioMix,
  changeMix,
  clipGain,
  EMPTY_MIX,
  fadeInBy,
  fadeOutBy,
  GainEnvelope,
  itemEnvelope,
  MAX_AUDIO_ITEMS,
  MAX_FADE_MS,
  MAX_TIMELINE_MS,
  masterEnvelope,
  MIN_PLAYED_MS,
  mixIsEmpty,
  mixItem,
  movedBy,
  playedLengthWithin,
  resizedBy,
  skippedBy,
  steppedFade,
  validateMix,
  withVolume,
} from '../index'

interface Overrides {
  id?: string
  startMs?: number
  lengthMs?: number
  trimStartMs?: number
  fileDurationMs?: number
  volumePercent?: number
  fadeInMs?: number
  fadeOutMs?: number
  file?: string
}

function item(o: Overrides = {}): AudioItem {
  const id = o.id ?? 'a1'
  return audioItem({
    id,
    kind: 'music',
    file: o.file ?? `media/${id}.m4a`,
    displayName: `${id}.m4a`,
    fileDurationMs: o.fileDurationMs ?? 60_000,
    startMs: o.startMs ?? 0,
    lengthMs: o.lengthMs ?? 5_000,
    trimStartMs: o.trimStartMs ?? 0,
    volumePercent: o.volumePercent ?? 100,
    fadeInMs: o.fadeInMs ?? 0,
    fadeOutMs: o.fadeOutMs ?? 0,
  })
}

const changed = (result: AudioResult): AudioMix => {
  if (result.kind !== 'changed') throw new Error(`Expected a change, got ${JSON.stringify(result)}`)
  return result.mix
}
const add = (mix: AudioMix, piece: AudioItem): AudioResult => changeMix(mix, { type: 'add', item: piece })

describe('the mix of music and voiceover', () => {
  it('is valid and empty when nothing is in it', () => {
    expect(validateMix(EMPTY_MIX)).toBeNull()
    expect(mixIsEmpty(EMPTY_MIX)).toBe(true)
    expect(mixIsEmpty(audioMix([], 500))).toBe(false)
  })

  it('changes the items by adding, replacing and removing', () => {
    let mix = changed(add(EMPTY_MIX, item({ id: 'a1' })))
    mix = changed(add(mix, item({ id: 'a2', startMs: 1_000 })))
    expect(mix.items.map((i) => i.id)).toEqual(['a1', 'a2'])
    mix = changed(changeMix(mix, { type: 'replace', item: item({ id: 'a1', volumePercent: 40 }) }))
    expect(mixItem(mix, 'a1')?.volumePercent).toBe(40)
    mix = changed(changeMix(mix, { type: 'remove', id: 'a1' }))
    expect(mix.items.map((i) => i.id)).toEqual(['a2'])
  })

  it('sets the master fades', () => {
    const mix = changed(changeMix(EMPTY_MIX, { type: 'setMasterFades', fadeInMs: 1_000, fadeOutMs: 2_000 }))
    expect(mix.masterFadeInMs).toBe(1_000)
    expect(mix.masterFadeOutMs).toBe(2_000)
  })

  it('reports a change that changes nothing as unchanged', () => {
    const mix = audioMix([item({ id: 'a1' })], 500, 0)
    expect(changeMix(mix, { type: 'replace', item: item({ id: 'a1' }) })).toEqual({ kind: 'unchanged' })
    expect(changeMix(mix, { type: 'setMasterFades', fadeInMs: 500, fadeOutMs: 0 })).toEqual({ kind: 'unchanged' })
  })

  it('rejects an unknown piece', () => {
    expect(changeMix(EMPTY_MIX, { type: 'remove', id: 'nope' })).toEqual({ kind: 'rejected', error: 'UnknownItem' })
    expect(changeMix(EMPTY_MIX, { type: 'replace', item: item({ id: 'nope' }) })).toEqual({ kind: 'rejected', error: 'UnknownItem' })
  })

  it('rejects a repeated id', () => {
    expect(add(audioMix([item({ id: 'a1' })]), item({ id: 'a1', startMs: 9_000 }))).toEqual({ kind: 'rejected', error: 'Invalid' })
  })

  it('keeps the rules of a piece', () => {
    const rejected = (piece: AudioItem): void => {
      expect(add(EMPTY_MIX, piece), JSON.stringify(piece)).toEqual({ kind: 'rejected', error: 'Invalid' })
    }
    rejected(item({ startMs: -1 }))
    rejected(item({ lengthMs: 99 }))
    rejected(item({ trimStartMs: 58_000, lengthMs: 5_000 }))
    rejected(item({ volumePercent: 201 }))
    rejected(item({ volumePercent: -1 }))
    rejected(item({ fadeInMs: 3_000, fadeOutMs: 3_000, lengthMs: 5_000 }))
    rejected(item({ fadeInMs: 10_001, lengthMs: 20_000 }))
    rejected(item({ file: '../outside.m4a' }))
    rejected(item({ file: '/etc/passwd' }))
    rejected(item({ id: 'bad id' }))
  })

  it('allows the limits at their edges', () => {
    expect(changed(add(EMPTY_MIX, item({ volumePercent: 200, lengthMs: 100 })))).toBeDefined()
    expect(changed(add(EMPTY_MIX, item({ volumePercent: 0, fadeInMs: 2_500, fadeOutMs: 2_500, lengthMs: 5_000 })))).toBeDefined()
    expect(changed(add(EMPTY_MIX, item({ trimStartMs: 55_000, lengthMs: 5_000 })))).toBeDefined()
  })

  it('keeps the master fades between zero and ten seconds', () => {
    const fades = (fadeInMs: number, fadeOutMs: number): AudioOp => ({ type: 'setMasterFades', fadeInMs, fadeOutMs })
    expect(changeMix(EMPTY_MIX, fades(-1, 0))).toEqual({ kind: 'rejected', error: 'Invalid' })
    expect(changeMix(EMPTY_MIX, fades(0, 10_001))).toEqual({ kind: 'rejected', error: 'Invalid' })
    expect(changed(changeMix(EMPTY_MIX, fades(10_000, 10_000)))).toBeDefined()
  })

  it('holds at most twenty pieces', () => {
    let mix = EMPTY_MIX
    for (let i = 0; i < MAX_AUDIO_ITEMS; i++) mix = changed(add(mix, item({ id: `a${i}` })))
    expect(add(mix, item({ id: 'extra' }))).toEqual({ kind: 'rejected', error: 'Invalid' })
  })
})

describe('the buttons that time a piece of music', () => {
  const piece = (o: Overrides = {}): AudioItem =>
    item({ startMs: 2_000, lengthMs: 6_000, trimStartMs: 1_000, fileDurationMs: 20_000, ...o })

  it('keeps the length when moving and stops at the start of the edit', () => {
    expect(movedBy(piece(), AUDIO_STEP_MS).startMs).toBe(2_500)
    expect(movedBy(piece(), -AUDIO_STEP_MS).startMs).toBe(1_500)
    expect(movedBy(piece({ startMs: 200 }), -AUDIO_STEP_MS).startMs).toBe(0)
    expect(movedBy(piece(), -AUDIO_STEP_MS).lengthMs).toBe(6_000)
  })

  it('stops moving at the longest edit', () => {
    const late = movedBy(piece({ startMs: MAX_TIMELINE_MS - 6_000 }), AUDIO_STEP_MS)
    expect(late.startMs).toBe(MAX_TIMELINE_MS - 6_000)
  })

  it('resizes within what is left of the file', () => {
    expect(resizedBy(piece(), AUDIO_STEP_MS).lengthMs).toBe(6_500)
    expect(resizedBy(piece(), -AUDIO_STEP_MS).lengthMs).toBe(5_500)
    // 20 s file, starts at 1 s in: 19 s are left.
    expect(resizedBy(piece(), 60_000).lengthMs).toBe(19_000)
    expect(resizedBy(piece(), -60_000).lengthMs).toBe(MIN_PLAYED_MS)
  })

  it('pulls the fades inside the piece when shortening', () => {
    const shorter = resizedBy(piece({ lengthMs: 3_000, fadeInMs: 2_000, fadeOutMs: 1_000 }), -2_000)
    expect(shorter.lengthMs).toBe(1_000)
    expect(shorter.fadeOutMs).toBe(1_000)
    expect(shorter.fadeInMs).toBe(0)
  })

  it('keeps the length when skipping into the file', () => {
    expect(skippedBy(piece(), AUDIO_STEP_MS).trimStartMs).toBe(1_500)
    expect(skippedBy(piece(), AUDIO_STEP_MS).lengthMs).toBe(6_000)
    expect(skippedBy(piece({ trimStartMs: 200 }), -AUDIO_STEP_MS).trimStartMs).toBe(0)
    // 20 s file, 6 s played: the start can go as far as 14 s.
    expect(skippedBy(piece(), 60_000).trimStartMs).toBe(14_000)
  })

  it('grows the fades in steps and never past the length or each other', () => {
    expect(fadeInBy(piece(), AUDIO_STEP_MS).fadeInMs).toBe(500)
    expect(fadeInBy(piece(), -AUDIO_STEP_MS).fadeInMs).toBe(0)
    expect(fadeInBy(piece(), 60_000).fadeInMs).toBe(6_000)
    expect(fadeInBy(piece({ lengthMs: 19_000 }), 60_000).fadeInMs).toBe(MAX_FADE_MS)
    const boxed = fadeInBy(piece({ lengthMs: 3_000, fadeOutMs: 2_000 }), 60_000)
    expect(boxed.fadeInMs).toBe(1_000)
    expect(fadeOutBy(piece({ lengthMs: 3_000, fadeInMs: 2_500 }), 60_000).fadeOutMs).toBe(500)
  })

  it('keeps the two fades together within the piece', () => {
    const result = fadeOutBy(fadeInBy(piece({ lengthMs: 3_000 }), 2_000), 2_000)
    expect(result.fadeInMs).toBe(2_000)
    expect(result.fadeOutMs).toBe(1_000)
  })

  it('keeps the volume between silence and twice full', () => {
    expect(withVolume(piece(), -5).volumePercent).toBe(0)
    expect(withVolume(piece(), 500).volumePercent).toBe(200)
    expect(withVolume(piece(), 75).volumePercent).toBe(75)
  })

  it('steps a master fade between zero and ten seconds', () => {
    expect(steppedFade(0, AUDIO_STEP_MS)).toBe(500)
    expect(steppedFade(0, -AUDIO_STEP_MS)).toBe(0)
    expect(steppedFade(MAX_FADE_MS, AUDIO_STEP_MS)).toBe(MAX_FADE_MS)
  })

  it('makes every result of the buttons a valid piece', () => {
    let current = piece({ fadeInMs: 1_000, fadeOutMs: 1_000 })
    const buttons: ((p: AudioItem) => AudioItem)[] = [
      (p) => movedBy(p, AUDIO_STEP_MS), (p) => movedBy(p, -AUDIO_STEP_MS),
      (p) => resizedBy(p, AUDIO_STEP_MS), (p) => resizedBy(p, -AUDIO_STEP_MS),
      (p) => skippedBy(p, AUDIO_STEP_MS), (p) => skippedBy(p, -AUDIO_STEP_MS),
      (p) => fadeInBy(p, AUDIO_STEP_MS), (p) => fadeOutBy(p, AUDIO_STEP_MS),
      (p) => fadeInBy(p, -AUDIO_STEP_MS), (p) => fadeOutBy(p, -AUDIO_STEP_MS),
    ]
    for (let round = 0; round < 200; round++) {
      const button = buttons[(round * 7 + Math.floor(round / 3)) % buttons.length]
      if (!button) throw new Error('no button')
      current = button(current)
      expect(validateMix(audioMix([current])), `Round ${round} broke a rule`).toBeNull()
    }
  })
})

describe('the gain over time', () => {
  const close = (actual: number, expected: number): void => expect(actual).toBeCloseTo(expected, 6)

  it('does not change for a steady gain', () => {
    const envelope = new GainEnvelope(0.5)
    expect(envelope.isConstant).toBe(true)
    expect(envelope.atMs(0)).toBe(0.5)
    expect(envelope.atMs(90_000)).toBe(0.5)
  })

  it('leaves the sound as it is only for a gain of one without fades', () => {
    expect(new GainEnvelope(1).isUnity).toBe(true)
    expect(new GainEnvelope(0.9).isUnity).toBe(false)
    expect(new GainEnvelope(1, 10).isUnity).toBe(false)
  })

  it('rises in a straight line for a fade in', () => {
    const envelope = new GainEnvelope(1, 2_000)
    close(envelope.atMs(0), 0)
    close(envelope.atMs(500), 0.25)
    close(envelope.atMs(1_000), 0.5)
    close(envelope.atMs(2_000), 1)
    close(envelope.atMs(9_000), 1)
  })

  it('falls to silence at the end of the length for a fade out', () => {
    const envelope = new GainEnvelope(1, 0, 1_000, 5_000)
    close(envelope.atMs(4_000), 1)
    close(envelope.atMs(4_500), 0.5)
    close(envelope.atMs(5_000), 0)
    close(envelope.atMs(6_000), 0)
  })

  it('scales the steady gain with the fades', () => {
    const envelope = new GainEnvelope(0.5, 1_000, 1_000, 10_000)
    close(envelope.atMs(500), 0.25)
    close(envelope.atMs(5_000), 0.5)
    close(envelope.atMs(9_500), 0.25)
  })

  it('does not apply a fade out to an endless sound', () => {
    expect(new GainEnvelope(1, 0, 1_000).isConstant).toBe(true)
    expect(new GainEnvelope(1, 0, 1_000).atMs(1_000_000)).toBe(1)
  })

  it('gives a piece of music its own envelope', () => {
    const envelope = itemEnvelope(item({ volumePercent: 50, fadeInMs: 1_000, fadeOutMs: 2_000, lengthMs: 8_000 }))
    close(envelope.atMs(0), 0)
    close(envelope.atMs(4_000), 0.5)
    close(envelope.atMs(7_000), 0.25)
  })

  it('fades the whole edit with the master envelope', () => {
    const envelope = masterEnvelope(audioMix([], 1_000, 2_000), 10_000)
    close(envelope.atMs(500), 0.5)
    close(envelope.atMs(5_000), 1)
    close(envelope.atMs(9_000), 0.5)
  })

  it('plays a piece that ends after the edit only until the edit ends', () => {
    const piece = item({ startMs: 4_000, lengthMs: 10_000 })
    expect(playedLengthWithin(piece, 10_000)).toBe(6_000)
    expect(playedLengthWithin(piece, 20_000)).toBe(10_000)
  })

  it('does not play a piece that starts at the end of the edit', () => {
    expect(playedLengthWithin(item({ startMs: 10_000, lengthMs: 3_000 }), 10_000)).toBeNull()
    expect(playedLengthWithin(item({ startMs: 9_950, lengthMs: 3_000 }), 10_000)).toBeNull()
  })

  it('takes a clip gain as the percent as a factor', () => {
    expect(clipGain(100)).toBe(1)
    expect(clipGain(0)).toBe(0)
    close(clipGain(150), 1.5)
  })
})
