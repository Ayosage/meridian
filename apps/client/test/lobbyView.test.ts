import { describe, expect, it } from 'vitest'
import { lobbyBoardView } from '../src/scene/catan/lobbyView'

describe('lobbyBoardView', () => {
  it('is a beginner island with pieces from every seat, in the main phase', () => {
    const v = lobbyBoardView()
    expect(v.board.hexes.length).toBe(19)
    const owners = new Set(Object.values(v.buildings).map((b) => b.owner))
    expect(owners.size).toBe(4)
    expect(Object.values(v.buildings).some((b) => b.kind === 'city')).toBe(true)
    expect(Object.keys(v.roads).length).toBeGreaterThan(Object.keys(v.buildings).length)
    expect(v.turn.phase).toBe('main')
  })
  it('is deterministic (the beginner layout is fixed; the seed only feeds the rng)', () => {
    expect(lobbyBoardView(7)).toEqual(lobbyBoardView(7))
  })
})
