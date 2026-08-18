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
    // waitForNextPatch resolves on the room's next scheduled patch tick
    // (colyseus patches on a fixed ~50ms interval regardless of whether
    // anything changed), not specifically on the tick carrying this
    // intent's effect — poll a couple of ticks rather than assume one is
    // enough.
    for (let i = 0; i < 5 && room.state.seq !== 2; i++) {
      await room.waitForNextPatch()
    }
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
    // Same client-leave-vs-server-onLeave race as the reconnect test above:
    // give the server's onLeave time to run before asserting on its effect.
    await new Promise((resolve) => setTimeout(resolve, 100))
    await room.waitForNextPatch()
    expect(room.state.seats.length).toBe(0)

    // Join by the room's code (not connectTo, which bypasses matchmaking)
    // to prove the join code itself still works — the whole point of the
    // resetAutoDisposeTimeout call this exercises.
    const c1 = await server.sdk.joinById(room.roomId)
    muteUnhandled(c1)
    const c2 = await server.sdk.joinById(room.roomId)
    muteUnhandled(c2)
    await room.waitForNextPatch()

    expect(room.state.phase).toBe('playing')
    expect(room.state.seats.length).toBe(2)
    expect(Array.from(room.state.seats)).toEqual([c1.sessionId, c2.sessionId])
  })

  it('a win that lands during a grace window is not overwritten when the grace later expires', async () => {
    const { room, c0, c1 } = await createMatch(1)

    const endedEvents: { reason: string; winner: number }[] = []
    const firstEnded = new Promise<{ reason: string; winner: number }>((resolve) => {
      c0.onMessage('matchEnded', (payload: { reason: string; winner: number }) => {
        endedEvents.push(payload)
        if (endedEvents.length === 1) resolve(payload)
      })
    })

    // Seat 0 marches p0-0 across the board, capturing two of seat 1's three
    // pieces (same script as match-room.test.ts's scripted win), leaving one
    // decisive capturing move still to play.
    const preliminaryPath = [
      { q: -2, r: 0 },
      { q: -1, r: 0 },
      { q: 0, r: 0 },
      { q: 1, r: 0 },
      { q: 2, r: 0 },
      { q: 3, r: 0 }, // captures p1-0
      { q: 3, r: -1 }, // captures p1-1
    ]
    for (const to of preliminaryPath) {
      c0.send('intent', { type: 'move', pieceId: 'p0-0', to })
      await room.waitForNextPatch()
      c1.send('intent', { type: 'endTurn' })
      await room.waitForNextPatch()
    }

    // Drop seat 1 right before the winning move: the grace window (1s) is
    // now ticking concurrently with the match finishing by a normal win.
    await c1.leave(false)
    await new Promise((resolve) => setTimeout(resolve, 100))

    c0.send('intent', { type: 'move', pieceId: 'p0-0', to: { q: 3, r: -2 } }) // captures p1-2, wins
    await room.waitForNextPatch()

    const result = await firstEnded
    expect(result).toEqual({ reason: 'win', winner: 0 })
    expect(room.state.phase).toBe('ended')
    expect(room.state.winner).toBe(0)

    // Wait past the 1s grace window: it must not re-fire a forfeit on top
    // of the win, nor flip the winner.
    await new Promise((resolve) => setTimeout(resolve, 1300))
    expect(endedEvents.length).toBe(1)
    expect(room.state.phase).toBe('ended')
    expect(room.state.winner).toBe(0)
  })
})
