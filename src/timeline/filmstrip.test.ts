import { describe, expect, it, vi } from 'vitest'
import { type FrameReader, Filmstrip, type OpenReader, type Picture } from './filmstrip'

const picture = (label: string): Picture => ({ label }) as unknown as Picture

/** Lets every promise that is ready run, and the timers of zero length. */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

interface Fake {
  readonly open: OpenReader
  readonly opened: string[]
  readonly closed: string[]
  readonly read: string[]
}

/** Readers whose frames are made at once, from the moment asked for, unless a time is listed as failing or empty. */
function fake(options: { fail?: (sourceId: string, timeMs: number) => boolean; empty?: (timeMs: number) => boolean; refuse?: string } = {}): Fake {
  const opened: string[] = []
  const closed: string[] = []
  const read: string[] = []
  const open: OpenReader = async (sourceId) => {
    if (options.refuse === sourceId) throw new Error('refused')
    opened.push(sourceId)
    const reader: FrameReader = {
      frameAt: async (timeMs) => {
        read.push(`${sourceId}@${timeMs}`)
        if (options.fail?.(sourceId, timeMs)) throw new Error('cannot decode')
        return options.empty?.(timeMs) ? null : picture(`${sourceId}@${timeMs}`)
      },
      close: () => closed.push(sourceId),
    }
    return reader
  }
  return { open, opened, closed, read }
}

