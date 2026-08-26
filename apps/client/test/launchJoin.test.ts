import { describe, expect, it } from 'vitest'
import { launchJoinCode } from '../src/net/catan'

describe('launchJoinCode', () => {
  it('extracts and normalizes the join code', () => {
    expect(launchJoinCode('?join=abcd')).toBe('ABCD')
    expect(launchJoinCode('?seed=3&join=  xyzw ')).toBe('XYZW')
  })
  it('rejects absent or malformed codes', () => {
    expect(launchJoinCode('')).toBeNull()
    expect(launchJoinCode('?join=')).toBeNull()
    expect(launchJoinCode('?join=has spaces here')).toBeNull()
    expect(launchJoinCode('?join=WAY-TOO-LONG-FOR-A-ROOM-ID')).toBeNull()
  })
})
