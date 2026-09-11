import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createCatanGame, createRng, redactCatanState } from '@meridian/rules'
import { useCatanStore } from '../src/scene/catan/catanStore'
import { tokenStorage } from '../src/net/tokenStorage'
import {
  configureLobby,
  createCatanMatch,
  describeJoinError,
  joinCatanMatch,
  reconnectCatan,
  sendCatanIntent,
  startMatch,
} from '../src/net/catan'
import { FakeWs, untilSockets } from './fakeWs'

const lobby = (phase = 'waiting') => ({ phase, seats: ['seat-0'], connected: [true], targetPlayers: 4, botCount: 0, seatNames: [] })
const fetchCalls: { url: string; init?: RequestInit }[] = []

function stubFetch(routes: Record<string, () => Response>) {
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    fetchCalls.push({ url, init })
    const path = new URL(url).pathname
    const key = `${init?.method ?? 'GET'} ${path}`
    const handler = routes[key]
    return handler ? handler() : new Response('not found', { status: 404 })
  })
}

/** Script: every socket opens and is welcomed into `seat` right away. */
function welcomeAll(seat = 0, token = 'tok-123') {
  FakeWs.script = (ws) => {
    ws.open()
    ws.receive({ t: 'welcome', seat, token })
  }
}

const view = () => redactCatanState(createCatanGame({ playerCount: 4 }, createRng(1)), 0)

beforeEach(() => {
  useCatanStore.getState().reset()
  for (const r of ['ROOM1', 'stale-room', 'flaky-room', 'slow-room']) tokenStorage.clearFor(r)
  FakeWs.reset()
  fetchCalls.length = 0
  vi.stubGlobal('WebSocket', FakeWs)
  stubFetch({
    'POST /matches/open': () => Response.json({ code: 'ROOM1', joinUrl: 'http://x/?join=ROOM1' }, { status: 201 }),
    'GET /matches/ROOM1': () => Response.json(lobby()),
  })
})
afterEach(() => vi.unstubAllGlobals())

