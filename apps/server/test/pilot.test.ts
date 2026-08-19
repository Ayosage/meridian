import { describe, expect, it } from 'vitest'
import {
  addResources,
  applyCatanIntent,
  coordKey,
  createCatanGame,
  createRng,
  die,
  isCatanRuleError,
  mustApply,
  SETUP_PLACEMENTS,
  standardTopology,
  stubRng,
  subtractResources,
  type CatanState,
  type ResourceCount,
} from '@meridian/rules'
import { pilotIntent } from '../src/pilot'

function setupComplete(): CatanState {
  let state = createCatanGame({ playerCount: 4, layout: 'beginner' }, createRng(7))
  for (const p of SETUP_PLACEMENTS) {
    state = mustApply(state, { type: 'placeSetupSettlement', player: p.player, vertex: p.vertex })
    state = mustApply(state, { type: 'placeSetupRoad', player: p.player, edge: p.edge })
  }
  return state
}

/** Test surgery: hand a player resources out of the bank. */
function withResources(state: CatanState, player: number, resources: Partial<ResourceCount>): CatanState {
  const players = state.players.map((p, i) =>
    i === player ? { ...p, resources: addResources(p.resources, resources) } : p,
  )
  return { ...state, players, bank: subtractResources(state.bank, resources) }
}

describe('pilotIntent', () => {
  it('returns null when the seat has nothing mandatory to do', () => {
    const state = setupComplete() // preRoll, current = 0
    expect(pilotIntent(state, 1, createRng(0))).toBeNull()
  })

  it('rolls on its own preRoll turn', () => {
    const state = setupComplete()
    expect(pilotIntent(state, 0, createRng(0))).toEqual({ type: 'rollDice', player: 0 })
  })

  it('discards greedily from the largest piles, ties broken in RESOURCES order', () => {
    let state = withResources(setupComplete(), 1, { wood: 5, brick: 5, ore: 1 })
    // player 1 now holds 12 cards (setup wheat + 11); force a 7
    state = mustApply(state, { type: 'rollDice', player: 0 }, stubRng([die(3), die(4)]))
    expect(state.turn.phase).toBe('discard')
    expect(state.turn.pendingDiscards[1]).toBe(6)
    const intent = pilotIntent(state, 1, createRng(0))
    expect(intent).toEqual({ type: 'discard', player: 1, resources: { wood: 5, brick: 1 } })
    expect(isCatanRuleError(applyCatanIntent(state, intent!, createRng(0)))).toBe(false)
  })

  it('waits (null) during discard when it owes nothing', () => {
    let state = withResources(setupComplete(), 1, { wood: 5, brick: 5, ore: 1 })
    state = mustApply(state, { type: 'rollDice', player: 0 }, stubRng([die(3), die(4)]))
    expect(pilotIntent(state, 0, createRng(0))).toBeNull() // current player, but discard phase blocks
    expect(pilotIntent(state, 2, createRng(0))).toBeNull()
  })

  it('moves the robber legally, preferring untouched hexes, stealing only when forced', () => {
    let state = setupComplete()
    state = mustApply(state, { type: 'rollDice', player: 0 }, stubRng([die(3), die(4)]))
    expect(state.turn.phase).toBe('robber') // nobody held >7 after setup
    const intent = pilotIntent(state, 0, createRng(0))!
    expect(intent.type).toBe('moveRobber')
    const move = intent as { hex: { q: number; r: number }; stealFrom: number | null }
    const topo = standardTopology()
    const touched = (topo.hexVertices[coordKey(move.hex)] ?? []).some((v) => state.buildings[v])
    if (!touched) expect(move.stealFrom).toBeNull()
    expect(isCatanRuleError(applyCatanIntent(state, intent, createRng(0)))).toBe(false)
  })

  it('rejects an open trade offer addressed to it, exactly once', () => {
    let state = setupComplete()
    state = mustApply(state, { type: 'rollDice', player: 0 }, stubRng([die(1), die(2)]))
    state = mustApply(state, { type: 'offerTrade', player: 0, give: { ore: 1 }, get: { wheat: 1 } })
    expect(pilotIntent(state, 2, createRng(0))).toEqual({
      type: 'respondTrade',
      player: 2,
      response: 'reject',
    })
    state = mustApply(state, { type: 'respondTrade', player: 2, response: 'reject' })
    expect(pilotIntent(state, 2, createRng(0))).toBeNull()
  })

  it('cancels its own dangling trade offer, then ends its turn', () => {
    let state = setupComplete()
    state = mustApply(state, { type: 'rollDice', player: 0 }, stubRng([die(1), die(2)]))
    state = mustApply(state, { type: 'offerTrade', player: 0, give: { ore: 1 }, get: { wheat: 1 } })
    expect(pilotIntent(state, 0, createRng(0))).toEqual({ type: 'cancelTrade', player: 0 })
    state = mustApply(state, { type: 'cancelTrade', player: 0 })
    expect(pilotIntent(state, 0, createRng(0))).toEqual({ type: 'endTurn', player: 0 })
  })

  it('completes the whole setup draft with legal placements', () => {
    let state = createCatanGame({ playerCount: 4, layout: 'beginner' }, createRng(7))
    const rng = createRng(3)
    for (let i = 0; i < 16; i++) {
      const seat = state.turn.current
      const intent = pilotIntent(state, seat, rng)
      expect(intent).not.toBeNull()
      state = mustApply(state, intent!, rng)
    }
    expect(state.turn.phase).toBe('preRoll')
  })
})
