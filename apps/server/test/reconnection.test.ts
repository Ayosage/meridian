import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { boot, type ColyseusTestServer } from '@colyseus/testing'
import type { Room as ClientRoom } from 'colyseus.js'
import appConfig from '../src/app.config'
import type { MatchState } from '../src/schema/MatchState'

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

function nextMessage<T>(client: ClientRoom, type: string): Promise<T> {
  return new Promise((resolve) => client.onMessage(type, (payload: T) => resolve(payload)))
}

function muteUnhandled(client: ClientRoom): void {
  client.onMessage('*', () => undefined)
}

async function createMatch(graceSeconds: number) {
  const room = await server.createRoom<MatchState>('match', { graceSeconds })
  const c0 = await server.connectTo(room)
  muteUnhandled(c0)
  const c1 = await server.sdk.joinById(room.roomId)
  muteUnhandled(c1)
  await room.waitForNextPatch()
  return { room, c0, c1 }
}

describe('reconnection', () => {
  it('a dropped client reconnects to the same seat and converged state', async () => {
    const { room, c0, c1 } = await createMatch(5)

    // Advance the match one move so the rejoining client must converge.
    c0.send('intent', { type: 'move', pieceId: 'p0-0', to: { q: -2, r: 0 } })
    await room.waitForNextPatch()

    const token = c1.reconnectionToken
    await c1.leave(false) // simulate a drop (non-consented)
    // The client's leave() promise resolves on its own local socket close,
    // which can race the server's async onLeave (and its allowReconnection
    // registration) processing the same close event. A short delay lets the
    // server catch up before we attempt the reconnect.
    await new Promise((resolve) => setTimeout(resolve, 100))

    const c1b = await server.sdk.reconnect(token)
    muteUnhandled(c1b)
    const snapshot = nextMessage<{ state: { seq: number } }>(c1b, 'snapshot')
    // Not awaited: in the installed @colyseus/testing/colyseus.js combination
    // the client-side patch hook this wraps is never invoked (dispatch calls
    // `serializer.patch()` directly), so the returned promise never settles.
    // The snapshot await below is the real synchronization point.
    c1b.waitForNextPatch?.()

    // Same seat, converged authoritative state.
    expect(c1b.sessionId).toBe(room.state.seats[1])
    const snap = await snapshot
    expect(snap.state.seq).toBe(1)
    expect(room.state.phase).toBe('playing')

    // The reconnected client can act when it is their turn.
    c1b.send('intent', { type: 'move', pieceId: 'p1-0', to: { q: 2, r: 0 } })
    await room.waitForNextPatch()
    expect(room.state.seq).toBe(2)
  })

  it('an expired grace window forfeits the match to the opponent', async () => {
    const { room, c0, c1 } = await createMatch(1)
    const ended = nextMessage<{ reason: string; winner: number }>(c0, 'matchEnded')

    await c1.leave(false)

    const result = await ended
    expect(result).toEqual({ reason: 'forfeit', winner: 0 })
    expect(room.state.phase).toBe('ended')
    expect(room.state.winner).toBe(0)
  })

  it('a consented leave mid-match forfeits immediately', async () => {
    const { room, c0, c1 } = await createMatch(30)
    const ended = nextMessage<{ reason: string; winner: number }>(c0, 'matchEnded')

    await c1.leave(true) // consented: no reconnection window

    const result = await ended
    expect(result).toEqual({ reason: 'forfeit', winner: 0 })
    expect(room.state.phase).toBe('ended')
  })

  it('a client that leaves before the match starts is removed from seats, not held', async () => {
    const room = await server.createRoom<MatchState>('match', { graceSeconds: 30 })
    const c0 = await server.connectTo(room)
    muteUnhandled(c0)
    expect(room.state.phase).toBe('waiting')

    await c0.leave(false) // drop before a second player joins
    await room.waitForNextPatch()
    expect(room.state.seats.length).toBe(0)

    const c1 = await server.connectTo(room)
    muteUnhandled(c1)
    const c2 = await server.connectTo(room)
    muteUnhandled(c2)
    await room.waitForNextPatch()

    expect(room.state.phase).toBe('playing')
    expect(room.state.seats.length).toBe(2)
    expect(Array.from(room.state.seats)).toEqual([c1.sessionId, c2.sessionId])
  })
})
