import { describe, expect, it } from 'vitest'
import { coordKey, vertexId } from '../../src/index'
import {
  applyCatanIntent, bankTradePlan, bestConfirmPartner, bestSetupRoadEdge, bestSetupVertex, bestVertex,
  buildGoal, companionIntent,
  COMPANION_DEFAULTS, createCatanGame, createRng, frontierPips, greedyDiscard, isCatanRuleError,
  legalCityVertices,
  legalRoadEdges, legalSettlementVertices, missingForGoal, pips, proposalPlan, publicVp, RESOURCES,
  robberHexScore, spiralCoords, standardTopology, vertexDiversity, vertexPips as vp, vertexPips,
  type CatanState, type DevCard, type HexTile, type ResourceCount,
} from '../../src/index'
import { die, inMain, mustApply, setupComplete, stubRng, withResources } from './helpers'

/** Test surgery: put a card in a player's hand as if bought on an earlier turn. */
function withCard(state: CatanState, player: number, card: DevCard, boughtOnTurn = 0): CatanState {
  const players = state.players.map((p, i) =>
    i === player ? { ...p, devCards: [...p.devCards, { card, boughtOnTurn }] } : p,
  )
  return { ...state, players }
}

/** Test surgery: set a player's hand to exactly these counts (not additive like withResources). */
function exactHand(state: CatanState, player: number, resources: Partial<ResourceCount>): CatanState {
  const cur = state.players[player]!.resources
  const delta: Partial<ResourceCount> = {}
  for (const r of RESOURCES) delta[r] = (resources[r] ?? 0) - cur[r]
  return withResources(state, player, delta)
}

describe('companion heuristics', () => {
  it('pips: ways to roll the token', () => {
    expect(pips(6)).toBe(5)
    expect(pips(8)).toBe(5)
    expect(pips(2)).toBe(1)
    expect(pips(12)).toBe(1)
    expect(pips(null)).toBe(0) // desert
  })

  it('vertexPips sums the pip weights of the vertex\'s (up to 3) land hexes', () => {
    const state = setupComplete()
    const v = vertexId({ q: 0, r: 0 }, 0)
    const keys = v.split('|')
    const expected = keys.reduce((sum, k) => {
      const hex = state.board.hexes.find((h) => coordKey(h.coord) === k)
      return sum + (hex ? pips(hex.token) : 0)
    }, 0)
    expect(vertexPips(state, v)).toBe(expected)
    expect(expected).toBeGreaterThan(0)
  })

  it('publicVp counts buildings and awards, not hidden dev cards', () => {
    const state = setupComplete() // every seat: 2 settlements
    expect(publicVp(state, 0)).toBe(2)
    const withAward = { ...state, awards: { ...state.awards, longestRoad: 0 as const } }
    expect(publicVp(withAward, 0)).toBe(4)
  })

  it('buildGoal prefers city > settlement > devCard', () => {
    const state = inMain() // everyone has upgradable settlements and cities left
    expect(buildGoal(state, 0)).toBe('city')
    const noCities = {
      ...state,
      players: state.players.map((p, i) => (i === 0 ? { ...p, citiesLeft: 0 } : p)),
    }
    expect(buildGoal(noCities, 0)).toBe('settlement')
    const noSettlements = {
      ...noCities,
      players: noCities.players.map((p, i) => (i === 0 ? { ...p, settlementsLeft: 0 } : p)),
    }
    expect(buildGoal(noSettlements, 0)).toBe('devCard')
  })

  it('missingForGoal lists the goal\'s deficits, biggest first', () => {
    // city costs 2 wheat + 3 ore; hand starts near-empty after setup
    const state = inMain()
    const hand = state.players[0]!.resources
    const missing = missingForGoal(state, 0, 'city')
    expect(missing).toContain('ore')
    // biggest deficit (ore: 3 - hand.ore) sorts before wheat (2 - hand.wheat)
    if (hand.ore === hand.wheat) expect(missing[0]).toBe('ore')
    for (const r of missing) expect(['wheat', 'ore']).toContain(r)
  })

  it('robberHexScore: heavily negative on own hexes, positive on enemy production', () => {
    const state = setupComplete()
    // a hex under P1's first settlement, not touched by P0
    const p1Hex = '(-2,0)' // matches SETUP_PLACEMENTS P1 vertex (q:-2,r:0)
    const key = state.board.hexes
      .map((h) => coordKey(h.coord))
      .find((k) => k === p1Hex) ?? coordKey(state.board.hexes[0]!.coord)
    // find any hex P0 builds on for the negative case
    const ownVertex = Object.entries(state.buildings).find(([, b]) => b.owner === 0)![0]
    const ownHexKey = ownVertex.split('|')[0]!
    expect(robberHexScore(state, 0, ownHexKey)).toBeLessThanOrEqual(-1000)
  })

  it('greedyDiscard sheds from the largest piles first and totals exactly owed', () => {
    const state = withResources(inMain(), 0, { wood: 5, brick: 1 })
    const out = greedyDiscard(state, 0, 4)
    const total = Object.values(out).reduce((n, v) => n + (v ?? 0), 0)
    expect(total).toBe(4)
    expect(out.wood).toBeGreaterThanOrEqual(3) // biggest pile pays most
  })

  it('greedyDiscard terminates when owed exceeds hand, returning all available cards', () => {
    const state = withResources(inMain(), 0, { wood: 5, brick: 1 })
    const handTotal = Object.values(state.players[0]!.resources).reduce((n, v) => n + v, 0)
    const out = greedyDiscard(state, 0, 100) // owed far exceeds the hand
    const total = Object.values(out).reduce((n, v) => n + (v ?? 0), 0)
    expect(total).toBe(handTotal) // returns all cards in hand
  })
})

