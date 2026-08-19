import { describe, expect, it } from 'vitest'
import { totalResources, type CatanState } from '../../src/index'
import { apply, die, expectError, setupComplete, stubRng, withResources } from './helpers'

/** Roll a 7 as P0 on a post-setup board. */
function rollSeven(state: CatanState = setupComplete()) {
  return apply(state, { type: 'rollDice', player: 0 }, stubRng([die(3), die(4)]))
}

describe('rolling a 7', () => {
  it('with nobody over 7 cards: straight to the robber phase', () => {
    const state = rollSeven()
    expect(state.turn.phase).toBe('robber')
    expect(state.turn.robberReturn).toBe('main')
    expect(state.turn.pendingDiscards).toEqual({})
  })

  it('players over 7 cards must discard half, rounded down, simultaneously', () => {
    let state = setupComplete()
    state = withResources(state, 1, { wood: 8 }) // P1: 9 cards total -> discards 4
    state = withResources(state, 2, { ore: 7 }) // P2: 8 cards -> discards 4
    state = rollSeven(state)
    expect(state.turn.phase).toBe('discard')
    expect(state.turn.pendingDiscards).toEqual({ 1: 4, 2: 4 })

    // discard is legal off-turn, in any order; exact count and real cards enforced
    expectError(state, { type: 'discard', player: 1, resources: { wood: 3 } }, 'BAD_DISCARD')
    expectError(state, { type: 'discard', player: 1, resources: { brick: 4 } }, 'BAD_DISCARD')
    expectError(state, { type: 'discard', player: 0, resources: {} }, 'BAD_DISCARD') // owes nothing

    const bankWood = state.bank.wood
    state = apply(state, { type: 'discard', player: 2, resources: { ore: 4 } })
    expect(state.turn.phase).toBe('discard') // P1 still owes
    state = apply(state, { type: 'discard', player: 1, resources: { wood: 4 } })
    expect(state.turn.phase).toBe('robber')
    expect(state.bank.wood).toBe(bankWood + 4)
    expect(totalResources(state.players[1]!.resources)).toBe(5)
  })
})

describe('moving the robber', () => {
  it('must move to a different board hex', () => {
    const state = rollSeven()
    expectError(state, { type: 'moveRobber', player: 0, hex: { q: 0, r: 0 }, stealFrom: null }, 'BAD_ROBBER')
    expectError(state, { type: 'moveRobber', player: 0, hex: { q: 9, r: 9 }, stealFrom: null }, 'BAD_ROBBER')
  })

  it('steals one random card from a player with a building on the hex', () => {
    let state = setupComplete()
    state = withResources(state, 1, { wood: 2 }) // P1 now holds wood 2 + wheat 1 (setup payout)
    state = rollSeven(state)
    // P1 has a settlement on forest (-2,0) (corner 3). Steal from P1 there.
    // stubRng value 0.9 -> picks the last card of P1's flattened hand [wood, wood, wheat] -> wheat
    const after = apply(
      state,
      { type: 'moveRobber', player: 0, hex: { q: -2, r: 0 }, stealFrom: 1 },
      stubRng([0.9]),
    )
    expect(after.board.robber).toBe('-2,0')
    expect(after.turn.phase).toBe('main')
    expect(totalResources(after.players[1]!.resources)).toBe(2)
    expect(totalResources(after.players[0]!.resources)).toBe(2) // 1 setup ore + 1 stolen
    expect(after.players[0]!.resources.wheat + after.players[0]!.resources.wood).toBe(1)
  })

  it('cannot steal from a player without a building there, or when naming nobody while victims exist', () => {
    let state = setupComplete()
    state = withResources(state, 1, { wood: 1 })
    state = rollSeven(state)
    expectError(state, { type: 'moveRobber', player: 0, hex: { q: -2, r: 0 }, stealFrom: 2 }, 'BAD_STEAL')
    expectError(state, { type: 'moveRobber', player: 0, hex: { q: -2, r: 0 }, stealFrom: null }, 'BAD_STEAL')
  })

  it('a hex with only broke players allows stealFrom: null', () => {
    let state = setupComplete()
    // P1 holds exactly 1 wheat from setup; strip it back into the bank first
    const players = state.players.map((p, i) =>
      i === 1 ? { ...p, resources: { ...p.resources, wheat: 0 } } : p,
    )
    const bank = { ...state.bank, wheat: state.bank.wheat + 1 }
    state = rollSeven({ ...state, players, bank })
    const after = apply(state, { type: 'moveRobber', player: 0, hex: { q: -2, r: 0 }, stealFrom: null })
    expect(after.board.robber).toBe('-2,0')
    expect(after.turn.phase).toBe('main')
  })

  it('robber cannot move outside the robber phase', () => {
    const state = setupComplete()
    expectError(state, { type: 'moveRobber', player: 0, hex: { q: 1, r: 0 }, stealFrom: null }, 'BAD_PHASE')
  })
})