describe('catan net wiring', () => {
  it('createCatanMatch opens a room over HTTP, dials its socket, and persists a room-keyed token', async () => {
    welcomeAll()
    await createCatanMatch(4, 1)
    expect(fetchCalls[0]?.url).toMatch(/\/matches\/open$/)
    expect(JSON.parse(String(fetchCalls[0]?.init?.body))).toEqual({ players: 4, bots: 1, knobs: {} })
    expect(FakeWs.last.url).toBe('ws://localhost:8787/matches/ROOM1/ws')
    expect(FakeWs.last.sentMessages()[0]).toEqual({ t: 'hello' })
    const s = useCatanStore.getState()
    expect(s.roomId).toBe('ROOM1')
    expect(s.seat).toBe(0)
    expect(s.status).toBe('waiting')
    expect(tokenStorage.getFor('ROOM1')).toBe('tok-123')
  })

  it('a lobby message fills the roster; a snapshot is ingested; a rule error becomes a capitalised toast', async () => {
    welcomeAll()
    await createCatanMatch(4, 0)
    FakeWs.last.receive({ t: 'lobby', ...lobby(), seats: ['seat-0', 'seat-1'], connected: [true, false] })
    expect(useCatanStore.getState().seats).toEqual(['seat-0', 'seat-1'])
    expect(useCatanStore.getState().connected).toEqual([true, false])
    FakeWs.last.receive({ t: 'snapshot', seq: 0, view: view() })
    expect(useCatanStore.getState().status).toBe('playing')
    expect(useCatanStore.getState().view?.seq).toBe(0)
    FakeWs.last.receive({ t: 'error', code: 'BAD_PHASE', message: 'not your turn' })
    expect(useCatanStore.getState().toast).toBe('Not your turn')
  })

  it('ended clears the room token so it cannot be auto-resumed later, and records the reason', async () => {
    welcomeAll()
    await createCatanMatch(4, 0)
    FakeWs.last.receive({ t: 'ended', reason: 'win', winner: 1 })
    expect(tokenStorage.getFor('ROOM1')).toBeNull()
    expect(tokenStorage.getAny()).toBeNull()
    expect(useCatanStore.getState().winner).toEqual({ reason: 'win', winner: 1 })
    expect(useCatanStore.getState().status).toBe('ended')
    useCatanStore.getState().reset()
    welcomeAll()
    await createCatanMatch(4, 0)
    FakeWs.last.receive({ t: 'ended', reason: 'abandoned', winner: null })
    expect(useCatanStore.getState().winner).toEqual({ reason: 'abandoned', winner: null })
  })

  it('sendCatanIntent, configureLobby and startMatch go out as envelopes', async () => {
    welcomeAll()
    await createCatanMatch(3, 0)
    sendCatanIntent({ type: 'rollDice' })
    configureLobby(5, 2)
    startMatch()
    expect(FakeWs.last.sentMessages().slice(1)).toEqual([
      { t: 'intent', intent: { type: 'rollDice' } },
      { t: 'configure', players: 5, bots: 2 },
      { t: 'start' },
    ])
  })

  it('a later welcome moves the seat (the host arrived and took seat 0)', async () => {
    welcomeAll(0)
    await createCatanMatch(4, 0)
    expect(useCatanStore.getState().seat).toBe(0)
    FakeWs.last.receive({ t: 'welcome', seat: 1, token: 'tok-123' })
    expect(useCatanStore.getState().seat).toBe(1)
    expect(useCatanStore.getState().status).toBe('waiting')
  })

  it('joinCatanMatch probes the lobby first: an unknown code is a bad-code error, a full or started room says so', async () => {
    await expect(joinCatanMatch('zzzz')).rejects.toThrow()
    expect(useCatanStore.getState().status).toBe('connecting')
    let err: unknown
    try {
      await joinCatanMatch('zzzz')
    } catch (e) {
      err = e
    }
    expect(describeJoinError(err)).toMatch(/No match with that code/)
    expect(fetchCalls.at(-1)?.url).toMatch(/\/matches\/ZZZZ$/)
    FakeWs.script = (ws) => {
      ws.open()
      ws.receive({ t: 'error', code: 'FULL', message: 'match is full' })
    }
    try {
      await joinCatanMatch('room1')
    } catch (e) {
      err = e
    }
    expect(describeJoinError(err)).toMatch(/full/i)
  })

  it('joinCatanMatch carries the seat token from the personal link into hello', async () => {
    vi.stubGlobal('window', { location: { search: '?join=ROOM1&seat=st_abc' } })
    welcomeAll(2)
    await joinCatanMatch('ROOM1')
    expect(FakeWs.last.sentMessages()[0]).toEqual({ t: 'hello', seatToken: 'st_abc' })
    expect(useCatanStore.getState().seat).toBe(2)
  })

  it('reconnectCatan clears only the failed room token, leaving others intact', async () => {
    tokenStorage.setFor('stale-room', 'stale-tok')
    FakeWs.script = (ws) => ws.close(1006)
    const ok = await reconnectCatan({ attempts: 2, delayMs: 0 })
    expect(ok).toBe(false)
    expect(tokenStorage.getFor('stale-room')).toBeNull()
    expect(useCatanStore.getState().status).toBe('idle')
  })

  it('reconnectCatan retries with the stored token before giving up', async () => {
    tokenStorage.setFor('flaky-room', 'flaky-tok')
    FakeWs.script = (ws) => ws.close(1006)
    const ok = await reconnectCatan({ attempts: 3, delayMs: 0 })
    expect(ok).toBe(false)
    expect(FakeWs.instances).toHaveLength(3)
    expect(FakeWs.instances.map((w) => w.url)).toEqual(Array(3).fill('ws://localhost:8787/matches/flaky-room/ws'))
  })

  it('reconnectCatan succeeds on a later attempt, keeps the token, and stays out of the waiting room', async () => {
    tokenStorage.setFor('slow-room', 'slow-tok')
    let n = 0
    FakeWs.script = (ws) => {
      if (n++ === 0) return ws.close(1006)
      ws.open()
      ws.receive({ t: 'welcome', seat: 1, token: 'slow-tok' })
    }
    const ok = await reconnectCatan({ attempts: 3, delayMs: 0 })
    expect(ok).toBe(true)
    expect(FakeWs.instances).toHaveLength(2)
    expect(FakeWs.last.sentMessages()[0]).toEqual({ t: 'hello', token: 'slow-tok' })
    expect(tokenStorage.getFor('slow-room')).toBe('slow-tok')
    expect(useCatanStore.getState().status).toBe('reconnecting')
    FakeWs.last.receive({ t: 'snapshot', seq: 3, view: view() })
    expect(useCatanStore.getState().status).toBe('playing')
  })

  it('a socket drop during play reconnects automatically with the token', async () => {
    welcomeAll()
    await createCatanMatch(4, 0)
    FakeWs.last.receive({ t: 'snapshot', seq: 0, view: view() })
    const dropped = FakeWs.last
    FakeWs.script = (ws) => {
      ws.open()
      ws.receive({ t: 'welcome', seat: 0, token: 'tok-123' })
    }
    dropped.close(1006)
    await untilSockets(2)
    await new Promise((r) => setTimeout(r, 0))
    expect(FakeWs.last.sentMessages()[0]).toEqual({ t: 'hello', token: 'tok-123' })
    expect(useCatanStore.getState().roomId).toBe('ROOM1')
  })
})