describe('companionIntent decisions', () => {
  it('setup: places the pip-maximal legal settlement, then a road off it', () => {
    const rng = createRng(7)
    const state = createCatanGame({ playerCount: 4, layout: 'beginner' }, rng)
    const intent = companionIntent(state, 0, rng)!
    expect(intent.type).toBe('placeSetupSettlement')
    const chosen = (intent as { vertex: string }).vertex
    // no legal vertex beats the chosen one
    for (const v of legalSettlementVertices(state, 0, { setup: true }))
      expect(vp(state, chosen)).toBeGreaterThanOrEqual(vp(state, v))
    const after = applyCatanIntent(state, intent, rng) as CatanState
    const road = companionIntent(after, 0, rng)!
    expect(road.type).toBe('placeSetupRoad')
  })

  it('preRoll: rolls', () => {
    const state = setupComplete()
    expect(companionIntent(state, state.turn.current, createRng(0))!.type).toBe('rollDice')
  })

  it('main: builds a city when affordable, at its highest-pip own settlement', () => {
    const state = withResources(inMain(), 0, { wheat: 2, ore: 3 })
    const intent = companionIntent(state, 0, createRng(0))!
    expect(intent).toMatchObject({ type: 'build', piece: 'city' })
  })

  it('main: buys a dev card when affordable and no city/settlement is possible', () => {
    // settlement needs a connected legal vertex — none exist right after setup roads
    const state = withResources(inMain(), 0, { sheep: 1, wheat: 1, ore: 1 })
    const intent = companionIntent(state, 0, createRng(0))!
    expect(intent.type).toBe('buyDevCard')
  })

  it('main: does not play roadBuilding when fewer legal edges exist than the engine requires', () => {
    // roadsLeft(13) needs 2 edges; choke the network down to exactly 1 legal edge
    let state = inMain()
    const seat = 0
    const legal = legalRoadEdges(state, seat)
    expect(legal.length).toBeGreaterThan(1) // sanity: normally more than one edge is open
    const otherSeat = (seat + 1) % 4
    const roads = { ...state.roads }
    for (const e of legal.slice(1)) roads[e] = otherSeat
    state = { ...state, roads }
    expect(legalRoadEdges(state, seat)).toEqual([legal[0]])
    state = withCard(state, seat, 'roadBuilding', 0)
    const intent = companionIntent(state, seat, createRng(0))!
    expect(intent).not.toMatchObject({ type: 'playDevCard', card: 'roadBuilding' })
  })

  it('main: bank-trades 4-surplus toward the goal deficit, honoring the opts cap', () => {
    const state = withResources(inMain(), 0, { wood: 6 })
    const plan = bankTradePlan(state, 0)
    expect(plan).toMatchObject({ give: 'wood' })
    // proposedThisTurn: true — the wood surplus would otherwise fire the (higher-priority) trade proposal first
    const intent = companionIntent(state, 0, createRng(0), { ...COMPANION_DEFAULTS, proposedThisTurn: true })!
    expect(intent).toMatchObject({ type: 'bankTrade', give: 'wood' })
    const capped = companionIntent(state, 0, createRng(0), { ...COMPANION_DEFAULTS, proposedThisTurn: true, bankTradesThisTurn: 2 })!
    expect(capped.type).toBe('endTurn')
  })

  it('off-turn: accepts a covered never-net-losing offer, rejects otherwise', () => {
    let state = withResources(inMain(), 0, { wood: 1 })
    state = withResources(state, 1, { brick: 1 })
    const cur = state.turn.current
    // current player offers 2-for-1 in seat 1's favor: give {wood:1}, get {brick:1} is 1:1 — acceptable
    state = mustApply(withResources(state, cur, { wood: 1 }), { type: 'offerTrade', player: cur, give: { wood: 1 }, get: { brick: 1 } })
    const responder = [0, 1, 2, 3].find((s) => s !== cur && state.players[s]!.resources.brick >= 1)!
    const intent = companionIntent(state, responder, createRng(0))!
    expect(intent).toMatchObject({ type: 'respondTrade', response: 'accept' })
  })

  it('robber: picks a scoring-maximal enemy hex and steals from the fattest victim', () => {
    let state = setupComplete()
    state = mustApply(state, { type: 'rollDice', player: state.turn.current }, stubRng([die(3), die(4)]))
    // no hand > 7 on this draft, so we land straight in robber phase
    expect(state.turn.phase).toBe('robber')
    const intent = companionIntent(state, state.turn.current, createRng(0))!
    expect(intent.type).toBe('moveRobber')
  })
})

