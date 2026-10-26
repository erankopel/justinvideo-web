import { describe, expect, it } from 'vitest'
import { TABS, tabAfterKey } from './tabs'

describe('moving between the tabs with the keyboard', () => {
  it('goes to the next tab on the arrow that points that way, and round from the last to the first', () => {
    expect(tabAfterKey('ArrowRight', 0, false)).toBe(1)
    expect(tabAfterKey('ArrowRight', TABS.length - 1, false)).toBe(0)
    expect(tabAfterKey('ArrowLeft', 2, false)).toBe(1)
    expect(tabAfterKey('ArrowLeft', 0, false)).toBe(TABS.length - 1)
  })

  it('has the arrows the other way round in a page that reads from the right', () => {
    expect(tabAfterKey('ArrowLeft', 0, true)).toBe(1)
    expect(tabAfterKey('ArrowRight', 0, true)).toBe(TABS.length - 1)
    expect(tabAfterKey('ArrowRight', 3, true)).toBe(2)
  })

  it('goes to the first and the last tab on Home and End, and leaves every other key alone', () => {
    expect(tabAfterKey('Home', 2, false)).toBe(0)
    expect(tabAfterKey('End', 0, true)).toBe(TABS.length - 1)
    for (const key of ['Enter', ' ', 'a', 'ArrowUp', 'ArrowDown', 'Tab']) expect(tabAfterKey(key, 1, false)).toBe(-1)
  })
})
