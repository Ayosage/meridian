import { coordKey } from '../coord'
import type { PlayerId } from '../state'
import { COSTS } from './data'
import type { CatanIntent } from './intent'
import { legalCityVertices, legalRoadEdges, legalSettlementVertices, affordable } from './queries'
import type { Rng } from './rng'
import type { CatanState } from './state'
import { standardTopology, type VertexId } from './topology'
import { hasResources, RESOURCES, totalResources, type Resource, type ResourceCount } from './types'

/**
 * Companion bot brain (native-bots design spec §1): a competent player for a
 * seat with no human, unlike pilotIntent's caretaker. Pure — per-turn memory
 * (offers proposed, bank trades made) lives in the room and arrives via opts.
 */

/** Production weight of a number token: ways to roll it (6/8 → 5 … 2/12 → 1; desert 0). */
export function pips(token: number | null): number {
  return token == null ? 0 : 6 - Math.abs(7 - token)
}

/** Total pips a vertex touches. Vertex ids are 'a|b|c' sorted coordKeys; off-board keys miss the map. */
export function vertexPips(state: Pick<CatanState, 'board'>, vertex: VertexId): number {
  let sum = 0
  for (const part of vertex.split('|')) {
    const hex = state.board.hexes.find((h) => coordKey(h.coord) === part)
    sum += hex ? pips(hex.token) : 0
  }
  return sum
}

/** Public victory points (buildings + awards) — what every seat can see. */
export function publicVp(state: CatanState, player: PlayerId): number {
  let vp = 0
  for (const b of Object.values(state.buildings)) if (b.owner === player) vp += b.kind === 'city' ? 2 : 1
  if (state.awards.longestRoad === player) vp += 2
  if (state.awards.largestArmy === player) vp += 2
  return vp
}

/** What to save toward: city upgrade > new settlement > dev card > road. */
export function buildGoal(state: CatanState, seat: PlayerId): 'city' | 'settlement' | 'devCard' | 'road' {
  const me = state.players[seat]!
  const upgradable = Object.values(state.buildings).some((b) => b.owner === seat && b.kind === 'settlement')
  if (me.citiesLeft > 0 && upgradable) return 'city'
  if (me.settlementsLeft > 0) return 'settlement'
  if (state.devDeck.length > 0) return 'devCard'
  return 'road'
}

/** Resources still missing for the goal, biggest deficit first. */
export function missingForGoal(
  state: CatanState,
  seat: PlayerId,
  goal: 'city' | 'settlement' | 'devCard' | 'road' = buildGoal(state, seat),
): Resource[] {
  const cost = COSTS[goal]
  const hand = state.players[seat]!.resources
  return RESOURCES.filter((r) => (cost[r] ?? 0) > hand[r]).sort(
    (a, b) => (cost[b] ?? 0) - hand[b] - ((cost[a] ?? 0) - hand[a]),
  )
}

/**
 * Robber destination score: block the biggest production owned by the seats
 * furthest ahead, never our own (heavily negative if we build there).
 */
export function robberHexScore(state: CatanState, seat: PlayerId, hexKey: string): number {
  const topo = standardTopology()
  const hex = state.board.hexes.find((h) => coordKey(h.coord) === hexKey)
  let owners = 0
  for (const v of topo.hexVertices[hexKey] ?? []) {
    const b = state.buildings[v]
    if (!b) continue
    if (b.owner === seat) return -1000
    owners += (b.kind === 'city' ? 2 : 1) * (1 + publicVp(state, b.owner))
  }
  return owners * (1 + pips(hex?.token ?? null))
}

