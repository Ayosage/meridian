import { describe, expect, it } from 'vitest'
import {
  affordable,
  applyCatanIntent,
  coordKey,
  createCatanGame,
  createRng,
  isCatanRuleError,
  legalCityVertices,
  legalRoadEdges,
  legalSettlementVertices,
  RESOURCES,
  standardTopology,
  totalResources,
  victoryPoints,
  type CatanIntent,
  type CatanState,
  type Rng,
} from '../../src/index'

const MAX_INTENTS = 5000
const SEEDS = [1, 2, 3, 4, 5]

function assertInvariants(state: CatanState): void {
  for (const r of RESOURCES) {
    const total = state.bank[r] + state.players.reduce((s, p) => s + p.resources[r], 0)
    expect(total).toBe(19)
    expect(state.bank[r]).toBeGreaterThanOrEqual(0)
    for (const p of state.players) expect(p.resources[r]).toBeGreaterThanOrEqual(0)
  }
  for (const p of state.players) {
    expect(p.roadsLeft).toBeGreaterThanOrEqual(0)
    expect(p.settlementsLeft).toBeGreaterThanOrEqual(0)
    expect(p.citiesLeft).toBeGreaterThanOrEqual(0)
  }
  const devTotal =
    state.devDeck.length +
    state.players.reduce((s, p) => s + p.devCards.length, 0) +
    state.players.reduce((s, p) => s + p.knightsPlayed, 0)
  expect(devTotal).toBeLessThanOrEqual(25) // played non-knights leave the game; knights are tracked
}

/** One deterministic bot decision for whoever must act. */
function nextIntent(state: CatanState): CatanIntent {
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

function playGame(seed: number): CatanState {
  const rng: Rng = createRng(seed)
  let state = createCatanGame({ playerCount: 4, layout: 'random' }, rng)
  let prevSeq = state.seq
  for (let i = 0; i < MAX_INTENTS && state.winner === null; i++) {
    const intent = nextIntent(state)
    const result = applyCatanIntent(state, intent, rng)
    if (isCatanRuleError(result))
      throw new Error(`bot generated illegal ${intent.type}: ${result.code} ${result.message}`)
    expect(result.seq).toBe(prevSeq + 1)
    prevSeq = result.seq
    assertInvariants(result)
    state = result
  }
  return state
}

describe('full seeded 4-player games', () => {
  it('bots play complete legal games; at least one seed reaches a 10-VP win', () => {
    let wins = 0
    for (const seed of SEEDS) {
      const state = playGame(seed)
      if (state.winner !== null) {
        wins++
        expect(state.turn.phase).toBe('ended')
        expect(victoryPoints(state, state.winner, { includeHidden: true })).toBeGreaterThanOrEqual(10)
        expect(victoryPoints(state, state.winner, { includeHidden: true })).toBeLessThanOrEqual(12) // sanity: no runaway scoring
      }
    }
    expect(wins).toBeGreaterThanOrEqual(1)
  })

  it('the same seed replays to the identical final state', () => {
    const a = playGame(SEEDS[0]!)
    const b = playGame(SEEDS[0]!)
    expect(a).toEqual(b)
  })
})