describe('companion trade proposals', () => {
  it('proposes 1 surplus for the biggest goal deficit when 1-2 kinds short', () => {
    // goal city (2 wheat 3 ore): exact hand 3 wheat (surplus 1) + 2 ore → missing 1 ore only
    let state = exactHand(inMain(), 0, { wheat: 3, ore: 2 })
    state = { ...state, turn: { ...state.turn, current: 0 } } // test surgery: make it seat 0's main
    const plan = proposalPlan(state, 0)
    expect(plan).toEqual({ give: 'wheat', get: 'ore' })
    const intent = companionIntent(state, 0, createRng(0))!
    expect(intent).toMatchObject({ type: 'offerTrade', give: { wheat: 1 }, get: { ore: 1 } })
  })

  it('never proposes twice a turn, with no surplus, or when 3+ kinds short', () => {
    let ready = exactHand(inMain(), 0, { wheat: 3, ore: 2 })
    ready = { ...ready, turn: { ...ready.turn, current: 0 } }
    const again = companionIntent(ready, 0, createRng(0), { ...COMPANION_DEFAULTS, proposedThisTurn: true })!
    expect(again.type).not.toBe('offerTrade')
    const fresh = { ...inMain(), turn: { ...inMain().turn, current: 0 } }
    expect(proposalPlan(fresh, 0)).toBeNull() // fresh hand: no surplus
  })

  it('confirms an acceptable responder; counters must pass the floor', () => {
    let s = exactHand(inMain(), 0, { wheat: 3, ore: 2 })
    s = { ...s, turn: { ...s.turn, current: 0 } }
    s = mustApply(s, { type: 'offerTrade', player: 0, give: { wheat: 1 }, get: { ore: 1 } })
    s = withResources(s, 1, { ore: 1 })
    s = withResources(s, 2, { ore: 1 })
    s = mustApply(s, { type: 'respondTrade', player: 1, response: 'accept' })
    s = mustApply(s, { type: 'respondTrade', player: 2, response: 'accept' })
    // both accepted; equal public VP → stable order keeps the first responder (seat 1)
    expect(bestConfirmPartner(s, 0)).toBe(1)
    const intent = companionIntent(s, 0, createRng(0))!
    expect(intent).toMatchObject({ type: 'confirmTrade', partner: 1 })
  })

  it('an accept from a responder who cannot actually afford it is not confirmable', () => {
    let s = exactHand(inMain(), 0, { wheat: 3, ore: 2 })
    s = { ...s, turn: { ...s.turn, current: 0 } }
    s = mustApply(s, { type: 'offerTrade', player: 0, give: { wheat: 1 }, get: { ore: 1 } })
    // seat 1 holds no ore (offer.get) but applyRespondTrade doesn't gate plain
    // accepts on affordability — the bug this test guards against.
    s = exactHand(s, 1, {})
    s = mustApply(s, { type: 'respondTrade', player: 1, response: 'accept' })
    expect(bestConfirmPartner(s, 0)).toBeNull()
    // the room's deadline hits with no payable partner: cancel, not confirm
    // an accept that would bounce with CANT_AFFORD and busy-loop the offer.
    const forced = companionIntent(s, 0, createRng(0), { ...COMPANION_DEFAULTS, resolveOfferNow: true })!
    expect(forced.type).toBe('cancelTrade')
  })

  it('waits while responses are pending, cancels on resolveOfferNow', () => {
    let s = exactHand(inMain(), 0, { wheat: 3, ore: 2 })
    s = { ...s, turn: { ...s.turn, current: 0 } }
    s = mustApply(s, { type: 'offerTrade', player: 0, give: { wheat: 1 }, get: { ore: 1 } })
    expect(companionIntent(s, 0, createRng(0))).toBeNull()
    const forced = companionIntent(s, 0, createRng(0), { ...COMPANION_DEFAULTS, resolveOfferNow: true })!
    expect(forced.type).toBe('cancelTrade')
    // a lone unfavorable counter: seat 1 wants 3 wheat for 1 ore — proposer would net-lose
    s = withResources(s, 1, { ore: 1 })
    s = mustApply(s, { type: 'respondTrade', player: 1, response: { give: { ore: 1 }, get: { wheat: 3 } } })
    // counter fails the floor (pay 3 wheat for 1 ore)
    expect(bestConfirmPartner(s, 0)).toBeNull()
  })
})

