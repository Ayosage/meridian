import type { PlayerId } from '../state'
import { COSTS } from './data'
import { settlementDistanceOk } from './placement'
import type { CatanState } from './state'
import { topologyFor, type EdgeId, type VertexId } from './topology'
import { hasResources, type Resource } from './types'

/**
 * The public subset placement legality needs — a redacted CatanClientState
 * satisfies this, so the phase-4 client can highlight legal moves from its view.
 */
export type PlacementView = Pick<CatanState, 'board' | 'buildings' | 'roads'>

/** Vacant edges connected to the player's network; roads cannot pass through an opponent's building. */
export function legalRoadEdges(state: PlacementView, player: PlayerId): EdgeId[] {
  const topo = topologyFor(state.board)
  return topo.edges.filter((e) => {
    if (state.roads[e] !== undefined) return false
    for (const v of topo.edgeVertices[e]!) {
      const building = state.buildings[v]
      if (building?.owner === player) return true
      if (building) continue // opponent building blocks passage through this vertex
      if ((topo.vertexEdges[v] ?? []).some((e2) => e2 !== e && state.roads[e2] === player)) return true
    }
    return false
  })
}

/** Distance rule always; connection to an own road unless setup. */
export function legalSettlementVertices(
  state: PlacementView,
  player: PlayerId,
  opts: { setup?: boolean } = {},
): VertexId[] {
  const topo = topologyFor(state.board)
  return topo.vertices.filter((v) => {
    if (!settlementDistanceOk(state, v)) return false
    if (opts.setup) return true
    return (topo.vertexEdges[v] ?? []).some((e) => state.roads[e] === player)
  })
}

export function legalCityVertices(state: PlacementView, player: PlayerId): VertexId[] {
  return Object.keys(state.buildings).filter(
    (v) => state.buildings[v]!.owner === player && state.buildings[v]!.kind === 'settlement',
  )
}

/** 2 with a building on a matching-resource port, 3 with any generic port, else 4. */
export function bankTradeRate(state: PlacementView, player: PlayerId, resource: Resource): 4 | 3 | 2 {
  let rate: 4 | 3 = 4
  for (const port of state.board.ports) {
    if (!port.vertices.some((v) => state.buildings[v]?.owner === player)) continue
    if (port.kind === resource) return 2
    if (port.kind === 'generic') rate = 3
  }
  return rate
}

export function affordable(
  state: CatanState,
  player: PlayerId,
): Record<'road' | 'settlement' | 'city' | 'devCard', boolean> {
  const hand = state.players[player]!.resources
  return {
    road: hasResources(hand, COSTS.road),
    settlement: hasResources(hand, COSTS.settlement),
    city: hasResources(hand, COSTS.city),
    devCard: hasResources(hand, COSTS.devCard),
  }
}
