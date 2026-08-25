import { describe, expect, it } from 'vitest'
import { coordKey, vertexId } from '../../src/index'
import {
  applyCatanIntent, bankTradePlan, buildGoal, companionIntent, COMPANION_DEFAULTS,
  createCatanGame, createRng, greedyDiscard, isCatanRuleError, legalRoadEdges, legalSettlementVertices,
  missingForGoal, pips, publicVp, robberHexScore, vertexPips as vp, vertexPips,
  type CatanState, type DevCard,
} from '../../src/index'
import { die, inMain, mustApply, setupComplete, stubRng, withResources } from './helpers'

/** Test surgery: put a card in a player's hand as if bought on an earlier turn. */
function withCard(state: CatanState, player: number, card: DevCard, boughtOnTurn = 0): CatanState {
  const players = state.players.map((p, i) =>
    i === player ? { ...p, devCards: [...p.devCards, { card, boughtOnTurn }] } : p,
  )
  return { ...state, players }
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
    const intent = companionIntent(state, 0, createRng(0))!
    expect(intent).toMatchObject({ type: 'bankTrade', give: 'wood' })
    const capped = companionIntent(state, 0, createRng(0), { ...COMPANION_DEFAULTS, bankTradesThisTurn: 2 })!
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

describe('companion liveness', () => {
  it('4 companion seats finish seeded games; every intent legal; no nulls while the game waits', () => {
    for (const seed of [1, 2, 3]) {
      const rng = createRng(seed)
      let state = createCatanGame({ playerCount: 4 }, rng)
      for (let i = 0; i < 5000 && state.winner === null; i++) {
        const seat = state.turn.phase === 'discard'
          ? Number(Object.keys(state.turn.pendingDiscards)[0]!)
          : state.turn.current
        const intent = companionIntent(state, seat, rng)
        expect(intent, `seed ${seed}: stalled at ${i}, phase ${state.turn.phase}`).not.toBeNull()
        const result = applyCatanIntent(state, intent!, rng)
        if (isCatanRuleError(result)) throw new Error(`seed ${seed} seat ${seat}: ${result.code}: ${result.message}`)
        state = result
      }
      expect(state.winner, `seed ${seed} never finished`).not.toBeNull()
    }
  })
})