/** Shed from the largest piles first; ties broken in RESOURCES order. Shared by companionIntent and the server's pilot. */
export function greedyDiscard(state: CatanState, seat: PlayerId, owed: number): Partial<ResourceCount> {
  const hand = { ...state.players[seat]!.resources }
  const out: Partial<ResourceCount> = {}
  let remaining = owed
  while (remaining > 0) {
    let best: Resource = RESOURCES[0]!
    for (const r of RESOURCES) if (hand[r] > hand[best]) best = r
    const take = Math.min(hand[best], remaining)
    if (take === 0) break // hand exhausted
    out[best] = (out[best] ?? 0) + take
    hand[best] -= take
    remaining -= take
  }
  return out
}

export interface CompanionOpts {
  /** Room-tracked: this seat already opened an offer this turn. */
  proposedThisTurn: boolean
  /** Room-tracked: response window expired — confirm best or cancel. */
  resolveOfferNow: boolean
  /** Room-tracked: bank trades already made this turn (brain stops at 2). */
  bankTradesThisTurn: number
}

export const COMPANION_DEFAULTS: CompanionOpts = {
  proposedThisTurn: false,
  resolveOfferNow: false,
  bankTradesThisTurn: 0,
}

/** Give 4-of-a-kind surplus (beyond the goal's own cost) for the goal's biggest deficit. */
export function bankTradePlan(state: CatanState, seat: PlayerId): { give: Resource; get: Resource } | null {
  const goal = buildGoal(state, seat)
  const cost = COSTS[goal]
  const hand = state.players[seat]!.resources
  const get = missingForGoal(state, seat, goal)[0]
  if (!get || state.bank[get] < 1) return null
  let give: Resource | null = null
  for (const r of RESOURCES) {
    if (r === get) continue
    const surplus = hand[r] - (cost[r] ?? 0)
    if (surplus >= 4 && (give === null || surplus > hand[give] - (cost[give] ?? 0))) give = r
  }
  return give ? { give, get } : null
}

/** Highest-pip vertex from a candidate list (first wins ties — stable, deterministic). */
function bestVertex(state: CatanState, candidates: readonly VertexId[]): VertexId | null {
  let best: VertexId | null = null
  let bestScore = -1
  for (const v of candidates) {
    const s = vertexPips(state, v)
    if (s > bestScore) { best = v; bestScore = s }
  }
  return best
}

export function companionIntent(
  state: CatanState,
  seat: PlayerId,
  rng: Rng,
  opts: CompanionOpts = COMPANION_DEFAULTS,
): CatanIntent | null {
  if (state.winner !== null || state.turn.phase === 'ended') return null
  const t = state.turn

  // off-turn obligations (mirror the engine's off-turn dispatch)
  const owed = t.pendingDiscards[seat]
  if (t.phase === 'discard' && owed) return { type: 'discard', player: seat, resources: greedyDiscard(state, seat, owed) }
  if (t.openTrade && t.current !== seat && t.openTrade.responses[seat] === undefined) {
    const me = state.players[seat]!
    const offer = t.openTrade
    const favorable = hasResources(me.resources, offer.get) && totalResources(offer.give) >= totalResources(offer.get)
    return { type: 'respondTrade', player: seat, response: favorable ? 'accept' : 'reject' }
  }
  if (t.current !== seat) return null

  switch (t.phase) {
    case 'setup': {
      if (t.setup!.expect === 'settlement') {
        const spots = legalSettlementVertices(state, seat, { setup: true })
        return { type: 'placeSetupSettlement', player: seat, vertex: bestVertex(state, spots)! }
      }
      const topo = standardTopology()
      const settlement = t.setup!.lastSettlement!
      const edge = (topo.vertexEdges[settlement] ?? []).find((e) => state.roads[e] === undefined)!
      return { type: 'placeSetupRoad', player: seat, edge }
    }
    case 'preRoll':
      return { type: 'rollDice', player: seat }
    case 'robber': {
      let bestKey: string | null = null
      let bestScore = -Infinity
      for (const h of state.board.hexes) {
        const key = coordKey(h.coord)
        if (key === state.board.robber) continue
        const s = robberHexScore(state, seat, key)
        if (s > bestScore) { bestKey = key; bestScore = s }
      }
      const topo = standardTopology()
      const hex = state.board.hexes.find((h) => coordKey(h.coord) === bestKey)!
      const victims = state.players
        .map((_, i) => i)
        .filter((i) =>
          i !== seat &&
          totalResources(state.players[i]!.resources) > 0 &&
          (topo.hexVertices[bestKey!] ?? []).some((v) => state.buildings[v]?.owner === i),
        )
        .sort((a, b) => publicVp(state, b) - publicVp(state, a))
      return { type: 'moveRobber', player: seat, hex: hex.coord, stealFrom: victims[0] ?? null }
    }
    case 'main':
      return mainPhase(state, seat, opts)
    default:
      return null
  }
}

