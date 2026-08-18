import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import {
  add,
  coordKey,
  coordsEqual,
  distance,
  inRadius,
  neighbors,
  type Coord,
} from '../src/index'

const arbCoord = fc.record({
  q: fc.integer({ min: -20, max: 20 }),
  r: fc.integer({ min: -20, max: 20 }),
})

describe('hex coordinate helpers', () => {
  it('computes known distances', () => {
    expect(distance({ q: 0, r: 0 }, { q: 0, r: 0 })).toBe(0)
    expect(distance({ q: 0, r: 0 }, { q: 1, r: 0 })).toBe(1)
    expect(distance({ q: 0, r: 0 }, { q: 1, r: -1 })).toBe(1)
    expect(distance({ q: -3, r: 0 }, { q: 3, r: 0 })).toBe(6)
    expect(distance({ q: 0, r: 0 }, { q: 2, r: -1 })).toBe(2)
  })

  it('distance is symmetric and zero only at identity (property)', () => {
    fc.assert(
      fc.property(arbCoord, arbCoord, (a, b) => {
        expect(distance(a, b)).toBe(distance(b, a))
        if (coordsEqual(a, b)) expect(distance(a, b)).toBe(0)
        else expect(distance(a, b)).toBeGreaterThan(0)
      }),
    )
  })

  it('distance obeys the triangle inequality (property)', () => {
    fc.assert(
      fc.property(arbCoord, arbCoord, arbCoord, (a, b, c) => {
        expect(distance(a, c)).toBeLessThanOrEqual(distance(a, b) + distance(b, c))
      }),
    )
  })

  it('every coord has 6 distinct neighbors at distance 1 (property)', () => {
    fc.assert(
      fc.property(arbCoord, (c) => {
        const ns = neighbors(c)
        expect(ns).toHaveLength(6)
        expect(new Set(ns.map(coordKey)).size).toBe(6)
        for (const n of ns) expect(distance(c, n)).toBe(1)
      }),
    )
  })

  it('add and equality behave', () => {
    expect(add({ q: 2, r: -1 }, { q: -1, r: 1 })).toEqual({ q: 1, r: 0 })
    expect(coordsEqual({ q: 1, r: 2 }, { q: 1, r: 2 })).toBe(true)
    expect(coordsEqual({ q: 1, r: 2 }, { q: 2, r: 1 })).toBe(false)
    expect(coordKey({ q: -3, r: 2 })).toBe('-3,2')
  })

  it('inRadius matches the hexagonal board rule', () => {
    expect(inRadius({ q: 0, r: 0 }, 3)).toBe(true)
    expect(inRadius({ q: -3, r: 0 }, 3)).toBe(true)
    expect(inRadius({ q: -3, r: 2 }, 3)).toBe(true)
    expect(inRadius({ q: -3, r: -1 }, 3)).toBe(false)
    expect(inRadius({ q: 4, r: 0 }, 3)).toBe(false)
    expect(inRadius({ q: 2, r: 2 }, 3)).toBe(false)
  })

  it('inRadius agrees with distance-from-origin (property)', () => {
    fc.assert(
      fc.property(arbCoord, fc.integer({ min: 1, max: 8 }), (c, radius) => {
        expect(inRadius(c, radius)).toBe(distance({ q: 0, r: 0 }, c) <= radius)
      }),
    )
  })

  it('exports state types usable at compile time', () => {
    const piece: import('../src/index').Piece = {
      id: 'p0-0',
      owner: 0,
      type: 'runner',
      at: { q: 0, r: 0 },
    }
    expect(piece.owner).toBe(0)
  })
})
