import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import {
  edgeId,
  longestRoadLength,
  updateLongestRoad,
  vertexId,
  type CatanState,
} from '../../src/index'
import { apply, inMain, setupComplete, withResources } from './helpers'

/** Test surgery: overwrite the road map (owners only, stocks untouched — length math only). */
function withRoads(state: CatanState, roads: Record<string, number>): CatanState {
  return { ...state, roads }
}

// A 5-edge path around hex (2,0): corners 0-5-4-3-2-1
const RING = [0, 5, 4, 3, 2].map((d) => edgeId({ q: 2, r: 0 }, d))

describe('longestRoadLength', () => {
  it('counts a simple chain', () => {
    const base = setupComplete()
    // P0's two setup roads are far apart: longest CHAIN is 1
    expect(longestRoadLength(base, 0)).toBe(1)
    const chained = withRoads(base, Object.fromEntries(RING.map((e) => [e, 0])))
    expect(longestRoadLength(chained, 0)).toBe(5)
    expect(longestRoadLength(chained, 1)).toBe(0)
  })

  it('a bent chain counts its full length', () => {
    const base = setupComplete()
    // edges d5 (c4-c5), d0 (c5-c0), d1 (c0-c1), d2 (c1-c2): a 4-edge path c4..c2
    const roads = Object.fromEntries([0, 1, 2, 5].map((d) => [edgeId({ q: 2, r: 0 }, d), 0]))
    expect(longestRoadLength(withRoads(base, roads), 0)).toBe(4)
  })

  it('an opponent settlement severs the path but endpoints still count', () => {
    const base = setupComplete()
    const chained = withRoads(base, Object.fromEntries(RING.map((e) => [e, 0])))
    // block corner 4 of (2,0): splits 5 into max(2, 3)
    const blocked = {
      ...chained,
      buildings: { ...chained.buildings, [vertexId({ q: 2, r: 0 }, 4)]: { owner: 1, kind: 'settlement' as const } },
    }
    expect(longestRoadLength(blocked, 0)).toBe(3)
  })

  it('own buildings do not block', () => {
    const base = setupComplete()
    const chained = withRoads(base, Object.fromEntries(RING.map((e) => [e, 0])))
    // P0's own setup settlement sits at corner 0 of (2,0) already — length must still be 5
    expect(longestRoadLength(chained, 0)).toBe(5)
  })

  it('monotone under adding edges (property)', () => {
    const base = setupComplete()
    fc.assert(
      fc.property(fc.subarray([...RING, edgeId({ q: 2, r: 0 }, 1)]), fc.subarray(RING), (a, b) => {
        const small = withRoads(base, Object.fromEntries(b.map((e) => [e, 0])))
        const union = withRoads(base, Object.fromEntries([...a, ...b].map((e) => [e, 0])))
        expect(longestRoadLength(union, 0)).toBeGreaterThanOrEqual(longestRoadLength(small, 0))
        expect(longestRoadLength(union, 0)).toBeLessThanOrEqual(new Set([...a, ...b]).size)
      }),
    )
  })
})

describe('updateLongestRoad award', () => {
  const withLen = (state: CatanState, roadsByPlayer: Record<number, string[]>): CatanState => {
    const roads: Record<string, number> = {}
    for (const [p, edges] of Object.entries(roadsByPlayer)) for (const e of edges) roads[e] = Number(p)
    return { ...state, roads }
  }
  // 5-chains on opposite corners for P0 and P1
  const P0_RING = [0, 5, 4, 3, 2].map((d) => edgeId({ q: 2, r: 0 }, d))
  const P1_RING = [0, 5, 4, 3, 2].map((d) => edgeId({ q: -2, r: 0 }, d))

  it('first to five takes the card; a tie does not move it; strictly longer does', () => {
    let state = updateLongestRoad(withLen(setupComplete(), { 0: P0_RING }))
    expect(state.awards.longestRoad).toBe(0)
    state = updateLongestRoad(withLen(state, { 0: P0_RING, 1: P1_RING }))
    expect(state.awards.longestRoad).toBe(0) // tie keeps holder
    const longer = [...P1_RING, edgeId({ q: -2, r: 0 }, 1)]
    state = updateLongestRoad(withLen(state, { 0: P0_RING, 1: longer }))
    expect(state.awards.longestRoad).toBe(1)
  })

  it('under five, nobody holds it', () => {
    const state = updateLongestRoad(withLen(setupComplete(), { 0: P0_RING.slice(0, 4) }))
    expect(state.awards.longestRoad).toBeNull()
  })

  it('severing the holder below 5 with no successor sets the card aside', () => {
    let state = updateLongestRoad(withLen(setupComplete(), { 0: P0_RING }))
    expect(state.awards.longestRoad).toBe(0)
    const severed = {
      ...state,
      buildings: { ...state.buildings, [vertexId({ q: 2, r: 0 }, 4)]: { owner: 1, kind: 'settlement' as const } },
    }
    expect(updateLongestRoad(severed).awards.longestRoad).toBeNull()
  })

  it('flows through the build intent', () => {
    let state = withResources(inMain(), 0, { brick: 4, wood: 4 })
    for (const d of [5, 4, 3, 2]) {
      state = apply(state, { type: 'build', player: 0, piece: 'road', location: edgeId({ q: 2, r: 0 }, d) })
    }
    expect(state.awards.longestRoad).toBe(0) // setup road d0 + these four = 5
  })
})
