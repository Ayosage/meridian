import { describe, expect, it } from 'vitest'
import { coordKey, distance, neighbors } from '@meridian/rules'
import { TILE_SIZE, boardCoords, buildCoordIndex, coordToWorld } from '../src/scene/layout'

describe('boardCoords', () => {
  it('generates the full hexagonal board for a radius', () => {
    expect(boardCoords(1)).toHaveLength(7)
    expect(boardCoords(3)).toHaveLength(37)
  })

  it('every generated coord is within the radius and unique', () => {
    const coords = boardCoords(3)
    const keys = new Set(coords.map(coordKey))
    expect(keys.size).toBe(37)
    for (const c of coords) expect(distance({ q: 0, r: 0 }, c)).toBeLessThanOrEqual(3)
  })
})

describe('coordToWorld', () => {
  it('places the origin at world zero on the ground plane', () => {
    expect(coordToWorld({ q: 0, r: 0 })).toEqual([0, 0, 0])
  })

  it('places all six neighbors at equal world distance (pointy-top spacing)', () => {
    const [ox, , oz] = coordToWorld({ q: 0, r: 0 })
    for (const n of neighbors({ q: 0, r: 0 })) {
      const [x, , z] = coordToWorld(n)
      const d = Math.hypot(x - ox, z - oz)
      expect(d).toBeCloseTo(Math.sqrt(3) * TILE_SIZE, 10)
    }
  })

  it('scales with tile size', () => {
    const [x, , z] = coordToWorld({ q: 2, r: -1 }, 2)
    const [x1, , z1] = coordToWorld({ q: 2, r: -1 }, 1)
    expect(x).toBeCloseTo(x1 * 2, 10)
    expect(z).toBeCloseTo(z1 * 2, 10)
  })
})

describe('buildCoordIndex', () => {
  it('round-trips every coord to its instance index', () => {
    const coords = boardCoords(2)
    const index = buildCoordIndex(coords)
    coords.forEach((c, i) => expect(index.get(coordKey(c))).toBe(i))
    expect(index.size).toBe(coords.length)
  })
})
