import { describe, expect, it } from 'vitest'
import { createCatanGame, createRng, isRuleError, catanError, totalResources } from '../../src/index'

describe('createCatanGame', () => {
  it('builds a fresh 4-player game in the setup phase', () => {
    const state = createCatanGame({ playerCount: 4, layout: 'beginner' }, createRng(1))
    expect(state.playerCount).toBe(4)
    expect(state.players).toHaveLength(4)
    expect(state.turn).toMatchObject({ current: 0, number: 0, phase: 'setup', dice: null, devPlayed: false })
    expect(state.turn.setup).toEqual({ expect: 'settlement', lastSettlement: null })
    expect(state.winner).toBeNull()
    expect(state.awards).toEqual({ longestRoad: null, largestArmy: null })
    expect(Object.keys(state.buildings)).toHaveLength(0)
    expect(Object.keys(state.roads)).toHaveLength(0)
  })

  it('stocks the bank, piece supplies, and the 25-card dev deck', () => {
    const state = createCatanGame({ playerCount: 3 }, createRng(2))
    expect(state.bank).toEqual({ wood: 19, brick: 19, sheep: 19, wheat: 19, ore: 19 })
    expect(state.devDeck).toHaveLength(25)
    expect(state.devDeck.filter((c) => c === 'knight')).toHaveLength(14)
    expect(state.devDeck.filter((c) => c === 'vp')).toHaveLength(5)
    for (const p of state.players) {
      expect(p).toMatchObject({ knightsPlayed: 0, roadsLeft: 15, settlementsLeft: 5, citiesLeft: 4 })
      expect(totalResources(p.resources)).toBe(0)
      expect(p.devCards).toHaveLength(0)
    }
  })

  it('deck order is seeded: same seed same order, different seed different order', () => {
    const a = createCatanGame({ playerCount: 4, layout: 'beginner' }, createRng(5))
    const b = createCatanGame({ playerCount: 4, layout: 'beginner' }, createRng(5))
    const c = createCatanGame({ playerCount: 4, layout: 'beginner' }, createRng(6))
    expect(a.devDeck).toEqual(b.devDeck)
    expect(a.devDeck).not.toEqual(c.devDeck)
  })

  it('catanError satisfies the house isRuleError guard', () => {
    const err = catanError('BAD_PHASE', 'nope')
    expect(isRuleError(err)).toBe(true)
    expect(err.code).toBe('BAD_PHASE')
  })
})