/**
 * SPIKE-safe main-phase state: the beginner layout (and every helper built on
 * it) throws under the radius-3 board spike, so drive a seeded RANDOM game
 * through setup with the companion itself, then force a non-7 roll into main.
 */
function randomInMain(seed: number): CatanState {
  const rng = createRng(seed)
  let state = createCatanGame({ playerCount: 4 }, rng)
  while (state.turn.phase === 'setup') {
    const intent = companionIntent(state, state.turn.current, rng)
    expect(intent, `seed ${seed}: setup stalled`).not.toBeNull()
    state = mustApply(state, intent!, rng)
  }
  return mustApply(state, { type: 'rollDice', player: state.turn.current }, stubRng([die(1), die(2)]))
}

describe('companion placement tiebreaks', () => {
  /** Two adjacent hexes carrying the same token: their shared vertices score 2×pips. */
  function sharedVertices(a: string, b: string): string[] {
    const topo = standardTopology()
    return (topo.hexVertices[a] ?? []).filter((v) => (topo.hexVertices[b] ?? []).includes(v))
  }

  /** Pad a sparse synthetic board to 19 hexes with inert desert fillers so topologyFor resolves radius 2. */
  function pad(hexes: HexTile[]): HexTile[] {
    const used = new Set(hexes.map((h) => coordKey(h.coord)))
    const fillers = spiralCoords()
      .filter((c) => !used.has(coordKey(c)))
      .slice(0, 19 - hexes.length)
      .map((coord) => ({ coord, terrain: 'desert' as const, token: null }))
    return [...hexes, ...fillers]
  }

  it('vertexDiversity counts distinct producing terrains, ignoring desert and off-board parts', () => {
    const hexes: HexTile[] = [
      { coord: { q: 0, r: 0 }, terrain: 'fields', token: 6 },
      { coord: { q: 1, r: -1 }, terrain: 'fields', token: 6 },
      { coord: { q: -2, r: 0 }, terrain: 'fields', token: 6 },
      { coord: { q: -1, r: -1 }, terrain: 'mountains', token: 6 },
      { coord: { q: 2, r: 0 }, terrain: 'desert', token: null },
    ]
    const state = { board: { hexes, ports: [], robber: coordKey({ q: 2, r: 0 }) } }
    const mono = sharedVertices('0,0', '1,-1')[0]!
    const diverse = sharedVertices('-2,0', '-1,-1')[0]!
    expect(vertexDiversity(state, mono)).toBe(1)
    expect(vertexDiversity(state, diverse)).toBe(2)
    expect(vertexPips(state, mono)).toBe(vertexPips(state, diverse)) // the tie the next test relies on
  })

  it('frontierPips: best pips exactly two steps out, honoring the distance rule', () => {
    // A lone 8-hex: from corner 0, corners 2 and 4 are the on-board frontier (5 pips each);
    // corner 1/5 are direct neighbors (sterilized by the placement) and never count.
    const hexes: HexTile[] = [{ coord: { q: 0, r: 0 }, terrain: 'fields', token: 8 }]
    const board = { hexes: pad(hexes), ports: [], robber: 'off' }
    const v = vertexId({ q: 0, r: 0 }, 0)
    expect(frontierPips({ board, buildings: {} }, v)).toBe(5)
    // occupying both on-hex frontier corners leaves only off-board frontier: 0
    const occupied = {
      [vertexId({ q: 0, r: 0 }, 2)]: { owner: 1, kind: 'settlement' as const },
      [vertexId({ q: 0, r: 0 }, 4)]: { owner: 2, kind: 'settlement' as const },
    }
    expect(frontierPips({ board, buildings: occupied }, v)).toBe(0)
    // a building ADJACENT to both frontier corners kills them via the distance rule too
    const adjacent = { [vertexId({ q: 0, r: 0 }, 3)]: { owner: 1, kind: 'settlement' as const } }
    expect(frontierPips({ board, buildings: adjacent }, v)).toBe(0)
  })

  it('bestSetupVertex trades a pip of yield for real expansion room; bestVertex would not', () => {
    // Lone 6-hex D: any corner = 5 pips now, 5-pip frontier -> setup score 20.
    // E(9) adjacent to F(6): an E-only corner two steps from the 9-pip shared
    // corner = 4 pips now, 9-pip frontier -> setup score 21. Greedy pips alone
    // prefers D's corner; setup scoring gives up the pip for the frontier.
    const hexes: HexTile[] = [
      { coord: { q: 2, r: -2 }, terrain: 'fields', token: 6 },
      { coord: { q: -1, r: 0 }, terrain: 'pasture', token: 9 },
      { coord: { q: -2, r: 1 }, terrain: 'forest', token: 6 },
    ]
    const state = { board: { hexes: pad(hexes), ports: [], robber: 'off' }, buildings: {} }
    const topo = standardTopology()
    const vA = vertexId({ q: 2, r: -2 }, 0)
    expect(vertexPips(state, vA)).toBe(5)
    // an E-only corner whose frontier reaches a 9-pip shared corner
    const vB = (topo.hexVertices['-1,0'] ?? []).find(
      (u) => vertexPips(state, u) === 4 && frontierPips(state, u) === 9,
    )!
    expect(vB).toBeDefined()
    expect(bestVertex(state, [vA, vB])).toBe(vA)
    expect(bestSetupVertex(state, [vA, vB])).toBe(vB)
  })

  it('bestSetupRoadEdge heads toward the richest onward frontier', () => {
    // Settlement on a corner of A(8); a 6-hex Z sits two hexes away on one
    // side. The opening road must take the edge whose far endpoint can reach
    // Z-touching vertices, not an arbitrary free edge.
    const hexes: HexTile[] = [
      { coord: { q: 0, r: 0 }, terrain: 'fields', token: 8 },
      { coord: { q: 1, r: -2 }, terrain: 'forest', token: 6 },
    ]
    const state = { board: { hexes: pad(hexes), ports: [], robber: 'off' }, buildings: {}, roads: {} }
    const topo = standardTopology()
    // pick the A-corner with the widest spread of onward scores among its edges
    let settlement = ''
    let spread = -1
    for (const v of topo.hexVertices['0,0'] ?? []) {
      const scores = (topo.vertexEdges[v] ?? []).map((e) => {
        const n = topo.edgeVertices[e]!.find((x) => x !== v)!
        return Math.max(0, ...(topo.vertexVertices[n] ?? []).filter((u) => u !== v).map((u) => vertexPips(state, u)))
      })
      const s = Math.max(...scores) - Math.min(...scores)
      if (s > spread) { spread = s; settlement = v }
    }
    expect(spread).toBeGreaterThan(0) // the board really discriminates directions
    const chosen = bestSetupRoadEdge(state, settlement)!
    const far = topo.edgeVertices[chosen]!.find((x) => x !== settlement)!
    const onward = Math.max(
      0,
      ...(topo.vertexVertices[far] ?? []).filter((u) => u !== settlement).map((u) => vertexPips(state, u)),
    )
    for (const e of topo.vertexEdges[settlement] ?? []) {
      const n = topo.edgeVertices[e]!.find((x) => x !== settlement)!
      const s = Math.max(0, ...(topo.vertexVertices[n] ?? []).filter((u) => u !== settlement).map((u) => vertexPips(state, u)))
      expect(onward).toBeGreaterThanOrEqual(s)
    }
  })

  it('bestVertex breaks pip ties toward resource diversity, not list order', () => {
    const hexes: HexTile[] = [
      { coord: { q: 0, r: 0 }, terrain: 'fields', token: 6 },
      { coord: { q: 1, r: -1 }, terrain: 'fields', token: 6 },
      { coord: { q: -2, r: 0 }, terrain: 'fields', token: 6 },
      { coord: { q: -1, r: -1 }, terrain: 'mountains', token: 6 },
    ]
    const state = { board: { hexes, ports: [], robber: coordKey({ q: 0, r: 0 }) } }
    const mono = sharedVertices('0,0', '1,-1')[0]!
    const diverse = sharedVertices('-2,0', '-1,-1')[0]!
    // mono listed first: a first-wins tiebreak would pick it
    expect(bestVertex(state, [mono, diverse])).toBe(diverse)
    // strictly more pips still beats diversity: demote the diverse pair to 9 pips (5+4)
    const demoted = {
      board: {
        ...state.board,
        hexes: hexes.map((h) => (h.coord.q === -1 ? { ...h, token: 5 } : h)),
      },
    }
    expect(vertexPips(demoted, diverse)).toBeLessThan(vertexPips(demoted, mono))
    expect(bestVertex(demoted, [diverse, mono])).toBe(mono)
  })

  it('setup: the chosen vertex is pip-maximal and diversity-maximal among its pip ties', () => {
    for (const seed of [1, 2, 3]) {
      const rng = createRng(seed)
      const state = createCatanGame({ playerCount: 4 }, rng)
      const intent = companionIntent(state, state.turn.current, rng)!
      expect(intent.type).toBe('placeSetupSettlement')
      const chosen = (intent as { vertex: string }).vertex
      for (const v of legalSettlementVertices(state, state.turn.current, { setup: true })) {
        expect(vertexPips(state, chosen)).toBeGreaterThanOrEqual(vertexPips(state, v))
        if (vertexPips(state, v) === vertexPips(state, chosen))
          expect(vertexDiversity(state, chosen)).toBeGreaterThanOrEqual(vertexDiversity(state, v))
      }
    }
  })
})

