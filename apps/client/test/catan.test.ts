import { beforeEach, describe, expect, it, vi } from 'vitest'

// ---- fake colyseus.js -------------------------------------------------
type Handler = (payload: unknown) => void

class FakeRoom {
  roomId = 'ROOM1'
  sessionId = 'sess-0'
  reconnectionToken = 'tok-123'
  private stateHandlers: ((state: unknown) => void)[] = []
  private messageHandlers = new Map<string, Handler>()
  sent: { type: string; payload: unknown }[] = []

  onStateChange(cb: (state: unknown) => void) {
    this.stateHandlers.push(cb)
  }
  onMessage(type: string, cb: Handler) {
    this.messageHandlers.set(type, cb)
  }
  onLeave(_cb: (code: number) => void) {
    // not exercised here — connection.test.ts covers the analogous reconnect-on-leave flow
  }
  send(type: string, payload?: unknown) {
    this.sent.push({ type, payload })
  }
  leave() {
    return Promise.resolve()
  }

  // test drivers
  pushState(state: unknown) {
    for (const cb of this.stateHandlers) cb(state)
  }
  pushMessage(type: string, payload: unknown) {
    this.messageHandlers.get(type)?.(payload)
  }
}

const fake = {
  room: new FakeRoom(),
  createCalls: [] as { name: string; options: unknown }[],
  reconnectCalls: [] as string[],
  reconnectShouldFail: false,
}

vi.mock('colyseus.js', () => ({
  Client: class {
    create(name: string, options: unknown) {
      fake.createCalls.push({ name, options })
      return Promise.resolve(fake.room)
    }
    joinById() {
      return Promise.resolve(fake.room)
    }
    reconnect(token: string) {
      fake.reconnectCalls.push(token)
      if (fake.reconnectShouldFail) return Promise.reject(new Error('reconnect failed'))
      return Promise.resolve(fake.room)
    }
  },
}))

import { useCatanStore } from '../src/scene/catan/catanStore'
import { tokenStorage } from '../src/net/tokenStorage'
import { createCatanMatch, reconnectCatan, sendCatanIntent } from '../src/net/catan'

/** Plain arrays already satisfy the duck-typed lobby state (indexOf/length/iterable). */
function lobbyOf(seats: string[], connected: boolean[], phase = 'waiting', targetPlayers = 4) {
  return { phase, targetPlayers, seats, connected }
}

beforeEach(() => {
  useCatanStore.getState().reset()
  tokenStorage.clearFor('ROOM1')
  tokenStorage.clearFor('stale-room')
  fake.room = new FakeRoom()
  fake.createCalls = []
  fake.reconnectCalls = []
  fake.reconnectShouldFail = false
})

describe('catan net wiring', () => {
  it('createCatanMatch stores the room id and persists a room-keyed token', async () => {
    await createCatanMatch(4, 0)
    expect(useCatanStore.getState().roomId).toBe('ROOM1')
    expect(tokenStorage.getFor('ROOM1')).toBe('tok-123')
  })

  it('lobby state change derives the seat and roster', async () => {
    await createCatanMatch(4, 0)
    fake.room.pushState(lobbyOf(['sess-0', 'other'], [true, true]))
    const s = useCatanStore.getState()
    expect(s.seat).toBe(0)
    expect(s.seats).toEqual(['sess-0', 'other'])
    expect(s.status).toBe('waiting')
  })

  it('MATCH_ENDED clears the room token so it cannot be auto-resumed later', async () => {
    await createCatanMatch(4, 0)
    expect(tokenStorage.getFor('ROOM1')).toBe('tok-123')

    fake.room.pushMessage('matchEnded', { reason: 'win', winner: 1 })

    expect(tokenStorage.getFor('ROOM1')).toBeNull()
    expect(tokenStorage.getAny()).toBeNull()
    const s = useCatanStore.getState()
    expect(s.winner).toEqual({ reason: 'win', winner: 1 })
    expect(s.status).toBe('ended')
  })

  it('sendCatanIntent forwards to the room', async () => {
    await createCatanMatch(3, 0)
    sendCatanIntent({ type: 'rollDice' })
    expect(fake.room.sent).toEqual([{ type: 'intent', payload: { type: 'rollDice' } }])
  })

  it('reconnectCatan clears only the failed room token, leaving others intact', async () => {
    tokenStorage.setFor('stale-room', 'stale-tok')
    fake.reconnectShouldFail = true

    const ok = await reconnectCatan()

    expect(ok).toBe(false)
    expect(tokenStorage.getFor('stale-room')).toBeNull()
    expect(useCatanStore.getState().status).toBe('idle')
  })
})
