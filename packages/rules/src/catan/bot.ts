import { coordKey } from '../coord'
import type { CatanIntent } from './intent'
import { affordable, legalCityVertices, legalRoadEdges, legalSettlementVertices } from './queries'
import type { CatanState } from './state'
import { standardTopology } from './topology'
import { RESOURCES, totalResources } from './types'

/**
 * Deterministic scripted bot: one legal decision for whoever must act.
 * Test/support tool (full-game tests, pilot liveness harness, demos) —
 * NOT a competent player and NOT the server's caretaker pilot.
 */
export function botIntent(state: CatanState): CatanIntent {
  const t = state.turn
  const topo = standardTopology()

  if (t.phase === 'setup') {
    const p = t.current
    if (t.setup!.expect === 'settlement') {
      const spots = legalSettlementVertices(state, p, { setup: true })
      return { type: 'placeSetupSettlement', player: p, vertex: spots[0]! }
    }
    const settlement = t.setup!.lastSettlement!
    const edge = (topo.vertexEdges[settlement] ?? []).find((e) => state.roads[e] === undefined)!
    return { type: 'placeSetupRoad', player: p, edge }
  }

  if (t.phase === 'discard') {
    const player = Number(Object.keys(t.pendingDiscards)[0]!)
    let owed = t.pendingDiscards[player]!
    const hand = { ...state.players[player]!.resources }
    const resources: Partial<Record<(typeof RESOURCES)[number], number>> = {}
    for (const r of RESOURCES) {
      const n = Math.min(hand[r], owed)
      if (n > 0) resources[r] = n
      owed -= n
      if (owed === 0) break
    }
    return { type: 'discard', player, resources }
  }

  if (t.phase === 'robber') {
    const p = t.current
    const hex = state.board.hexes.find(
      (h) =>
        coordKey(h.coord) !== state.board.robber &&
        !(topo.hexVertices[coordKey(h.coord)] ?? []).some((v) => state.buildings[v]?.owner === p),
    )!
    const key = coordKey(hex.coord)
    const victim = state.players.findIndex(
      (pl, i) =>
        i !== p &&
        totalResources(pl.resources) > 0 &&
        (topo.hexVertices[key] ?? []).some((v) => state.buildings[v]?.owner === i),
    )
    return { type: 'moveRobber', player: p, hex: hex.coord, stealFrom: victim === -1 ? null : victim }
  }

  if (t.phase === 'preRoll') return { type: 'rollDice', player: t.current }

  // main phase, greedy priorities: city > settlement > dev card > knight > road > end
  const p = t.current
  const me = state.players[p]!
  const can = affordable(state, p)
  if (can.city && me.citiesLeft > 0) {
    const spots = legalCityVertices(state, p)
    if (spots.length) return { type: 'build', player: p, piece: 'city', location: spots[0]! }
  }
  if (can.settlement && me.settlementsLeft > 0) {
    const spots = legalSettlementVertices(state, p)
    if (spots.length) return { type: 'build', player: p, piece: 'settlement', location: spots[0]! }
  }
  if (can.devCard && state.devDeck.length > 0) return { type: 'buyDevCard', player: p }
  if (!t.devPlayed && me.devCards.some((c) => c.card === 'knight' && c.boughtOnTurn < t.number))
    return { type: 'playDevCard', player: p, card: 'knight' }
  if (can.road && me.roadsLeft > 0) {
    const spots = legalRoadEdges(state, p)
    if (spots.length) return { type: 'build', player: p, piece: 'road', location: spots[0]! }
  }
  return { type: 'endTurn', player: p }
}
