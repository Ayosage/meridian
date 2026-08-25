import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { boot, type ColyseusTestServer } from '@colyseus/testing'
import appConfig from '../src/app.config'
import { MSG, type CatanSnapshotPayload, type CatanClientIntent } from '@meridian/protocol'
import { coordKey, legalSettlementVertices, standardTopology, vertexId, edgeId, type CatanClientState } from '@meridian/rules'

let server: ColyseusTestServer
beforeAll(async () => { server = await boot(appConfig) })
afterAll(async () => { await server.shutdown() })
afterEach(async () => { await server.cleanup() })

async function settle(ms = 120): Promise<void> { await new Promise((r) => setTimeout(r, ms)) }

/** Poll until cond() holds (deadline 3s) — avoids brittle fixed sleeps. Matches catan-reclaim.test.ts's idiom. */
async function waitFor(cond: () => boolean): Promise<void> {
  for (let i = 0; i < 300 && !cond(); i++) await settle(10)
  expect(cond()).toBe(true)
}

const FAST = { pilotDelayMs: 0, botDelayMs: 0, seed: 1 }

const RESOURCES = ['wood', 'brick', 'sheep', 'wheat', 'ore'] as const

/**
 * Mirrors the server's `pilotIntent` caretaker (mandatory-only choices), but
 * driven from a human seat's redacted view instead of full server state.
 * Deliberately never sends `respondTrade`, so any bot offer this seat is
 * asked to answer goes unanswered — the human is a bystander to trades.
 */
function humanScriptIntent(view: CatanClientState): CatanClientIntent | null {
  const seat = 0
  const t = view.turn

  const owed = t.pendingDiscards[seat]
  if (t.phase === 'discard' && owed) {
    const hand = { ...view.you.resources }
    const out: Partial<Record<(typeof RESOURCES)[number], number>> = {}
    let remaining = owed
    while (remaining > 0) {
      let best: (typeof RESOURCES)[number] = RESOURCES[0]
      for (const r of RESOURCES) if (hand[r] > hand[best]) best = r
      const take = Math.min(hand[best], remaining)
      if (take === 0) break
      out[best] = (out[best] ?? 0) + take
      hand[best] -= take
      remaining -= take
    }
    return { type: 'discard', resources: out }
  }

  if (t.current !== seat) return null // never respond to trades or act off-turn

  switch (t.phase) {
    case 'setup': {
      if (t.setup!.expect === 'settlement') {
        const spots = legalSettlementVertices(view, seat, { setup: true })
        return { type: 'placeSetupSettlement', vertex: spots[0]! }
      }
      const topo = standardTopology()
      const settlement = t.setup!.lastSettlement!
      const edge = (topo.vertexEdges[settlement] ?? []).find((e) => view.roads[e] === undefined)!
      return { type: 'placeSetupRoad', edge }
    }
    case 'preRoll':
      return { type: 'rollDice' }
    case 'robber': {
      const topo = standardTopology()
      const hex = view.board.hexes.find((h) => coordKey(h.coord) !== view.board.robber)!.coord
      const key = coordKey(hex)
      const victims = view.players
        .map((_, i) => i)
        .filter(
          (i) =>
            i !== seat &&
            view.players[i]!.resourceCount > 0 &&
            (topo.hexVertices[key] ?? []).some((v) => view.buildings[v]?.owner === i),
        )
      return { type: 'moveRobber', hex, stealFrom: victims[0] ?? null }
    }
    case 'main':
      if (t.openTrade) return { type: 'cancelTrade' }
      return { type: 'endTurn' }
    default:
      return null
  }
}

