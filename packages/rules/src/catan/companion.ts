import { coordKey } from '../coord'
import type { PlayerId } from '../state'
import { COSTS } from './data'
import type { CatanState } from './state'
import { standardTopology, type VertexId } from './topology'
import { RESOURCES, type Resource, type ResourceCount } from './types'

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

/** Shed from the largest piles first; ties broken in RESOURCES order. (Moved from apps/server pilot.ts — Task 2 dedupes.) */
export function greedyDiscard(state: CatanState, seat: PlayerId, owed: number): Partial<ResourceCount> {
  const hand = { ...state.players[seat]!.resources }
  const out: Partial<ResourceCount> = {}
  let remaining = owed
  while (remaining > 0) {
    let best: Resource = RESOURCES[0]!
    for (const r of RESOURCES) if (hand[r] > hand[best]) best = r
    const take = Math.min(hand[best], remaining)
    out[best] = (out[best] ?? 0) + take
    hand[best] -= take
    remaining -= take
  }
  return out
}
