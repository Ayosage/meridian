import { describe, expect, it } from 'vitest'
import {
  BEGINNER_TERRAIN,
  createRng,
  generateBoard,
  TERRAIN_POOL,
  TOKEN_SPIRAL,
  totalResources,
  hasResources,
  addResources,
  subtractResources,
  emptyResources,
  validateBoard,
} from '../../src/catan'

describe('resource math', () => {
  it('total, has, add, subtract behave', () => {
    const hand = addResources(emptyResources(), { wood: 2, ore: 1 })
    expect(totalResources(hand)).toBe(3)
    expect(hasResources(hand, { wood: 2 })).toBe(true)
    expect(hasResources(hand, { wood: 3 })).toBe(false)
    expect(hasResources(hand, { brick: 1 })).toBe(false)
    const rest = subtractResources(hand, { wood: 1 })
    expect(rest.wood).toBe(1)
    expect(hand.wood).toBe(2) // no mutation
  })
})

describe('board data', () => {
  it('token and terrain pools have the official composition', () => {
    expect(TOKEN_SPIRAL).toHaveLength(18)
    expect([...TOKEN_SPIRAL].sort((a, b) => a - b)).toEqual([2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12])
    expect(TERRAIN_POOL).toHaveLength(19)
    expect(BEGINNER_TERRAIN).toHaveLength(19)
    const count = (arr: readonly string[], t: string) => arr.filter((x) => x === t).length
    for (const pool of [TERRAIN_POOL, BEGINNER_TERRAIN]) {
      expect(count(pool, 'forest')).toBe(4)
      expect(count(pool, 'pasture')).toBe(4)
      expect(count(pool, 'fields')).toBe(4)
      expect(count(pool, 'hills')).toBe(3)
      expect(count(pool, 'mountains')).toBe(3)
      expect(count(pool, 'desert')).toBe(1)
    }
  })
})

describe('generateBoard', () => {
  it('beginner board is valid, desert centered, robber on the desert', () => {
    const board = generateBoard(createRng(1), 'beginner')
    expect(board.hexes).toHaveLength(19)
    expect(validateBoard(board.hexes)).toBeNull()
    const desert = board.hexes.find((h) => h.terrain === 'desert')!
    expect(desert.coord).toEqual({ q: 0, r: 0 })
    expect(desert.token).toBeNull()
    expect(board.robber).toBe('0,0')
  })

  it('beginner board is deterministic regardless of rng', () => {
    const a = generateBoard(createRng(1), 'beginner')
    const b = generateBoard(createRng(999), 'beginner')
    expect(a.hexes).toEqual(b.hexes)
  })

  it('random boards are valid for many seeds and vary', () => {
    const boards = [1, 2, 3, 4, 5, 6, 7, 8].map((s) => generateBoard(createRng(s), 'random'))
    for (const b of boards) expect(validateBoard(b.hexes)).toBeNull()
    const signatures = new Set(boards.map((b) => b.hexes.map((h) => h.terrain).join(',')))
    expect(signatures.size).toBeGreaterThan(1)
  })

  it('ports: 9 total, 4 generic + one per resource, 18 distinct vertices', () => {
    const board = generateBoard(createRng(1), 'beginner')
    expect(board.ports).toHaveLength(9)
    const kinds = board.ports.map((p) => p.kind)
    expect(kinds.filter((k) => k === 'generic')).toHaveLength(4)
    for (const r of ['wood', 'brick', 'sheep', 'wheat', 'ore']) expect(kinds).toContain(r)
    const verts = board.ports.flatMap((p) => p.vertices)
    expect(new Set(verts).size).toBe(18)
  })

  it('validateBoard rejects adjacent red tokens', () => {
    const board = generateBoard(createRng(1), 'beginner')
    // graft an 8 next to an existing 8 at (2,0): its neighbor (2,-1) currently holds 10
    const broken = board.hexes.map((h) => (h.coord.q === 2 && h.coord.r === -1 ? { ...h, token: 8 } : h))
    expect(validateBoard(broken)).not.toBeNull()
  })
})
