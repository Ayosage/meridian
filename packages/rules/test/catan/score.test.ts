import { describe, expect, it } from 'vitest'
import { createCatanGame, createRng, updateLargestArmy, victoryPoints, type CatanState } from '../../src/index'
import { apply, die, expectError, inMain, setupComplete, stubRng, withResources } from './helpers'

/** Test surgery helpers. */
function withKnights(state: CatanState, player: number, n: number): CatanState {
  const players = state.players.map((p, i) => (i === player ? { ...p, knightsPlayed: n } : p))
  return { ...state, players }
}
function withVpCards(state: CatanState, player: number, n: number): CatanState {
  const players = state.players.map((p, i) =>
    i === player
      ? {
          ...p,
          devCards: [...p.devCards, ...Array.from({ length: n }, () => ({ card: 'vp' as const, boughtOnTurn: 0 }))],
        }
      : p,
  )
  return { ...state, players }
}
function withAward(state: CatanState, award: 'longestRoad' | 'largestArmy', player: number): CatanState {
  return { ...state, awards: { ...state.awards, [award]: player } }
}
function withCities(state: CatanState, player: number): CatanState {
  const buildings = Object.fromEntries(
    Object.entries(state.buildings).map(([v, b]) =>
      b.owner === player ? [v, { ...b, kind: 'city' as const }] : [v, b],
    ),
  )
  return { ...state, buildings }
}

describe('victoryPoints', () => {
  it('counts buildings, awards, and (only when asked) hidden vp cards', () => {
    let state = setupComplete()
    expect(victoryPoints(state, 0)).toBe(2) // two setup settlements
    state = withCities(state, 0) // -> 4
    state = withAward(state, 'longestRoad', 0) // -> 6
    state = withAward(state, 'largestArmy', 0) // -> 8
    state = withVpCards(state, 0, 2) // hidden -> 10
    expect(victoryPoints(state, 0)).toBe(8)
    expect(victoryPoints(state, 0, { includeHidden: true })).toBe(10)
    expect(victoryPoints(state, 1)).toBe(2)
  })
})

describe('targetVp', () => {
  it('createCatanGame threads a custom targetVp into the state', () => {
    const state = createCatanGame({ playerCount: 3, targetVp: 6 }, createRng(1))
    expect(state.targetVp).toBe(6)
  })

  it('the win fires at a custom targetVp on the current player intent', () => {
    // 2 cities (4) + longest road (2) = 6 VP for player 0
    let state: CatanState = { ...setupComplete(), targetVp: 6 }
    state = withCities(state, 0)
    state = withAward(state, 'longestRoad', 0)
    const rolled = apply(state, { type: 'rollDice', player: 0 }, stubRng([die(1), die(2)]))
    expect(rolled.winner).toBe(0)
  })

  it('defaults to the standard 10 when targetVp is absent', () => {
    let state = setupComplete()
    state = withCities(state, 0)
    state = withAward(state, 'longestRoad', 0) // 6 VP — short of 10
    const rolled = apply(state, { type: 'rollDice', player: 0 }, stubRng([die(1), die(2)]))
    expect(rolled.winner).toBeNull()
  })
})

describe('updateLargestArmy', () => {
  it('third knight takes the card; ties keep the holder; strictly more transfers', () => {
    let state = setupComplete()
    state = updateLargestArmy(withKnights(state, 0, 2), 0)
    expect(state.awards.largestArmy).toBeNull()
    state = updateLargestArmy(withKnights(state, 0, 3), 0)
    expect(state.awards.largestArmy).toBe(0)
    state = updateLargestArmy(withKnights(state, 1, 3), 1)
    expect(state.awards.largestArmy).toBe(0) // tie keeps holder
    state = updateLargestArmy(withKnights(state, 1, 4), 1)
    expect(state.awards.largestArmy).toBe(1)
  })
})

describe('winning', () => {
  it('a mid-turn intent that reaches 10 VP (hidden vp cards included) ends the game', () => {
    let state = inMain()
    state = withCities(state, 0) // 4
    state = withAward(state, 'longestRoad', 0) // 6
    state = withAward(state, 'largestArmy', 0) // 8
    state = withVpCards(state, 0, 2) // 10 hidden
    state = withResources(state, 0, { wood: 4 })
    const after = apply(state, { type: 'bankTrade', player: 0, give: 'wood', get: 'sheep' })
    expect(after.winner).toBe(0)
    expect(after.turn.phase).toBe('ended')
    expectError(after, { type: 'endTurn', player: 0 }, 'GAME_OVER')
  })

  it('an off-turn 10 only wins at the start of their own turn', () => {
    let state = inMain() // P0's turn
    state = withCities(state, 1)
    state = withAward(state, 'longestRoad', 1)
    state = withAward(state, 'largestArmy', 1)
    state = withVpCards(state, 1, 2) // P1 sits at 10 while P0 plays
    expect(state.winner).toBeNull()
    const after = apply(state, { type: 'endTurn', player: 0 })
    expect(after.winner).toBe(1) // crowned the moment their turn begins
    expect(after.turn.phase).toBe('ended')
  })

  it('setup placements never trigger a win', () => {
    const state = setupComplete()
    expect(state.winner).toBeNull()
  })
})
