import {
  coordKey,
  greedyDiscard,
  hasResources,
  legalSettlementVertices,
  pick,
  standardTopology,
  totalResources,
  type CatanIntent,
  type CatanState,
  type PlayerId,
  type Rng,
} from '@meridian/rules'

/**
 * Caretaker pilot (server design spec §3): performs ONLY mandatory actions
 * for a seat with no connected human, so the game never stalls. It never
 * builds, buys or plays dev cards, or offers trades — a piloted seat cannot
 * win or reshape the board. It accepts clearly favorable trade offers.
 * Returns null when nothing is mandatory.
 */
export function pilotIntent(state: CatanState, seat: PlayerId, rng: Rng): CatanIntent | null {
  if (state.winner !== null || state.turn.phase === 'ended') return null
  const t = state.turn

  // off-turn obligations first (mirror the engine's off-turn dispatch)
  const owed = t.pendingDiscards[seat]
  if (t.phase === 'discard' && owed) {
    return { type: 'discard', player: seat, resources: greedyDiscard(state, seat, owed) }
  }
  if (t.openTrade && t.current !== seat && t.openTrade.responses[seat] === undefined) {
    // Evaluate instead of auto-rejecting (phase-5 spec §6): the responder
    // gives offer.get and receives offer.give — accept only a trade it can
    // cover that never loses net cards. Still no offers/counters: a piloted
    // seat stays a caretaker, not a competitor.
    const offer = t.openTrade
    const favorable =
      hasResources(state.players[seat]!.resources, offer.get) &&
      totalResources(offer.give) >= totalResources(offer.get)
    return { type: 'respondTrade', player: seat, response: favorable ? 'accept' : 'reject' }
  }

  if (t.current !== seat) return null

  switch (t.phase) {
    case 'setup': {
      if (t.setup!.expect === 'settlement') {
        const spots = legalSettlementVertices(state, seat, { setup: true })
        return { type: 'placeSetupSettlement', player: seat, vertex: pick(rng, spots) }
      }
      const topo = standardTopology()
      const settlement = t.setup!.lastSettlement!
      const edge = (topo.vertexEdges[settlement] ?? []).find((e) => state.roads[e] === undefined)!
      return { type: 'placeSetupRoad', player: seat, edge }
    }
    case 'preRoll':
      return { type: 'rollDice', player: seat }
    case 'robber':
      return robberMove(state, seat, rng)
    case 'main':
      if (t.openTrade) return { type: 'cancelTrade', player: seat }
      return { type: 'endTurn', player: seat }
    case 'discard':
      return null // own discard handled above; others still owe — wait
    default:
      return null
  }
}

function robberMove(state: CatanState, seat: PlayerId, rng: Rng): CatanIntent {
  const topo = standardTopology()
  const candidates = state.board.hexes.filter((h) => coordKey(h.coord) !== state.board.robber)
  const untouched = candidates.filter(
    (h) => !(topo.hexVertices[coordKey(h.coord)] ?? []).some((v) => state.buildings[v]),
  )
  const hex = (untouched.length > 0 ? pick(rng, untouched) : pick(rng, candidates)).coord
  const key = coordKey(hex)
  const victims = state.players
    .map((_, i) => i)
    .filter(
      (i) =>
        i !== seat &&
        totalResources(state.players[i]!.resources) > 0 &&
        (topo.hexVertices[key] ?? []).some((v) => state.buildings[v]?.owner === i),
    )
  return {
    type: 'moveRobber',
    player: seat,
    hex,
    stealFrom: victims.length > 0 ? pick(rng, victims) : null,
  }
}