describe('Filmstrip', () => {
  it('reads the frames that are wanted, once each, and keeps them', async () => {
    const readers = fake()
    const film = new Filmstrip(readers.open, { lingerMs: 1_000_000 })
    const changed = vi.fn()
    film.subscribe(changed)
    film.want([
      { sourceId: 'a', timeMs: 100 },
      { sourceId: 'a', timeMs: 900 },
      { sourceId: 'a', timeMs: 100 },
    ])
    await settle()
    expect(readers.read).toEqual(['a@100', 'a@900'])
    expect(film.get('a', 100)).toEqual({ label: 'a@100' })
    expect(film.get('a', 900)).toEqual({ label: 'a@900' })
    expect(film.get('a', 500)).toBeUndefined()
    expect(changed).toHaveBeenCalledTimes(2)
    expect(film.revision).toBe(2)
    // Asked for again, they are not read again; one recording is opened once.
    film.want([{ sourceId: 'a', timeMs: 100 }, { sourceId: 'a', timeMs: 900 }])
    await settle()
    expect(readers.read).toHaveLength(2)
    expect(readers.opened).toEqual(['a'])
    film.dispose()
  })

  it('reads in the order of the list, and lets go of what a later call no longer wants', async () => {
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => (release = resolve))
    const read: number[] = []
    const film = new Filmstrip(
      async () => ({
        frameAt: async (timeMs) => {
          read.push(timeMs)
          if (timeMs === 1) await gate
          return picture(String(timeMs))
        },
        close: () => undefined,
      }),
      { lingerMs: 1_000_000 },
    )
    film.want([1, 2, 3].map((timeMs) => ({ sourceId: 'a', timeMs })))
    await settle()
    // The first is being read; the view has moved on, and now wants 7 and 8, and 3 again.
    film.want([7, 8, 3].map((timeMs) => ({ sourceId: 'a', timeMs })))
    release()
    await settle()
    expect(read).toEqual([1, 7, 8, 3])
    expect(film.get('a', 2)).toBeUndefined()
    expect(film.get('a', 1)).toBeDefined()
    film.dispose()
  })

  it('keeps the most recently used frames when there are too many', async () => {
    const film = new Filmstrip(fake().open, { capacity: 3, lingerMs: 1_000_000 })
    film.want([1, 2, 3].map((timeMs) => ({ sourceId: 'a', timeMs })))
    await settle()
    film.get('a', 1)
    film.want([{ sourceId: 'a', timeMs: 4 }])
    await settle()
    expect(film.get('a', 2)).toBeUndefined()
    expect(film.get('a', 1)).toBeDefined()
    expect(film.get('a', 3)).toBeDefined()
    expect(film.get('a', 4)).toBeDefined()
    film.dispose()
  })

  it('offers the nearest kept frame of the same recording as a stand-in', async () => {
    const film = new Filmstrip(fake().open, { lingerMs: 1_000_000 })
    film.want([
      { sourceId: 'a', timeMs: 1_000 },
      { sourceId: 'a', timeMs: 2_000 },
      { sourceId: 'b', timeMs: 1_500 },
    ])
    await settle()
    expect(film.nearest('a', 1_400, 500)).toEqual({ label: 'a@1000' })
    expect(film.nearest('a', 1_600, 500)).toEqual({ label: 'a@2000' })
    expect(film.nearest('a', 1_500, 100)).toBeUndefined()
    expect(film.nearest('c', 1_500, 5_000)).toBeUndefined()
    film.dispose()
  })

  it('does not ask again for a moment that has no frame', async () => {
    const readers = fake({ empty: (timeMs) => timeMs === 0 })
    const film = new Filmstrip(readers.open, { lingerMs: 1_000_000 })
    film.want([{ sourceId: 'a', timeMs: 0 }, { sourceId: 'a', timeMs: 100 }])
    await settle()
    film.want([{ sourceId: 'a', timeMs: 0 }, { sourceId: 'a', timeMs: 100 }])
    await settle()
    expect(readers.read).toEqual(['a@0', 'a@100'])
    film.dispose()
  })

  it('leaves a recording that cannot be opened without pictures, and carries on with the others', async () => {
    const readers = fake({ refuse: 'a' })
    const film = new Filmstrip(readers.open, { lingerMs: 1_000_000 })
    film.want([{ sourceId: 'a', timeMs: 100 }, { sourceId: 'b', timeMs: 100 }])
    await settle()
    expect(film.get('a', 100)).toBeUndefined()
    expect(film.get('b', 100)).toBeDefined()
    film.want([{ sourceId: 'a', timeMs: 200 }])
    await settle()
    expect(readers.read).toEqual(['b@100'])
    film.dispose()
  })

  it('gives up on a recording after frames in a row that cannot be decoded, and closes it', async () => {
    const readers = fake({ fail: (_, timeMs) => timeMs < 400 })
    const film = new Filmstrip(readers.open, { lingerMs: 1_000_000 })
    film.want([100, 200, 300, 500].map((timeMs) => ({ sourceId: 'a', timeMs })))
    await settle()
    expect(readers.read).toEqual(['a@100', 'a@200', 'a@300'])
    expect(readers.closed).toEqual(['a'])
    expect(film.get('a', 500)).toBeUndefined()
    film.dispose()
  })

  it('does not give up on a recording for a frame here and there', async () => {
    const readers = fake({ fail: (_, timeMs) => timeMs % 200 === 0 })
    const film = new Filmstrip(readers.open, { lingerMs: 1_000_000 })
    film.want([100, 200, 300, 400, 500, 600, 700].map((timeMs) => ({ sourceId: 'a', timeMs })))
    await settle()
    expect([100, 300, 500, 700].every((timeMs) => film.get('a', timeMs) !== undefined)).toBe(true)
    expect(readers.closed).toEqual([])
    film.dispose()
  })

  it('closes the recordings a while after the last frame, and opens them again when needed', async () => {
    vi.useFakeTimers()
    try {
      const readers = fake()
      const film = new Filmstrip(readers.open, { lingerMs: 5_000 })
      film.want([{ sourceId: 'a', timeMs: 100 }])
      await vi.advanceTimersByTimeAsync(10)
      expect(readers.closed).toEqual([])
      await vi.advanceTimersByTimeAsync(4_000)
      expect(readers.closed).toEqual([])
      // More frames wanted in time keep it open.
      film.want([{ sourceId: 'a', timeMs: 200 }])
      await vi.advanceTimersByTimeAsync(4_000)
      expect(readers.closed).toEqual([])
      await vi.advanceTimersByTimeAsync(2_000)
      expect(readers.closed).toEqual(['a'])
      film.want([{ sourceId: 'a', timeMs: 300 }])
      await vi.advanceTimersByTimeAsync(10)
      expect(readers.opened).toEqual(['a', 'a'])
      film.dispose()
      await vi.advanceTimersByTimeAsync(10)
      expect(readers.closed).toEqual(['a', 'a'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not close a recording while a frame is being read from it, but once the read has finished', async () => {
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => (release = resolve))
    const closed: string[] = []
    const film = new Filmstrip(
      async (sourceId) => ({
        frameAt: async () => {
          await gate
          return picture('late')
        },
        close: () => closed.push(sourceId),
      }),
      { lingerMs: 1_000_000 },
    )
    film.want([{ sourceId: 'a', timeMs: 1 }])
    await settle()
    film.dispose()
    await settle()
    // A browser's decoder may not survive being closed in the middle of a frame.
    expect(closed).toEqual([])
    release()
    await settle()
    expect(closed).toEqual(['a'])
    expect(film.get('a', 1)).toBeUndefined()
  })

  it('closes the recordings at once when it is disposed with nothing being read', async () => {
    const readers = fake()
    const film = new Filmstrip(readers.open, { lingerMs: 1_000_000 })
    film.want([{ sourceId: 'a', timeMs: 1 }])
    await settle()
    film.dispose()
    await settle()
    expect(readers.closed).toEqual(['a'])
  })

  it('does nothing after it is disposed', async () => {
    const readers = fake()
    const film = new Filmstrip(readers.open)
    const changed = vi.fn()
    film.subscribe(changed)
    film.want([{ sourceId: 'a', timeMs: 100 }])
    film.dispose()
    await settle()
    film.want([{ sourceId: 'a', timeMs: 200 }])
    await settle()
    expect(changed).not.toHaveBeenCalled()
    expect(film.get('a', 100)).toBeUndefined()
    expect(readers.read.filter((read) => read === 'a@200')).toEqual([])
  })
})
