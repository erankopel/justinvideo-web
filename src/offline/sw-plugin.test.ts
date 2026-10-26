import { describe, expect, it } from 'vitest'
import { addressOf, isLater, serviceWorkerSource } from './sw-plugin'

describe('addressOf', () => {
  it('serves a folder’s index page at the folder, and any other file at its path', () => {
    expect(addressOf('index.html')).toBe('/')
    expect(addressOf('privacy/index.html')).toBe('/privacy/')
    expect(addressOf('licenses/index.html')).toBe('/licenses/')
    expect(addressOf('assets/index-abc123.js')).toBe('/assets/index-abc123.js')
    expect(addressOf('icons/icon-192.png')).toBe('/icons/icon-192.png')
    expect(addressOf('manifest.webmanifest')).toBe('/manifest.webmanifest')
  })
})

describe('isLater', () => {
  it('is for the AAC encoder of the export in each of its copies, and for nothing else', () => {
    expect(isLater('assets/mediabunny-aac-encoder-ChS-pOvF.js')).toBe(true)
    expect(isLater('assets/mediabunny-aac-encoder-Bp_DXDqx.js')).toBe(true)
    expect(isLater('assets/index-abc123.js')).toBe(false)
    expect(isLater('assets/export-worker-uVKcflQx.js')).toBe(false)
    expect(isLater('assets/mediabunny-aac-encoder-ChS-pOvF.js.map')).toBe(false)
  })
})

describe('serviceWorkerSource', () => {
  it('puts the version and every address before the body, as data that the body reads', () => {
    const source = serviceWorkerSource('abc', ['/', '/assets/a.js'], 'self.go()')
    expect(source).toContain('const VERSION = "abc"')
    expect(source).toContain('"/assets/a.js"')
    expect(source.indexOf('const FILES')).toBeLessThan(source.indexOf('self.go()'))
    // It must be a program that runs: the two constants are defined and the body uses them.
    const run = new Function('self', `${source.replace('self.go()', 'return [VERSION, FILES.length, LATER.length]')}`) as (self: unknown) => unknown
    expect(run({})).toEqual(['abc', 2, 0])
  })

  it('says which files wait for their first use', () => {
    const source = serviceWorkerSource('abc', ['/', '/assets/aac.js'], 'self.go()', ['/assets/aac.js'])
    const run = new Function('self', `${source.replace('self.go()', 'return LATER')}`) as (self: unknown) => unknown
    expect(run({})).toEqual(['/assets/aac.js'])
  })
})