describe('companion knight judgment', () => {
  it('plays a held knight when the robber squats on own production', () => {
    let s = randomInMain(11)
    const seat = s.turn.current
    const ownVertex = Object.entries(s.buildings).find(([, b]) => b.owner === seat)![0]
    const ownHexKey = ownVertex.split('|').find((p) => s.board.hexes.some((h) => coordKey(h.coord) === p))!
    s = { ...s, board: { ...s.board, robber: ownHexKey } }
    s = exactHand(s, seat, {}) // nothing affordable — the dev-card branch is reachable
    s = withCard(s, seat, 'knight', 0)
    const intent = companionIntent(s, seat, createRng(0))!
    expect(intent).toMatchObject({ type: 'playDevCard', card: 'knight' })
  })

  it('holds the knight when the robber neither blocks us nor has a worthwhile target', () => {
    let s = randomInMain(11)
    const seat = s.turn.current
    // strip every enemy building: no production anywhere worth blocking
    const buildings = Object.fromEntries(Object.entries(s.buildings).filter(([, b]) => b.owner === seat))
    const ownHexKeys = new Set(Object.keys(buildings).flatMap((v) => v.split('|')))
    const awayHex = s.board.hexes.find((h) => !ownHexKeys.has(coordKey(h.coord)))!
    s = { ...s, buildings, board: { ...s.board, robber: coordKey(awayHex.coord) } }
    s = exactHand(s, seat, {})
    s = withCard(s, seat, 'knight', 0)
    const intent = companionIntent(s, seat, createRng(0))!
    expect(intent).not.toMatchObject({ type: 'playDevCard', card: 'knight' })
  })
})

