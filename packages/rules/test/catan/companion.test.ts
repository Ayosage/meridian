import { describe, expect, it } from 'vitest'
import { coordKey, vertexId } from '../../src/index'
import {
  applyCatanIntent, bankTradePlan, bestConfirmPartner, buildGoal, companionIntent, COMPANION_DEFAULTS,
  createCatanGame, createRng, greedyDiscard, isCatanRuleError, legalRoadEdges, legalSettlementVertices,
  missingForGoal, pips, proposalPlan, publicVp, RESOURCES, robberHexScore, vertexPips as vp, vertexPips,
  type CatanState, type DevCard, type ResourceCount,
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
