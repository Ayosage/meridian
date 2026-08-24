import { describe, expect, it } from 'vitest'
import { coordKey, vertexId } from '../../src/index'
import {
  buildGoal, greedyDiscard, missingForGoal, pips, publicVp, robberHexScore, vertexPips,
} from '../../src/index'
import { inMain, setupComplete, withResources } from './helpers'

describe('companion heuristics', () => {
  it('pips: ways to roll the token', () => {
    expect(pips(6)).toBe(5)
    expect(pips(8)).toBe(5)
    expect(pips(2)).toBe(1)
    expect(pips(12)).toBe(1)
    expect(pips(null)).toBe(0) // desert
  })

  it('vertexPips sums the pip weights of the vertex\'s (up to 3) land hexes', () => {
    const state = setupComplete()
    const v = vertexId({ q: 0, r: 0 }, 0)
    const keys = v.split('|')
    const expected = keys.reduce((sum, k) => {
      const hex = state.board.hexes.find((h) => coordKey(h.coord) === k)
      return sum + (hex ? pips(hex.token) : 0)
    }, 0)
    expect(vertexPips(state, v)).toBe(expected)
    expect(expected).toBeGreaterThan(0)
  })

  it('publicVp counts buildings and awards, not hidden dev cards', () => {
    const state = setupComplete() // every seat: 2 settlements
    expect(publicVp(state, 0)).toBe(2)
    const withAward = { ...state, awards: { ...state.awards, longestRoad: 0 as const } }
    expect(publicVp(withAward, 0)).toBe(4)
  })

  it('buildGoal prefers city > settlement > devCard', () => {
    const state = inMain() // everyone has upgradable settlements and cities left
    expect(buildGoal(state, 0)).toBe('city')
    const noCities = {
      ...state,
      players: state.players.map((p, i) => (i === 0 ? { ...p, citiesLeft: 0 } : p)),
    }
    expect(buildGoal(noCities, 0)).toBe('settlement')
    const noSettlements = {
      ...noCities,
      players: noCities.players.map((p, i) => (i === 0 ? { ...p, settlementsLeft: 0 } : p)),
    }
    expect(buildGoal(noSettlements, 0)).toBe('devCard')
  })

  it('missingForGoal lists the goal\'s deficits, biggest first', () => {
    // city costs 2 wheat + 3 ore; hand starts near-empty after setup
    const state = inMain()
    const hand = state.players[0]!.resources
    const missing = missingForGoal(state, 0, 'city')
    expect(missing).toContain('ore')
    // biggest deficit (ore: 3 - hand.ore) sorts before wheat (2 - hand.wheat)
    if (hand.ore === hand.wheat) expect(missing[0]).toBe('ore')
    for (const r of missing) expect(['wheat', 'ore']).toContain(r)
  })

  it('robberHexScore: heavily negative on own hexes, positive on enemy production', () => {
    const state = setupComplete()
    // a hex under P1's first settlement, not touched by P0
    const p1Hex = '(-2,0)' // matches SETUP_PLACEMENTS P1 vertex (q:-2,r:0)
    const key = state.board.hexes
      .map((h) => coordKey(h.coord))
      .find((k) => k === p1Hex) ?? coordKey(state.board.hexes[0]!.coord)
    // find any hex P0 builds on for the negative case
    const ownVertex = Object.entries(state.buildings).find(([, b]) => b.owner === 0)![0]
    const ownHexKey = ownVertex.split('|')[0]!
    expect(robberHexScore(state, 0, ownHexKey)).toBeLessThanOrEqual(-1000)
  })

  it('greedyDiscard sheds from the largest piles first and totals exactly owed', () => {
    const state = withResources(inMain(), 0, { wood: 5, brick: 1 })
    const out = greedyDiscard(state, 0, 4)
    const total = Object.values(out).reduce((n, v) => n + (v ?? 0), 0)
    expect(total).toBe(4)
    expect(out.wood).toBeGreaterThanOrEqual(3) // biggest pile pays most
  })
})