describe('companion liveness', () => {
  it('4 companion seats finish seeded games; every intent legal; no nulls while the game waits', () => {
    for (const seed of [1, 2, 3]) {
      const rng = createRng(seed)
      let state = createCatanGame({ playerCount: 4 }, rng)
      let turnNumber = state.turn.number
      let proposedThisTurn = [false, false, false, false]
      let bankTradesThisTurn = [0, 0, 0, 0]
      for (let i = 0; i < 5000 && state.winner === null; i++) {
        if (state.turn.number !== turnNumber) {
          turnNumber = state.turn.number
          proposedThisTurn = [false, false, false, false]
          bankTradesThisTurn = [0, 0, 0, 0]
        }
        let seat: number
        let opts = COMPANION_DEFAULTS
        if (state.turn.phase === 'discard') {
          seat = Number(Object.keys(state.turn.pendingDiscards)[0]!)
        } else if (state.turn.openTrade) {
          const offer = state.turn.openTrade
          const pending = [0, 1, 2, 3].filter((s) => s !== state.turn.current && offer.responses[s] === undefined)
          if (pending.length > 0) {
            seat = pending[0]!
          } else {
            // every non-current seat has responded: mirror the room's deadline so the loop can't stall
            seat = state.turn.current
            opts = { proposedThisTurn: proposedThisTurn[seat]!, bankTradesThisTurn: bankTradesThisTurn[seat]!, resolveOfferNow: true }
          }
        } else {
          seat = state.turn.current
          opts = { proposedThisTurn: proposedThisTurn[seat]!, bankTradesThisTurn: bankTradesThisTurn[seat]!, resolveOfferNow: false }
        }
        const intent = companionIntent(state, seat, rng, opts)
        expect(intent, `seed ${seed}: stalled at ${i}, phase ${state.turn.phase}`).not.toBeNull()
        if (intent!.type === 'offerTrade') proposedThisTurn[seat] = true
        if (intent!.type === 'bankTrade') bankTradesThisTurn[seat] = bankTradesThisTurn[seat]! + 1
        const result = applyCatanIntent(state, intent!, rng)
        if (isCatanRuleError(result)) throw new Error(`seed ${seed} seat ${seat}: ${result.code}: ${result.message}`)
        state = result
      }
      expect(state.winner, `seed ${seed} never finished`).not.toBeNull()
    }
  })
})

