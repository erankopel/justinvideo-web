/** The sets of buttons that a narrow screen shows one at a time. A wide one shows them all. */
export const TABS = ['edit', 'trim', 'text', 'sound'] as const
export type Tab = (typeof TABS)[number]

/**
 * The tab that a key moves to from the one at index, or -1 where the key does not move between tabs. The arrows follow the
 * direction of the page, and go round from the last tab to the first and back.
 */
export function tabAfterKey(key: string, index: number, rightToLeft: boolean): number {
  const last = TABS.length - 1
  const next = rightToLeft ? 'ArrowLeft' : 'ArrowRight'
  const previous = rightToLeft ? 'ArrowRight' : 'ArrowLeft'
  if (key === next) return index >= last ? 0 : index + 1
  if (key === previous) return index <= 0 ? last : index - 1
  if (key === 'Home') return 0
  if (key === 'End') return last
  return -1
}
