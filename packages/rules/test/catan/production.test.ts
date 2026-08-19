import { describe, expect, it } from 'vitest'
import { createCatanGame, createRng, distributeProduction, vertexId } from '../../src/catan'
import { apply, die, expectError, setupComplete, stubRng } from './helpers'

describe('rollDice', () => {
  it('records the dice, pays production, and enters main', () => {
    const state = setupComplete()
    const after = apply(state, { type: 'rollDice', player: 0 }, stubRng([die(3), die(5)])) // 8
    expect(after.turn.dice).toEqual([3, 5])
    expect(after.turn.phase).toBe('main')
    expect(after.players[0]!.resources.brick).toBe(1) // hills (2,0)
    expect(after.players[1]!.resources.wood).toBe(1) // forest (-2,0)
    expect(after.players[2]!.resources.wood).toBe(0)
    expect(after.players[3]!.resources.wood).toBe(0)
  })

  it('can only be rolled once, by the current player, in preRoll', () => {
    const state = setupComplete()
    expectError(state, { type: 'rollDice', player: 1 }, 'NOT_YOUR_TURN', stubRng([die(1), die(1)]))
    const rolled = apply(state, { type: 'rollDice', player: 0 }, stubRng([die(1), die(2)]))
    expectError(rolled, { type: 'rollDice', player: 0 }, 'BAD_PHASE', stubRng([die(1), die(1)]))
    // replaces the Task-5 BAD_INTENT expectation: rolling during setup is now BAD_PHASE
    const inSetup = createCatanGame({ playerCount: 4, layout: 'beginner' }, createRng(7))
    expectError(inSetup, { type: 'rollDice', player: 0 }, 'BAD_PHASE', stubRng([die(1), die(1)]))
  })

  it('a robbed hex produces nothing', () => {
    const state = setupComplete()
    const robbed = { ...state, board: { ...state.board, robber: '2,0' } }
    const after = apply(robbed, { type: 'rollDice', player: 0 }, stubRng([die(3), die(5)])) // 8
    expect(after.players[0]!.resources.brick).toBe(0) // hills (2,0) is robbed
    expect(after.players[1]!.resources.wood).toBe(1) // forest (-2,0) still pays
  })
})

describe('distributeProduction', () => {
  it('cities pay double', () => {
    const base = setupComplete()
    const vertex = Object.keys(base.buildings).find((v) => base.buildings[v]!.owner === 0 && v.includes('2,0'))!
    const withCity = { ...base, buildings: { ...base.buildings, [vertex]: { owner: 0, kind: 'city' as const } } }
    const after = distributeProduction(withCity, 8)
    expect(after.players[0]!.resources.brick).toBe(2)
    expect(after.bank.brick).toBe(base.bank.brick - 2)
  })

  it('bank shortage, multiple claimants: nobody gets that resource', () => {
    const base = setupComplete()
    // both 8-hexes pay different resources; create a two-claimant brick shortage instead:
    // give P1 a settlement on the same hills hex (2,0) as P0 — corner 3 is far from
    // corner 0 (non-adjacent), then drain the bank to 1 brick.
    const v = vertexId({ q: 2, r: 0 }, 3)
    const state = {
      ...base,
      buildings: { ...base.buildings, [v]: { owner: 1, kind: 'settlement' as const } },
      bank: { ...base.bank, brick: 1 },
    }
    const after = distributeProduction(state, 8)
    expect(after.players[0]!.resources.brick).toBe(0)
    expect(after.players[1]!.resources.brick).toBe(0)
    expect(after.bank.brick).toBe(1) // untouched
    expect(after.players[1]!.resources.wood).toBe(1) // unaffected resource still pays
  })

  it('bank shortage, single claimant: they take what remains', () => {
    const base = setupComplete()
    const vertex = Object.keys(base.buildings).find((v) => base.buildings[v]!.owner === 0 && v.includes('2,0'))!
    const withCity = { ...base, buildings: { ...base.buildings, [vertex]: { owner: 0, kind: 'city' as const } } }
    const state = { ...withCity, bank: { ...withCity.bank, brick: 1 } }
    const after = distributeProduction(state, 8) // city demands 2, bank has 1
    expect(after.players[0]!.resources.brick).toBe(1)
    expect(after.bank.brick).toBe(0)
  })

  it('resource conservation: bank + hands is invariant', () => {
    const state = setupComplete()
    const before = state.bank.brick + state.players.reduce((s, p) => s + p.resources.brick, 0)
    const after = distributeProduction(state, 8)
    expect(after.bank.brick + after.players.reduce((s, p) => s + p.resources.brick, 0)).toBe(before)
  })
})