describe('CatanRoom with native bots', () => {
  it('players:4 bots:3 starts on the creator alone, bots in trailing seats', async () => {
    const c = await server.sdk.joinOrCreate('catan', { players: 4, bots: 3, ...FAST })
    const sink: CatanSnapshotPayload[] = []
    c.onMessage(MSG.SNAPSHOT, (p: CatanSnapshotPayload) => sink.push(p))
    c.onMessage('*', () => undefined)
    await settle()
    expect(sink.length).toBeGreaterThan(0)
    expect(sink.at(-1)!.view.playerCount).toBe(4)
    expect(c.state.botCount).toBe(3)
    expect(Array.from(c.state.seats)).toEqual([c.sessionId, 'bot-1', 'bot-2', 'bot-3'])
  })

  it('players:4 bots:2 waits for a second human, then starts', async () => {
    const c0 = await server.sdk.joinOrCreate('catan', { players: 4, bots: 2, ...FAST })
    await settle(60)
    expect(c0.state.phase).toBe('waiting')
    const c1 = await server.sdk.joinById(c0.roomId, {})
    const sink: CatanSnapshotPayload[] = []
    c1.onMessage(MSG.SNAPSHOT, (p: CatanSnapshotPayload) => sink.push(p))
    c1.onMessage('*', () => undefined)
    c0.onMessage('*', () => undefined)
    await settle()
    expect(sink.at(-1)!.view.playerCount).toBe(4)
  })

  it('rejects bad bot counts', async () => {
    await expect(server.sdk.joinOrCreate('catan', { players: 4, bots: 4, ...FAST })).rejects.toThrow()
    await expect(server.sdk.joinOrCreate('catan', { players: 3, bots: -1, ...FAST })).rejects.toThrow()
    await expect(server.sdk.joinOrCreate('catan', { players: 3, bots: 1.5, ...FAST })).rejects.toThrow()
  })

  it('bots play: after the human places setup pieces, bot seats place theirs unprompted', async () => {
    const c = await server.sdk.joinOrCreate('catan', { players: 4, bots: 3, ...FAST, layout: 'beginner' })
    const sink: CatanSnapshotPayload[] = []
    c.onMessage(MSG.SNAPSHOT, (p: CatanSnapshotPayload) => sink.push(p))
    c.onMessage('*', () => undefined)
    await settle()
    const view = sink.at(-1)!.view
    expect(view.turn.current).toBe(0) // human is host seat 0, acts first in setup
    const vertex = vertexId({ q: 2, r: 0 }, 0)
    c.send(MSG.INTENT, { type: 'placeSetupSettlement', vertex })
    c.send(MSG.INTENT, { type: 'placeSetupRoad', edge: edgeId({ q: 2, r: 0 }, 0) })
    await settle(400) // bots 1-3 place snake-draft first picks
    const after = sink.at(-1)!.view
    expect(Object.keys(after.buildings).length).toBeGreaterThanOrEqual(4)
  })

  it('a rejected driven-seat intent re-arms the room instead of freezing the match', async () => {
    const c = await server.sdk.joinOrCreate('catan', { players: 4, bots: 3, ...FAST, layout: 'beginner' })
    const sink: CatanSnapshotPayload[] = []
    c.onMessage(MSG.SNAPSHOT, (p: CatanSnapshotPayload) => sink.push(p))
    c.onMessage('*', () => undefined)
    await settle()

    // Poison exactly one *dispatched* driven intent (the probe in
    // nextDrivenSeat passes its own stub rng, so identity tells them apart) —
    // the seat still looks driveable, but what it sends is illegal.
    const room = server.getRoomById(c.roomId) as unknown as {
      rng: unknown
      drivenIntent(seat: number, rng: unknown): unknown
    }
    const real = room.drivenIntent.bind(room)
    let poisoned = false
    room.drivenIntent = (seat, rng) => {
      if (!poisoned && rng === room.rng) {
        poisoned = true
        return { type: 'build', player: seat, piece: 'settlement', location: 'no-such-vertex' }
      }
      return real(seat, rng)
    }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    c.send(MSG.INTENT, { type: 'placeSetupSettlement', vertex: vertexId({ q: 2, r: 0 }, 0) })
    c.send(MSG.INTENT, { type: 'placeSetupRoad', edge: edgeId({ q: 2, r: 0 }, 0) })
    await settle(400)

    expect(poisoned).toBe(true) // the bogus intent really was dispatched
    // the bots carried on: without the re-arm nothing would ever fire again
    expect(Object.keys(sink.at(-1)!.view.buildings).length).toBeGreaterThanOrEqual(4)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('driven seat'))
    warn.mockRestore()
  })

  it('a bot trade offer resolves within the offer window even if the human never responds', async () => {
    const c = await server.sdk.joinOrCreate('catan', {
      players: 4, bots: 3, pilotDelayMs: 0, botDelayMs: 0, offerWindowMs: 150, seed: 6, targetVp: 4,
    })
    const sink: CatanSnapshotPayload[] = []
    c.onMessage(MSG.SNAPSHOT, (p: CatanSnapshotPayload) => sink.push(p))
    c.onMessage('*', () => undefined)
    await settle()
    let sawBotOffer = false
    // A bot offer can also close because `companionIntent`'s own
    // `bestConfirmPartner` found an accept/confirmable-counter and the
    // proposer confirmed on its own — that path never touches the window.
    // To prove the *window* (not a fast co-bot response) is what closed an
    // offer, track the last-seen responses map for each open bot offer: a
    // close with no accept and no counter among those responses (rejects
    // only, or nobody answered) is unconfirmable by `bestConfirmPartner`, so
    // it can only have ended via the window's forced `cancelTrade`.
    let sawWindowResolvedOffer = false
    let lastBotOfferResponses: NonNullable<CatanClientState['turn']['openTrade']>['responses'] | null = null
    let lastActedSeq = -1
    for (let i = 0; i < 400; i++) {
      const view = sink.at(-1)?.view
      if (!view) break
      if (view.winner !== null) break
      if (view.turn.openTrade && view.turn.current !== 0) {
        sawBotOffer = true
        lastBotOfferResponses = view.turn.openTrade.responses
      } else if (lastBotOfferResponses !== null) {
        const responses = Object.values(lastBotOfferResponses)
        if (responses.every((r) => r.kind !== 'accept' && r.kind !== 'counter')) sawWindowResolvedOffer = true
        lastBotOfferResponses = null
      }
      // never answer offers: the window must resolve them, without duplicate
      // intents for a snapshot we already acted on
      if (view.seq !== lastActedSeq) {
        const intent = humanScriptIntent(view)
        if (intent) {
          c.send(MSG.INTENT, intent)
          lastActedSeq = view.seq
        }
      }
      await settle(30)
    }
    expect(sink.at(-1)!.view.winner).not.toBeNull()
    expect(sawBotOffer).toBe(true)
    expect(sawWindowResolvedOffer).toBe(true)
  })

  it('resolves a bot offer as soon as every seat has answered, without idling out the window', async () => {
    // A wide window (5s) against a fast bot delay: if the room waits the whole
    // window even once nobody is left to answer, the close lands ~5s after the
    // last response instead of one bot delay after it.
    const c = await server.sdk.joinOrCreate('catan', {
      players: 4, bots: 3, pilotDelayMs: 0, botDelayMs: 20, offerWindowMs: 5_000, seed: 6, targetVp: 4,
    })
    const sink: CatanSnapshotPayload[] = []
    c.onMessage(MSG.SNAPSHOT, (p: CatanSnapshotPayload) => sink.push(p))
    c.onMessage('*', () => undefined)
    await settle()

    let allAnsweredAt: number | null = null
    let lastResponses: NonNullable<CatanClientState['turn']['openTrade']>['responses'] | null = null
    let idleMs: number | null = null
    let lastActedSeq = -1

    for (let i = 0; i < 600; i++) {
      const view = sink.at(-1)?.view
      if (!view) break
      if (view.winner !== null) break
      const offer = view.turn.openTrade
      if (offer && view.turn.current !== 0) {
        lastResponses = offer.responses
        const everyoneAnswered = [0, 1, 2, 3].every(
          (seat) => seat === view.turn.current || offer.responses[seat] !== undefined,
        )
        if (everyoneAnswered) allAnsweredAt ??= Date.now()
        // this seat answers promptly — the point is what the room does *after*
        // the last outstanding response lands
        if (offer.responses[0] === undefined && view.seq !== lastActedSeq) {
          c.send(MSG.INTENT, { type: 'respondTrade', response: 'reject' })
          lastActedSeq = view.seq
        }
      } else if (allAnsweredAt !== null) {
        // Only measure offers that ended in the forced cancel: an accept or a
        // confirmable counter closes via `bestConfirmPartner` on its own and
        // never consults the window (see the test above).
        const responses = Object.values(lastResponses ?? {})
        if (responses.every((r) => r.kind !== 'accept' && r.kind !== 'counter')) {
          idleMs = Date.now() - allAnsweredAt
          break
        }
        allAnsweredAt = null
        lastResponses = null
      }
      if (view.seq !== lastActedSeq) {
        const intent = humanScriptIntent(view)
        if (intent) {
          c.send(MSG.INTENT, intent)
          lastActedSeq = view.seq
        }
      }
      await settle(25)
    }

    expect(idleMs).not.toBeNull()
    expect(idleMs!).toBeLessThan(1_000)
  })

  it('a solo human vs bots room pauses when the human disconnects and resumes bots on reclaim', async () => {
    const c = await server.sdk.joinOrCreate('catan', {
      players: 4, bots: 3, pilotDelayMs: 0, botDelayMs: 30, layout: 'beginner', seed: 6,
    })
    const sink: CatanSnapshotPayload[] = []
    c.onMessage(MSG.SNAPSHOT, (p: CatanSnapshotPayload) => sink.push(p))
    c.onMessage('*', () => undefined)
    await settle()

    // Reach into the server-side room (same idiom as the poison test above):
    // once the human's socket closes below, no more snapshots reach IT, so
    // pause/resume must be observed on the room's own authoritative game
    // state instead of the (now-disconnected) client's sink.
    const room = server.getRoomById(c.roomId) as unknown as {
      game: { seq: number; turn: { current: number }; buildings: Record<string, unknown> } | null
    }

    // human (host, seat 0) plays its first setup action
    c.send(MSG.INTENT, { type: 'placeSetupSettlement', vertex: vertexId({ q: 2, r: 0 }, 0) })
    c.send(MSG.INTENT, { type: 'placeSetupRoad', edge: edgeId({ q: 2, r: 0 }, 0) })
    // bots 1-3 place their forward-round setup picks unprompted
    await waitFor(() => Object.keys(room.game?.buildings ?? {}).length >= 4)
    expect(room.game!.turn.current).not.toBe(0) // the bots' backward round is still to come
    const seqBeforeDrop = room.game!.seq

    const token = c.reconnectionToken
    await c.leave(true) // consented drop; CatanRoom's onLeave always allows reconnection (spec §4)
    await settle(30)

    // Paused: humansConnected() === 0, so schedulePilot refuses to drive any
    // bot seat even though whole rounds of bot-only setup turns remain.
    await settle(150) // a few bot delay periods (30ms each)
    expect(room.game!.seq).toBe(seqBeforeDrop)

    const c2 = await server.sdk.reconnect(token)
    const sink2: CatanSnapshotPayload[] = []
    c2.onMessage(MSG.SNAPSHOT, (p: CatanSnapshotPayload) => sink2.push(p))
    c2.onMessage('*', () => undefined)
    await waitFor(() => sink2.length > 0)
    expect(sink2.at(-1)!.view.you.seat).toBe(0) // seat restored, snapshot arrived

    await waitFor(() => room.game!.seq > seqBeforeDrop) // bots resume driving
  })
})
