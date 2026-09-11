import { describe, expect, it } from 'vitest'
import { dueKeys, earliest, type Deadlines } from '../src/timers'

describe('deadlines', () => {
  const d: Deadlines = { pilot: 1_000, offer: null, abandon: 5_000, expiry: null, webhook: null }
  it('earliest picks the soonest non-null deadline', () => {
    expect(earliest(d)).toBe(1_000)
    expect(earliest({ pilot: null, offer: null, abandon: null, expiry: null, webhook: null })).toBeNull()
  })
  it('dueKeys lists every deadline at or before now, soonest first', () => {
    expect(dueKeys(d, 999)).toEqual([])
    expect(dueKeys(d, 1_000)).toEqual(['pilot'])
    expect(dueKeys({ ...d, offer: 800 }, 5_000)).toEqual(['offer', 'pilot', 'abandon'])
  })
})
