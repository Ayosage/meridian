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

/** Register a promise for one message BEFORE triggering it. */
function nextMessage<T>(client: ClientRoom, type: string): Promise<T> {
  return new Promise((resolve) => client.onMessage(type, (payload: T) => resolve(payload)))
}

/** Swallow messages we are not asserting on, keeping test output clean. */
function muteUnhandled(client: ClientRoom): void {
  client.onMessage('*', () => undefined)
}

async function createMatch() {
  const room = await server.createRoom<MatchState>('match', {})
  const c0 = await server.connectTo(room)
  muteUnhandled(c0)
  const c1 = await server.sdk.joinById(room.roomId)
  muteUnhandled(c1)
  await room.waitForNextPatch()
  return { room, c0, c1 }
}

describe('lobby', () => {
  it('room id is a 4-letter join code and a second client can join by it', async () => {
    const { room, c1 } = await createMatch()
    expect(room.roomId).toMatch(/^[A-Z]{4}$/)
    expect(c1.roomId).toBe(room.roomId)
    expect(room.state.phase).toBe('playing')
    expect(room.state.seats.length).toBe(2)
    expect(room.state.pieces.size).toBe(6)
  })

  it('a third client cannot join (room locked at 2)', async () => {
    const { room } = await createMatch()
    await expect(server.sdk.joinById(room.roomId)).rejects.toThrow()
  })
})

describe('authoritative loop', () => {
  it('a valid intent from the current player advances shared state', async () => {
    const { room, c0 } = await createMatch()
    c0.send('intent', { type: 'move', pieceId: 'p0-0', to: { q: -2, r: 0 } })
    await room.waitForNextPatch()
    expect(room.state.seq).toBe(1)
    expect(room.state.currentPlayer).toBe(1)
    expect(room.state.pieces.get('p0-0')!.q).toBe(-2)
  })

  it('an out-of-turn intent is rejected to the sender only; state unchanged', async () => {
    const { room, c1 } = await createMatch()
    const errPromise = nextMessage<{ code: string }>(c1, 'ruleError')
    c1.send('intent', { type: 'move', pieceId: 'p1-0', to: { q: 2, r: 0 } })
    const err = await errPromise
    expect(err.code).toBe('NOT_YOUR_TURN')
    expect(room.state.seq).toBe(0)
  })

  it('a malformed message is rejected at the protocol boundary', async () => {
    const { room, c0 } = await createMatch()
    const errPromise = nextMessage<{ code: string }>(c0, 'ruleError')
    c0.send('intent', { type: 'teleport', anywhere: true })
    const err = await errPromise
    expect(err.code).toBe('BAD_MESSAGE')
    expect(room.state.seq).toBe(0)
  })

  it('two clients complete a scripted full match to a win', async () => {
    const { room, c0, c1 } = await createMatch()
    const ended = nextMessage<{ reason: string; winner: number }>(c0, 'matchEnded')

    // Seat 0 marches p0-0 from (-3,0) across the board and captures all three
    // of seat 1's pieces; seat 1 passes every turn.
    const path = [
      { q: -2, r: 0 },
      { q: -1, r: 0 },
      { q: 0, r: 0 },
      { q: 1, r: 0 },
      { q: 2, r: 0 },
      { q: 3, r: 0 },   // captures p1-0
      { q: 3, r: -1 },  // captures p1-1
      { q: 3, r: -2 },  // captures p1-2
    ]
    for (const to of path) {
      c0.send('intent', { type: 'move', pieceId: 'p0-0', to })
      await room.waitForNextPatch()
      if (room.state.winner !== -1) break
      c1.send('intent', { type: 'endTurn' })
      await room.waitForNextPatch()
    }

    const result = await ended
    expect(result).toEqual({ reason: 'win', winner: 0 })
    expect(room.state.phase).toBe('ended')
    expect(room.state.winner).toBe(0)
    expect(room.state.pieces.size).toBe(3)
  })
})
