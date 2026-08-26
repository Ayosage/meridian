import type { PlayerId } from '../state'
import { MIN_LONGEST_ROAD } from './data'
import type { CatanState } from './state'
import { topologyFor, type EdgeId, type VertexId } from './topology'

/**
 * Longest simple edge-path in the player's road network. Opponent buildings
 * block passage THROUGH a vertex; paths may still start or end at one.
 */
export function longestRoadLength(state: CatanState, player: PlayerId): number {
  const topo = topologyFor(state.board)
  const owned = new Set<EdgeId>(Object.keys(state.roads).filter((e) => state.roads[e] === player))
  if (owned.size === 0) return 0

  const blockedForPassage = (v: VertexId) => {
    const b = state.buildings[v]
    return b !== undefined && b.owner !== player
  }

  const walk = (vertex: VertexId, used: Set<EdgeId>, isStart: boolean): number => {
    if (!isStart && blockedForPassage(vertex)) return 0
    let best = 0
    for (const e of topo.vertexEdges[vertex] ?? []) {
      if (!owned.has(e) || used.has(e)) continue
      const [a, b] = topo.edgeVertices[e]!
      const next = a === vertex ? b : a
      used.add(e)
      best = Math.max(best, 1 + walk(next, used, false))
      used.delete(e)
    }
    return best
  }

  const startVertices = new Set<VertexId>()
  for (const e of owned) for (const v of topo.edgeVertices[e]!) startVertices.add(v)

  let best = 0
  for (const v of startVertices) best = Math.max(best, walk(v, new Set(), true))
  return best
}

/**
 * Award rules (spec §2): first to >=5 takes it; ties keep the holder; a
 * challenger must strictly exceed; if the holder is severed below 5, a unique
 * new max >=5 takes the card, a tie (or nobody) sets it aside.
 */
export function updateLongestRoad(state: CatanState): CatanState {
  const lengths = state.players.map((_, p) => longestRoadLength(state, p))
  const holder = state.awards.longestRoad
  const qualifying = lengths
    .map((len, p) => ({ p, len }))
    .filter((x) => x.len >= MIN_LONGEST_ROAD)

  let next: PlayerId | null
  if (holder !== null && lengths[holder]! >= MIN_LONGEST_ROAD) {
    const challengers = qualifying.filter((x) => x.p !== holder && x.len > lengths[holder]!)
    if (challengers.length === 0) {
      next = holder
    } else {
      const max = Math.max(...challengers.map((x) => x.len))
      const leaders = challengers.filter((x) => x.len === max)
      next = leaders.length === 1 ? leaders[0]!.p : null
    }
  } else if (qualifying.length > 0) {
    const max = Math.max(...qualifying.map((x) => x.len))
    const leaders = qualifying.filter((x) => x.len === max)
    next = leaders.length === 1 ? leaders[0]!.p : null
  } else {
    next = null
  }

  if (next === state.awards.longestRoad) return state
  return { ...state, awards: { ...state.awards, longestRoad: next } }
}
