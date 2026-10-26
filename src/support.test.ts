import { describe, expect, it } from 'vitest'
import { missingFeatures, type Scope } from './support'

const complete: Scope = {
  VideoDecoder: function VideoDecoder() {},
  VideoEncoder: function VideoEncoder() {},
  AudioDecoder: function AudioDecoder() {},
  AudioEncoder: function AudioEncoder() {},
  AudioContext: function AudioContext() {},
  Worker: function Worker() {},
  indexedDB: {},
}

describe('missingFeatures', () => {
  it('is empty for a browser that has everything', () => {
    expect(missingFeatures(complete)).toEqual([])
  })

  it('names what is missing', () => {
    expect(missingFeatures({ ...complete, VideoEncoder: undefined })).toEqual(['WebCodecs video encoder'])
    expect(missingFeatures({ ...complete, AudioDecoder: undefined, AudioEncoder: undefined })).toEqual(['WebCodecs audio decoder', 'WebCodecs audio encoder'])
    expect(missingFeatures({ ...complete, indexedDB: undefined, Worker: undefined })).toEqual(['Web Workers', 'IndexedDB'])
  })

  it('takes an offline audio context for Web Audio, and lists everything for a bare scope', () => {
    expect(missingFeatures({ ...complete, AudioContext: undefined, OfflineAudioContext: function OfflineAudioContext() {} })).toEqual([])
    expect(missingFeatures({})).toHaveLength(7)
  })
})
