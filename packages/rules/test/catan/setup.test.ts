import { describe, expect, it } from 'vitest'
import { createCatanGame, createRng, edgeId, totalResources, vertexId } from '../../src/index'
import { apply, expectError, SETUP_PLACEMENTS, setupComplete } from './helpers'

const fresh = () => createCatanGame({ playerCount: 4, layout: 'beginner' }, createRng(7))

describe('setup draft', () => {
  it('walks the snake P0..P3 then P3..P0 and lands in preRoll turn 1', () => {
    let state = fresh()
    const expectedOrder = [0, 1, 2, 3, 3, 2, 1, 0]
    for (const [i, p] of SETUP_PLACEMENTS.entries()) {
      expect(state.turn.current).toBe(expectedOrder[i])
      expect(state.turn.setup?.expect).toBe('settlement')
      state = apply(state, { type: 'placeSetupSettlement', player: p.player, vertex: p.vertex })
      expect(state.turn.setup?.expect).toBe('road')
      state = apply(state, { type: 'placeSetupRoad', player: p.player, edge: p.edge })
    }
    expect(state.turn.phase).toBe('preRoll')
    expect(state.turn.number).toBe(1)
    expect(state.turn.current).toBe(0)
    expect(state.turn.setup).toBeNull()
    expect(Object.keys(state.buildings)).toHaveLength(8)
    expect(Object.keys(state.roads)).toHaveLength(8)
    for (const p of state.players) {
      expect(p.settlementsLeft).toBe(3)
      expect(p.roadsLeft).toBe(13)
    }
  })

  it('every successful intent bumps seq by exactly 1', () => {
    let state = fresh()
    const p = SETUP_PLACEMENTS[0]!
    const before = state.seq
    state = apply(state, { type: 'placeSetupSettlement', player: p.player, vertex: p.vertex })
    expect(state.seq).toBe(before + 1)
  })

  it('second settlements pay out their adjacent land hexes (beginner board facts)', () => {
    const state = setupComplete()
    expect(state.players[3]!.resources).toMatchObject({ brick: 1 })
    expect(state.players[2]!.resources).toMatchObject({ ore: 1 })
    expect(state.players[1]!.resources).toMatchObject({ wheat: 1 })
    expect(state.players[0]!.resources).toMatchObject({ ore: 1 })
    for (const p of state.players) expect(totalResources(p.resources)).toBe(1)
    expect(state.bank.ore).toBe(17)
  })

  it('rejects out-of-turn and out-of-phase intents', () => {
    const state = fresh()
    expectError(state, { type: 'placeSetupSettlement', player: 1, vertex: SETUP_PLACEMENTS[1]!.vertex }, 'NOT_YOUR_TURN')
    expectError(state, { type: 'endTurn', player: 0 }, 'BAD_PHASE')
    expectError(state, { type: 'placeSetupRoad', player: 0, edge: SETUP_PLACEMENTS[0]!.edge }, 'ILLEGAL_PLACEMENT')
  })

  it('enforces the distance rule during setup', () => {
    let state = fresh()
    const p0 = SETUP_PLACEMENTS[0]!
    state = apply(state, { type: 'placeSetupSettlement', player: 0, vertex: p0.vertex })
    state = apply(state, { type: 'placeSetupRoad', player: 0, edge: p0.edge })
    // vertex (2,0) corner 1 is adjacent to P0's settlement at (2,0) corner 0
    expectError(state, { type: 'placeSetupSettlement', player: 1, vertex: vertexId({ q: 2, r: 0 }, 1) }, 'ILLEGAL_PLACEMENT')
    // occupied vertex is also illegal
    expectError(state, { type: 'placeSetupSettlement', player: 1, vertex: p0.vertex }, 'ILLEGAL_PLACEMENT')
    // garbage vertex id
    expectError(state, { type: 'placeSetupSettlement', player: 1, vertex: 'nonsense' }, 'ILLEGAL_PLACEMENT')
  })

  it('setup road must touch the settlement just placed', () => {
    let state = fresh()
    const p0 = SETUP_PLACEMENTS[0]!
    state = apply(state, { type: 'placeSetupSettlement', player: 0, vertex: p0.vertex })
    // an edge elsewhere on the board does not touch (2,0) corner 0
    expectError(state, { type: 'placeSetupRoad', player: 0, edge: edgeId({ q: 0, r: 0 }, 0) }, 'ILLEGAL_PLACEMENT')
  })

  it('unwired gameplay intents fall through to BAD_INTENT for now', () => {
    // Tasks 6-11 replace these stubs; their own tests then assert BAD_PHASE during setup
    const state = fresh()
    expectError(state, { type: 'rollDice', player: 0 }, 'BAD_INTENT')
  })
})
