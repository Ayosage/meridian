import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { boot, type ColyseusTestServer } from '@colyseus/testing'
import type { Room as ClientRoom } from 'colyseus.js'
import appConfig from '../src/app.config'
import { MSG, type CatanSnapshotPayload } from '@meridian/protocol'
import { vertexId } from '@meridian/rules'

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

import { expectRedactedFor } from './redaction-helpers'

function collectSnapshots(client: ClientRoom, sink: CatanSnapshotPayload[]): void {
  client.onMessage(MSG.SNAPSHOT, (p: CatanSnapshotPayload) => sink.push(p))
  client.onMessage('*', () => undefined)
}

function nextMessage<T>(client: ClientRoom, type: string): Promise<T> {
  return new Promise((resolve) => client.onMessage(type, (payload: T) => resolve(payload)))
}

async function settle(ms = 50): Promise<void> {
  await new Promise((r) => setTimeout(r, ms))
}

async function seatClients(n: 3 | 4, options: Record<string, unknown> = {}) {
  const clients: ClientRoom[] = []
  const snapshots: CatanSnapshotPayload[][] = []
  const first = await server.sdk.joinOrCreate('catan', { players: n, pilotDelayMs: 0, seed: 1, ...options })
  clients.push(first)
  snapshots.push([])
  collectSnapshots(first, snapshots[0]!)
  for (let i = 1; i < n; i++) {
    const c = await server.sdk.joinById(first.roomId, {})
    clients.push(c)
    snapshots.push([])
    collectSnapshots(c, snapshots[i]!)
  }
  await settle()
  return { clients, snapshots, roomId: first.roomId }
}

describe('CatanRoom lobby and intent loop', () => {
  it('starts automatically when full and sends each seat a redacted setup snapshot', async () => {
    const { snapshots } = await seatClients(4)
    for (let seat = 0; seat < 4; seat++) {
      expect(snapshots[seat]!.length).toBeGreaterThan(0)
      const snap = snapshots[seat]!.at(-1)!
      expectRedactedFor(snap, seat)
      expect(snap.view.turn.phase).toBe('setup')
    }
  })

  it('rejects an out-of-turn intent with RULE_ERROR and applies a legal one with fresh snapshots', async () => {
    const { clients, snapshots } = await seatClients(4)
    const err = nextMessage<{ code: string }>(clients[1]!, MSG.RULE_ERROR)
    clients[1]!.send(MSG.INTENT, { type: 'rollDice' })
    expect((await err).code).toBe('NOT_YOUR_TURN')

    const view0 = snapshots[0]!.at(-1)!.view
    expect(view0.turn.current).toBe(0)
    const before = snapshots[2]!.length
    clients[0]!.send(MSG.INTENT, { type: 'placeSetupSettlement', vertex: vertexId({ q: 2, r: 0 }, 0) })
    await settle()
    expect(snapshots[2]!.length).toBeGreaterThan(before) // everyone got a fresh view
    const snap2 = snapshots[2]!.at(-1)!
    expectRedactedFor(snap2, 2)
    expect(Object.keys(snap2.view.buildings)).toHaveLength(1)
  })

  it('malformed intents get BAD_MESSAGE', async () => {
    const { clients } = await seatClients(4)
    const err = nextMessage<{ code: string }>(clients[0]!, MSG.RULE_ERROR)
    clients[0]!.send(MSG.INTENT, { type: 'rollDice', player: 0 })
    expect((await err).code).toBe('BAD_MESSAGE')
  })

  it('host can start a 4-room at 3 seats; non-host cannot', async () => {
    const c0 = await server.sdk.joinOrCreate('catan', { players: 4, pilotDelayMs: 0, seed: 1 })
    const c1 = await server.sdk.joinById(c0.roomId, {})
    const c2 = await server.sdk.joinById(c0.roomId, {})
    const sink: CatanSnapshotPayload[] = []
    collectSnapshots(c0, sink)
    c2.onMessage('*', () => undefined)

    const err = nextMessage<{ code: string }>(c1, MSG.RULE_ERROR)
    c1.onMessage('*', () => undefined)
    c1.send(MSG.START)
    expect((await err).code).toBe('NOT_HOST')

    c0.send(MSG.START)
    await settle()
    expect(sink.length).toBeGreaterThan(0)
    expect(sink.at(-1)!.view.playerCount).toBe(3)
  })
})

describe('player count 3..8', () => {
  it('accepts an 8-player room and rejects 2 and 9', async () => {
    const room = await server.sdk.joinOrCreate('catan', { players: 8, bots: 7, seed: 1, pilotDelayMs: 0 })
    await settle()
    expect(room.state.targetPlayers).toBe(8)
    await room.leave()
    await expect(server.sdk.joinOrCreate('catan', { players: 2 })).rejects.toThrow()
    await expect(server.sdk.joinOrCreate('catan', { players: 9 })).rejects.toThrow()
  })
})