function mainPhase(state: CatanState, seat: PlayerId, opts: CompanionOpts): CatanIntent | null {
  const t = state.turn
  const me = state.players[seat]!

  // own open offer: Task 3 adds confirm-best; until then cancel on deadline, else wait
  if (t.openTrade) {
    if (opts.resolveOfferNow) return { type: 'cancelTrade', player: seat }
    return null
  }

  const can = affordable(state, seat)
  if (can.city && me.citiesLeft > 0) {
    const spots = legalCityVertices(state, seat)
    if (spots.length) return { type: 'build', player: seat, piece: 'city', location: bestVertex(state, spots)! }
  }
  if (can.settlement && me.settlementsLeft > 0) {
    const spots = legalSettlementVertices(state, seat)
    if (spots.length) return { type: 'build', player: seat, piece: 'settlement', location: bestVertex(state, spots)! }
  }
  if (can.devCard && state.devDeck.length > 0) return { type: 'buyDevCard', player: seat }

  if (!t.devPlayed) {
    const playable = (card: string) => me.devCards.some((c) => c.card === card && c.boughtOnTurn < t.number)
    if (playable('knight')) return { type: 'playDevCard', player: seat, card: 'knight' }
    if (playable('roadBuilding') && me.roadsLeft > 0) {
      const edges = legalRoadEdges(state, seat).slice(0, Math.min(2, me.roadsLeft))
      if (edges.length) return { type: 'playDevCard', player: seat, card: 'roadBuilding', edges }
    }
    if (playable('yearOfPlenty')) {
      const take = plentyPicks(state, seat)
      if (take) return { type: 'playDevCard', player: seat, card: 'yearOfPlenty', take }
    }
    if (playable('monopoly')) {
      const want = missingForGoal(state, seat)[0] ?? 'ore'
      return { type: 'playDevCard', player: seat, card: 'monopoly', resource: want }
    }
  }

  if (can.road && me.roadsLeft > 0) {
    const spots = legalRoadEdges(state, seat)
    if (spots.length) return { type: 'build', player: seat, piece: 'road', location: spots[0]! }
  }

  if (opts.bankTradesThisTurn < 2) {
    const plan = bankTradePlan(state, seat)
    if (plan) return { type: 'bankTrade', player: seat, give: plan.give, get: plan.get }
  }

  return { type: 'endTurn', player: seat }
}

/** Two Year-of-Plenty picks the bank can actually pay: goal deficits first, any stocked resource as filler. Null if the bank can't fund two. */
function plentyPicks(state: CatanState, seat: PlayerId): readonly [Resource, Resource] | null {
  const bank = { ...state.bank }
  const picks: Resource[] = []
  for (const r of missingForGoal(state, seat)) {
    while (picks.length < 2 && bank[r] > 0 && (COSTS[buildGoal(state, seat)][r] ?? 0) > state.players[seat]!.resources[r] + picks.filter((p) => p === r).length) {
      picks.push(r); bank[r]--
    }
  }
  for (const r of RESOURCES) while (picks.length < 2 && bank[r] > 0) { picks.push(r); bank[r]-- }
  return picks.length === 2 ? [picks[0]!, picks[1]!] : null
}