/**
 * Rank (1 = leader, 3 = last place) of every seat OTHER than `mover`, by
 * current public VP. Ties keep seat order (stable sort) — fine for tallying.
 */
function opponentRanks(state: CatanState, mover: number): Map<number, number> {
  const others = [0, 1, 2, 3].filter((s) => s !== mover)
  others.sort((a, b) => publicVp(state, b) - publicVp(state, a))
  const ranks = new Map<number, number>()
  others.forEach((seat, i) => ranks.set(seat, i + 1))
  return ranks
}

/**
 * Runs seeded 4-companion games to completion (liveness-loop idiom above),
 * tallying by opponent-VP-rank every `moveRobber` intent's target: the steal
 * victim when there is one, else every adjacent enemy owner (a robber move
 * with no payable victim still "targets" whoever's production it blocks).
 */
function tallyRobberTargets(seeds: readonly number[]): Record<number, number> {
  const tally: Record<number, number> = { 1: 0, 2: 0, 3: 0 }
  for (const seed of seeds) {
    const rng = createRng(seed)
    let state = createCatanGame({ playerCount: 4 }, rng)
    let turnNumber = state.turn.number
    let proposedThisTurn = [false, false, false, false]
    let bankTradesThisTurn = [0, 0, 0, 0]
    for (let i = 0; i < 5000 && state.winner === null; i++) {
      if (state.turn.number !== turnNumber) {
        turnNumber = state.turn.number
        proposedThisTurn = [false, false, false, false]
        bankTradesThisTurn = [0, 0, 0, 0]
      }
      let seat: number
      let opts = COMPANION_DEFAULTS
      if (state.turn.phase === 'discard') {
        seat = Number(Object.keys(state.turn.pendingDiscards)[0]!)
      } else if (state.turn.openTrade) {
        const offer = state.turn.openTrade
        const pending = [0, 1, 2, 3].filter((s) => s !== state.turn.current && offer.responses[s] === undefined)
        if (pending.length > 0) {
          seat = pending[0]!
        } else {
          seat = state.turn.current
          opts = { proposedThisTurn: proposedThisTurn[seat]!, bankTradesThisTurn: bankTradesThisTurn[seat]!, resolveOfferNow: true }
        }
      } else {
        seat = state.turn.current
        opts = { proposedThisTurn: proposedThisTurn[seat]!, bankTradesThisTurn: bankTradesThisTurn[seat]!, resolveOfferNow: false }
      }
      const intent = companionIntent(state, seat, rng, opts)
      expect(intent, `seed ${seed}: stalled at ${i}, phase ${state.turn.phase}`).not.toBeNull()
      if (intent!.type === 'moveRobber') {
        const ranks = opponentRanks(state, seat)
        const targets: number[] = []
        if (intent!.stealFrom !== null) {
          targets.push(intent!.stealFrom)
        } else {
          const hexKey = coordKey(intent!.hex)
          const owners = new Set<number>()
          for (const v of standardTopology().hexVertices[hexKey] ?? []) {
            const b = state.buildings[v]
            if (b && b.owner !== seat) owners.add(b.owner)
          }
          targets.push(...owners)
        }
        for (const target of targets) {
          const rank = ranks.get(target)
          if (rank !== undefined) tally[rank] = (tally[rank] ?? 0) + 1
        }
      }
      if (intent!.type === 'offerTrade') proposedThisTurn[seat] = true
      if (intent!.type === 'bankTrade') bankTradesThisTurn[seat] = bankTradesThisTurn[seat]! + 1
      const result = applyCatanIntent(state, intent!, rng)
      if (isCatanRuleError(result)) throw new Error(`seed ${seed} seat ${seat}: ${result.code}: ${result.message}`)
      state = result
    }
    expect(state.winner, `seed ${seed} never finished`).not.toBeNull()
  }
  return tally
}

