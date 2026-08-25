import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { boot, type ColyseusTestServer } from '@colyseus/testing'
import appConfig from '../src/app.config'
import { MSG, type CatanSnapshotPayload } from '@meridian/protocol'
import { vertexId, edgeId } from '@meridian/rules'

let server: ColyseusTestServer
beforeAll(async () => { server = await boot(appConfig) })
afterAll(async () => { await server.shutdown() })
afterEach(async () => { await server.cleanup() })

async function settle(ms = 120): Promise<void> { await new Promise((r) => setTimeout(r, ms)) }

const FAST = { pilotDelayMs: 0, botDelayMs: 0, seed: 1 }

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
})
