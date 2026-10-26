import { describe, expect, it } from 'vitest'
import { hrefOf, parseRoute } from './route'

describe('the address of a page', () => {
  it('opens a project from its id', () => {
    expect(parseRoute('#/p/p0123abc')).toEqual({ name: 'project', id: 'p0123abc' })
    expect(hrefOf({ name: 'project', id: 'p1' })).toBe('#/p/p1')
  })

  it('shows the list for anything else, including an id that is not safe', () => {
    for (const hash of ['', '#', '#/', '#/p/', '#/p/../x', '#/p/a b', '#/other']) expect(parseRoute(hash), hash).toEqual({ name: 'home' })
    expect(hrefOf({ name: 'home' })).toBe('#/')
  })
})