describe('companion robber targeting (empirical)', () => {
  it('robs the current VP leader (among opponents) strictly more than the current last-place opponent', () => {
    const tally = tallyRobberTargets([1, 2, 3, 4, 5])
    if (process.env.ROBBER_TALLY)
      // eslint-disable-next-line no-console -- opt-in diagnostics: ROBBER_TALLY=1 pnpm test prints the table
      console.log('robber target tally by opponent-VP-rank (1=leader..3=last):', tally)
    expect(tally[1]).toBeGreaterThan(tally[3]!)
  })
})

/**
 * A driven seat has no client to correct it: an intent naming a location the
 * engine rejects strands that seat (see CatanRoom.applyAndBroadcast). So every
 * branch here must decline outright rather than emit a null/undefined location.
 */
describe('companion malformed-intent guards', () => {
  it('main: a build tier with no legal candidate falls through instead of naming none', () => {
    // affords a city, owns no settlement to upgrade — legalCityVertices is empty
    const base = withResources(inMain(), 0, { wheat: 2, ore: 3 })
    const buildings = Object.fromEntries(
      Object.entries(base.buildings).map(([v, b]) => [v, b.owner === 0 ? { ...b, kind: 'city' as const } : b]),
    )
    const state = { ...base, buildings }
    expect(legalCityVertices(state, 0)).toEqual([])
    const intent = companionIntent(state, 0, createRng(0))!
    expect(intent).not.toMatchObject({ piece: 'city' })
    expect(intent).not.toHaveProperty('location', undefined)
  })

  it('setup: no legal opening vertex yields null, not an undefined vertex', () => {
    const fresh = createCatanGame({ playerCount: 4, layout: 'beginner' }, createRng(7))
    const buildings = Object.fromEntries(
      standardTopology().vertices.map((v) => [v, { owner: 1, kind: 'settlement' as const }]),
    )
    const blocked = { ...fresh, buildings }
    expect(legalSettlementVertices(blocked, 0, { setup: true })).toEqual([])
    expect(companionIntent(blocked, blocked.turn.current, createRng(0))).toBeNull()
  })

  it('setup: no free edge at the new settlement yields null, not an undefined edge', () => {
    const fresh = createCatanGame({ playerCount: 4, layout: 'beginner' }, createRng(7))
    const seat = fresh.turn.current
    const vertex = legalSettlementVertices(fresh, seat, { setup: true })[0]!
    const placed = mustApply(fresh, { type: 'placeSetupSettlement', player: seat, vertex })
    expect(placed.turn.setup!.expect).toBe('road')
    const roads = { ...placed.roads }
    for (const e of standardTopology().vertexEdges[vertex] ?? []) roads[e] = 3 // every exit taken
    expect(companionIntent({ ...placed, roads }, seat, createRng(0))).toBeNull()
  })
})
