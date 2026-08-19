import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { boot, type ColyseusTestServer } from '@colyseus/testing'
import type { Room as ClientRoom } from 'colyseus.js'
import appConfig from '../src/app.config'
import { MSG, type CatanClientIntent, type CatanSnapshotPayload } from '@meridian/protocol'
import {
  coordKey,
  COSTS,
  hasResources,
  legalCityVertices,
  legalRoadEdges,
  legalSettlementVertices,
  RESOURCES,
  standardTopology,
  type CatanClientState,
} from '@meridian/rules'
import { expectRedactedFor } from './redaction-helpers'

let server: ColyseusTestServer
beforeAll(async () => {
  server = await boot(appConfig)
})
afterAll(async () => {
  await server.shutdown()
})
afterEach(async () => {
  await server.cleanup()
})

const MAX_INTENTS = 6000

/**
 * Mirror of the engine test bot (rules botIntent), decision-for-decision,
 * operating on a redacted view. botIntent reads nothing but public info +
 * the acting seat's own hand, so a view-driven ws match with seed N replays
 * the engine-only match of the same seed move-for-move.
 * Returns null when this seat need not act.
 */
function viewIntent(view: CatanClientState): CatanClientIntent | null {
  const t = view.turn
  const seat = view.you.seat
  const topo = standardTopology()

  if (t.phase === 'discard') {
    const owedSeat = Number(Object.keys(t.pendingDiscards)[0]!)
    if (owedSeat !== seat) return null
    let owed = t.pendingDiscards[seat]!
    const hand = { ...view.you.resources }
    const resources: Partial<Record<(typeof RESOURCES)[number], number>> = {}
    for (const r of RESOURCES) {
      const n = Math.min(hand[r], owed)
      if (n > 0) resources[r] = n
      owed -= n
      if (owed === 0) break
    }
    return { type: 'discard', resources }
  }

  if (t.current !== seat) return null

  if (t.phase === 'setup') {
    if (t.setup!.expect === 'settlement') {
      const spots = legalSettlementVertices(view, seat, { setup: true })
      return { type: 'placeSetupSettlement', vertex: spots[0]! }
    }
    const settlement = t.setup!.lastSettlement!
    const edge = (topo.vertexEdges[settlement] ?? []).find((e) => view.roads[e] === undefined)!
    return { type: 'placeSetupRoad', edge }
  }

  if (t.phase === 'robber') {
    const hex = view.board.hexes.find(
      (h) =>
        coordKey(h.coord) !== view.board.robber &&
        !(topo.hexVertices[coordKey(h.coord)] ?? []).some((v) => view.buildings[v]?.owner === seat),
    )!
    const key = coordKey(hex.coord)
    const victim = view.players.findIndex(
      (pl, i) =>
        i !== seat &&
        pl.resourceCount > 0 &&
        (topo.hexVertices[key] ?? []).some((v) => view.buildings[v]?.owner === i),
    )
    return { type: 'moveRobber', hex: hex.coord, stealFrom: victim === -1 ? null : victim }
  }

  if (t.phase === 'preRoll') return { type: 'rollDice' }

  // main phase — same greedy priorities as botIntent
  const me = view.players[seat]!
  const hand = view.you.resources
  if (hasResources(hand, COSTS.city) && me.citiesLeft > 0) {
    const spots = legalCityVertices(view, seat)
    if (spots.length) return { type: 'build', piece: 'city', location: spots[0]! }
  }
  if (hasResources(hand, COSTS.settlement) && me.settlementsLeft > 0) {
    const spots = legalSettlementVertices(view, seat)
    if (spots.length) return { type: 'build', piece: 'settlement', location: spots[0]! }
  }
  if (hasResources(hand, COSTS.devCard) && view.devDeckCount > 0) return { type: 'buyDevCard' }
  if (!t.devPlayed && view.you.devCards.some((c) => c.card === 'knight' && c.boughtOnTurn < t.number))
    return { type: 'playDevCard', card: 'knight' }
  if (hasResources(hand, COSTS.road) && me.roadsLeft > 0) {
    const spots = legalRoadEdges(view, seat)
    if (spots.length) return { type: 'build', piece: 'road', location: spots[0]! }
  }
  return { type: 'endTurn' }
}

async function runMatch(players: 3 | 4, seed: number) {
  const clients: ClientRoom[] = []
  const views: (CatanClientState | null)[] = Array(players).fill(null)
  let snapshots = 0
  let ended: { winner: number } | null = null

  const c0 = await server.sdk.joinOrCreate('catan', { players, seed, pilotDelayMs: 0 })
  clients.push(c0)
  for (let i = 1; i < players; i++) clients.push(await server.sdk.joinById(c0.roomId, {}))
  clients.forEach((c, seat) => {
    c.onMessage(MSG.SNAPSHOT, (p: CatanSnapshotPayload) => {
      snapshots++
      expectRedactedFor(p, seat) // EVERY snapshot every client receives is leak-checked
      views[seat] = p.view
    })
    c.onMessage(MSG.MATCH_ENDED, (p: { winner: number }) => {
      ended = p
    })
    c.onMessage('*', () => undefined)
  })

  for (let i = 0; i < MAX_INTENTS && !ended; i++) {
    await new Promise((r) => setTimeout(r, 2))
    if (ended) break
    for (let seat = 0; seat < players; seat++) {
      const view = views[seat]
      if (!view) continue
      const intent = viewIntent(view)
      if (intent) {
        const seqBefore = view.seq
        clients[seat]!.send(MSG.INTENT, intent)
        // wait for the state to advance before deciding again
        for (let w = 0; w < 500 && views[seat]!.seq === seqBefore && !ended; w++)
          await new Promise((r) => setTimeout(r, 2))
        expect(
          ended !== null || views[seat]!.seq,
          `seat ${seat} intent ${intent.type} did not advance seq ${seqBefore}`,
        ).not.toBe(seqBefore)
        break
      }
    }
  }
  expect(ended).not.toBeNull()
  expect(snapshots).toBeGreaterThan(0)
  return ended! as { winner: number }
}

describe('full matches over ws', () => {
  it('4 players, seed 2: plays to a win, every snapshot redaction-checked', async () => {
    const result = await runMatch(4, 2)
    expect(result.winner).toBeGreaterThanOrEqual(0)
  }, 240_000)

  // seed pinned by headless search: 3p seeds 1-2 stall past the cap; seed 3
  // reaches a 10-VP win in 586 intents
  it('3 players, seed 3: plays to a win, every snapshot redaction-checked', async () => {
    const result = await runMatch(3, 3)
    expect(result.winner).toBeGreaterThanOrEqual(0)
  }, 240_000)
})
