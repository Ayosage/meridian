import { beforeEach, describe, expect, it, vi } from 'vitest'
import { applyIntent, initialState, isRuleError, placeholderRuleset } from '@meridian/rules'

// ---- fake colyseus.js -------------------------------------------------
type Handler = (payload: unknown) => void

class FakeRoom {
  roomId = 'ABCD'
  sessionId = 'sess-0'
  reconnectionToken = 'tok-123'
  private stateHandlers: ((state: unknown) => void)[] = []
  private messageHandlers = new Map<string, Handler>()
  sent: { type: string; payload: unknown }[] = []
  leaveHandlers: ((code: number) => void)[] = []

  onStateChange(cb: (state: unknown) => void) {
    this.stateHandlers.push(cb)
  }
  onMessage(type: string, cb: Handler) {
    this.messageHandlers.set(type, cb)
  }
  onLeave(cb: (code: number) => void) {
    this.leaveHandlers.push(cb)
  }
  send(type: string, payload: unknown) {
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
  createCalls: 0,
  joinCalls: [] as string[],
  reconnectCalls: [] as string[],
  reconnectShouldFail: false,
}

vi.mock('colyseus.js', () => ({
  Client: class {
    create() {
      fake.createCalls += 1
      return Promise.resolve(fake.room)
    }
    joinById(code: string) {
      fake.joinCalls.push(code)
      return Promise.resolve(fake.room)
    }
    reconnect(token: string) {
      fake.reconnectCalls.push(token)
      if (fake.reconnectShouldFail) return Promise.reject(new Error('reconnect failed'))
      return Promise.resolve(fake.room)
    }
  },
}))

import { useMeridianStore } from '../src/store'
import { tokenStorage } from '../src/net/tokenStorage'
import { createMatch, joinMatch, reconnectMatch, sendIntent } from '../src/net/connection'

function schemaOf(seats: string[], gameSeq = 0, phase = 'playing') {
  const gs = initialState(placeholderRuleset)
  return {
    phase,
    currentPlayer: gs.currentPlayer,
    winner: -1,
    seq: gameSeq,
    pieces: {
      forEach: (cb: (p: { id: string; owner: number; pieceType: string; q: number; r: number }) => void) =>
        gs.pieces.forEach((p) => cb({ id: p.id, owner: p.owner, pieceType: p.type, q: p.at.q, r: p.at.r })),
    },
    seats: { indexOf: (s: string) => seats.indexOf(s), length: seats.length },
  }
}

beforeEach(() => {
  useMeridianStore.getState().reset()
  tokenStorage.clear()
  fake.room = new FakeRoom()
  fake.createCalls = 0
  fake.joinCalls = []
  fake.reconnectCalls = []
  fake.reconnectShouldFail = false
})

describe('connection wiring', () => {
  it('createMatch stores the join code, persists the token, and derives the seat from state', async () => {
    await createMatch()
    expect(useMeridianStore.getState().joinCode).toBe('ABCD')
    expect(tokenStorage.get()).toBe('tok-123')

    fake.room.pushState(schemaOf(['sess-0'], 0, 'waiting'))
    expect(useMeridianStore.getState().seat).toBe(0)
    expect(useMeridianStore.getState().status).toBe('waiting')

    fake.room.pushState(schemaOf(['sess-0', 'other'], 0, 'playing'))
    const s = useMeridianStore.getState()
    expect(s.status).toBe('playing')
    expect(s.game?.pieces).toHaveLength(6)
  })

  it('joinMatch uppercases the code', async () => {
    await joinMatch('abcd')
    expect(fake.joinCalls).toEqual(['ABCD'])
  })

  it('ruleError messages surface as transient errors and clear selection', async () => {
    await createMatch()
    fake.room.pushState(schemaOf(['sess-0', 'other']))
    useMeridianStore.getState().selectPiece('p0-0')
    expect(useMeridianStore.getState().selectedPieceId).toBe('p0-0')

    fake.room.pushMessage('ruleError', { code: 'NOT_YOUR_TURN', message: 'wait' })
    const s = useMeridianStore.getState()
    expect(s.error).toContain('NOT_YOUR_TURN')
    expect(s.selectedPieceId).toBeNull()
  })

  it('matchEnded sets the result; snapshot state is accepted as authoritative', async () => {
    await createMatch()
    fake.room.pushMessage('matchEnded', { reason: 'win', winner: 0 })
    expect(useMeridianStore.getState().matchResult).toEqual({ reason: 'win', winner: 0 })

    const moved = applyIntent(initialState(placeholderRuleset), {
      type: 'move',
      player: 0,
      pieceId: 'p0-0',
      to: { q: -2, r: 0 },
    })
    if (isRuleError(moved)) throw new Error(moved.message)
    fake.room.pushMessage('snapshot', { state: moved })
    expect(useMeridianStore.getState().game?.seq).toBe(1)
  })

  it('sendIntent forwards to the room', async () => {
    await createMatch()
    sendIntent({ type: 'endTurn' })
    expect(fake.room.sent).toEqual([{ type: 'intent', payload: { type: 'endTurn' } }])
  })

  it('reconnectMatch falls back to idle status when the reconnect attempt fails', async () => {
    tokenStorage.set('stale-token')
    fake.reconnectShouldFail = true

    const ok = await reconnectMatch()

    expect(ok).toBe(false)
    expect(tokenStorage.get()).toBeNull()
    expect(useMeridianStore.getState().status).toBe('idle')
  })
})
