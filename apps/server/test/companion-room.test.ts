import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { boot, type ColyseusTestServer } from '@colyseus/testing'
import appConfig from '../src/app.config'
import { MSG, type CatanSnapshotPayload, type CatanClientIntent } from '@meridian/protocol'
import { coordKey, legalSettlementVertices, standardTopology, vertexId, edgeId, type CatanClientState } from '@meridian/rules'

let server: ColyseusTestServer
beforeAll(async () => { server = await boot(appConfig) })
afterAll(async () => { await server.shutdown() })
afterEach(async () => { await server.cleanup() })

async function settle(ms = 120): Promise<void> { await new Promise((r) => setTimeout(r, ms)) }

const FAST = { pilotDelayMs: 0, botDelayMs: 0, seed: 1 }

const RESOURCES = ['wood', 'brick', 'sheep', 'wheat', 'ore'] as const

/**
 * Mirrors the server's `pilotIntent` caretaker (mandatory-only choices), but
 * driven from a human seat's redacted view instead of full server state, and
 * with trade offers deliberately ignored — proving the offer window, not a
 * responsive human, is what resolves a bot's open trade.
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

  it('a bot trade offer resolves within the offer window even if the human never responds', async () => {
    const c = await server.sdk.joinOrCreate('catan', {
      players: 4, bots: 3, pilotDelayMs: 0, botDelayMs: 0, offerWindowMs: 150, seed: 5, targetVp: 4,
    })
    const sink: CatanSnapshotPayload[] = []
    c.onMessage(MSG.SNAPSHOT, (p: CatanSnapshotPayload) => sink.push(p))
    c.onMessage('*', () => undefined)
    await settle()
    let sawBotOffer = false
    let lastActedSeq = -1
    for (let i = 0; i < 400; i++) {
      const view = sink.at(-1)?.view
      if (!view) break
      if (view.winner !== null) break
      if (view.turn.openTrade && view.turn.current !== 0) sawBotOffer = true
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
  })
})
