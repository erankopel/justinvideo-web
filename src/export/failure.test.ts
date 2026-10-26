import { describe, expect, it } from 'vitest'
import { ExportError, failureOf, isCancelled } from './failure'

describe('failureOf', () => {
  it('keeps what the export itself said', () => {
    expect(failureOf(new ExportError('AudioMissing'))).toBe('AudioMissing')
    expect(failureOf(new ExportError('DecoderFailed'))).toBe('DecoderFailed')
  })

  it('reads what the browser said', () => {
    expect(failureOf(new DOMException('full', 'QuotaExceededError'))).toBe('NoSpace')
    expect(failureOf(new DOMException('bad', 'EncodingError'))).toBe('EncoderFailed')
    expect(failureOf(new DOMException('no', 'NotSupportedError'))).toBe('EncoderFailed')
    expect(failureOf(new DOMException('gone', 'NotFoundError'))).toBe('SourceMissing')
  })

  it('calls anything else a failure', () => {
    expect(failureOf(new Error('what'))).toBe('Failed')
    expect(failureOf('text')).toBe('Failed')
  })
})

describe('isCancelled', () => {
  it('is true only for an abort', () => {
    expect(isCancelled(new DOMException('stop', 'AbortError'))).toBe(true)
    expect(isCancelled(new Error('stop'))).toBe(false)
    expect(isCancelled(new ExportError('Failed'))).toBe(false)
  })
})
