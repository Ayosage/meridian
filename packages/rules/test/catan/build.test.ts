import { describe, expect, it } from 'vitest'
import {
  affordable,
  edgeId,
  legalCityVertices,
  legalRoadEdges,
  legalSettlementVertices,
  standardTopology,
  vertexId,
} from '../../src/index'
import { apply, expectError, inMain, SETUP_PLACEMENTS, withResources } from './helpers'

const ROAD_COST = { brick: 1, wood: 1 }
const SETTLEMENT_COST = { brick: 1, wood: 1, wheat: 1, sheep: 1 }
const CITY_COST = { ore: 3, wheat: 2 }

describe('build road', () => {
  it('extends the network, pays the bank, decrements stock', () => {
    let state = withResources(inMain(), 0, ROAD_COST)
    // P0's setup road is edge (2,0) dir 0, between corners 5 and 0. Extend from corner 5 via edge dir 5.
    const next = edgeId({ q: 2, r: 0 }, 5)
    const bankBrick = state.bank.brick
    state = apply(state, { type: 'build', player: 0, piece: 'road', location: next })
    expect(state.roads[next]).toBe(0)
    expect(state.players[0]!.roadsLeft).toBe(12)
    expect(state.players[0]!.resources.brick).toBe(0)
    expect(state.bank.brick).toBe(bankBrick + 1)
  })

  it('rejects disconnected, occupied, off-board, unaffordable, and wrong-phase builds', () => {
    const disconnected = edgeId({ q: 0, r: 0 }, 0)
    let state = inMain()
    expectError(state, { type: 'build', player: 0, piece: 'road', location: disconnected }, 'CANT_AFFORD')
    state = withResources(state, 0, ROAD_COST)
    expectError(state, { type: 'build', player: 0, piece: 'road', location: disconnected }, 'ILLEGAL_PLACEMENT')
    expectError(state, { type: 'build', player: 0, piece: 'road', location: SETUP_PLACEMENTS[0]!.edge }, 'ILLEGAL_PLACEMENT')
    expectError(state, { type: 'build', player: 0, piece: 'road', location: 'nonsense' }, 'ILLEGAL_PLACEMENT')
    expectError(state, { type: 'build', player: 1, piece: 'road', location: disconnected }, 'NOT_YOUR_TURN')
  })

  it('legalRoadEdges matches what applyBuild accepts', () => {
    const state = withResources(inMain(), 0, { brick: 5, wood: 5 })
    const legal = legalRoadEdges(state, 0)
    expect(legal.length).toBeGreaterThan(0)
    for (const e of legal) {
      apply(state, { type: 'build', player: 0, piece: 'road', location: e }) // must not throw
    }
    const topo = standardTopology()
    const illegal = topo.edges.filter((e) => !legal.includes(e))
    expect(illegal.length + legal.length).toBe(72)
  })
})

describe('build settlement', () => {
  it('requires connection to own roads and the distance rule', () => {
    let state = withResources(inMain(), 0, { brick: 3, wood: 3, wheat: 2, sheep: 2 })
    // build two roads from P0's setup road at (2,0): dir 5 then dir 4, reaching corner 4
    state = apply(state, { type: 'build', player: 0, piece: 'road', location: edgeId({ q: 2, r: 0 }, 5) })
    state = apply(state, { type: 'build', player: 0, piece: 'road', location: edgeId({ q: 2, r: 0 }, 4) })
    const spot = vertexId({ q: 2, r: 0 }, 4) // two edges from the settlement at corner 0 -> distance ok
    expect(legalSettlementVertices(state, 0)).toContain(spot)
    const before = state.players[0]!.settlementsLeft
    state = apply(state, { type: 'build', player: 0, piece: 'settlement', location: spot })
    expect(state.buildings[spot]).toEqual({ owner: 0, kind: 'settlement' })
    expect(state.players[0]!.settlementsLeft).toBe(before - 1)

    // adjacent vertex now violates the distance rule for everyone
    expect(legalSettlementVertices(state, 0)).not.toContain(vertexId({ q: 2, r: 0 }, 5))
  })

  it('rejects a vertex on someone else network or floating', () => {
    const state = withResources(inMain(), 0, SETTLEMENT_COST)
    // P1's network, not P0's
    expectError(state, { type: 'build', player: 0, piece: 'settlement', location: vertexId({ q: -2, r: 0 }, 2) }, 'ILLEGAL_PLACEMENT')
  })
})

describe('build city', () => {
  it('upgrades an own settlement, returns it to stock', () => {
    let state = withResources(inMain(), 0, CITY_COST)
    const target = SETUP_PLACEMENTS[0]!.vertex
    expect(legalCityVertices(state, 0)).toContain(target)
    const stockBefore = state.players[0]!
    state = apply(state, { type: 'build', player: 0, piece: 'city', location: target })
    expect(state.buildings[target]).toEqual({ owner: 0, kind: 'city' })
    expect(state.players[0]!.citiesLeft).toBe(stockBefore.citiesLeft - 1)
    expect(state.players[0]!.settlementsLeft).toBe(stockBefore.settlementsLeft + 1)
  })

  it('cannot upgrade an opponent settlement, an empty vertex, or an existing city', () => {
    let state = withResources(inMain(), 0, { ore: 6, wheat: 4 })
    expectError(state, { type: 'build', player: 0, piece: 'city', location: SETUP_PLACEMENTS[1]!.vertex }, 'ILLEGAL_PLACEMENT')
    expectError(state, { type: 'build', player: 0, piece: 'city', location: vertexId({ q: 0, r: 0 }, 0) }, 'ILLEGAL_PLACEMENT')
    state = apply(state, { type: 'build', player: 0, piece: 'city', location: SETUP_PLACEMENTS[0]!.vertex })
    expectError(state, { type: 'build', player: 0, piece: 'city', location: SETUP_PLACEMENTS[0]!.vertex }, 'ILLEGAL_PLACEMENT')
  })
})

describe('affordable', () => {
  it('reflects the cost table', () => {
    const broke = inMain()
    expect(affordable(broke, 0)).toEqual({ road: false, settlement: false, city: false, devCard: false })
    const rich = withResources(broke, 0, { brick: 1, wood: 1, wheat: 2, sheep: 1, ore: 3 })
    expect(affordable(rich, 0)).toEqual({ road: true, settlement: true, city: true, devCard: true })
  })
})
